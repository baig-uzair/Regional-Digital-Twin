"""Skogsstyrelsen - Skogliga grunddata REST API, OAuth 2.0 Client Credentials (mapping doc 4.3).

Verified against the live OpenAPI spec at build time:
  https://api.skogsstyrelsen.se/sksapi/swagger/skogliga%20grunddata_v1.0/openapi.json
Token endpoint:  POST https://auth.skogsstyrelsen.se/connect/token
                 (grant_type=client_credentials, scope=sks_api, 60 minute lifetime)
Data endpoints:  POST https://api.skogsstyrelsen.se/sksapi/skogligagrunddata/v1/{Volym|Biomassa|
                 Grundyta|Medelhojd|Medeldiameter}
                 Body: {"geometri": "<WKT POLYGON>", ...}. The API only accepts WKT in
                 SWEREF99 TM (EPSG:3006, POLYGON/MULTIPOLYGON only) - never WGS84.

Auth and transformation are kept separate: `_get_token()` only ever handles the OAuth
flow, `_query_metric()` only ever handles a single metric request/response.
"""
from __future__ import annotations

import math
import os
import time

import requests

from .common import ConnectorError, ConnectorSkipped, NormalizedRecord, logger

SOURCE_ID = "Skogsstyrelsen"
TOKEN_URL = "https://auth.skogsstyrelsen.se/connect/token"
API_BASE = "https://api.skogsstyrelsen.se/sksapi/skogligagrunddata/v1"
TIMEOUT = 30
LICENSE_URL = "https://www.skogsstyrelsen.se/skogsstyrelsensapi"

# Small representative AOI (~2km box near Falun) rather than the full county: the API
# computes statistics over the exact submitted polygon, and the docs recommend larger
# pixel sizes for areas > 100ha, so a whole-county polygon is not what this endpoint is
# meant to be queried with. Override with SKOGSSTYRELSEN_AOI_BBOX="minlon,minlat,maxlon,maxlat".
DEFAULT_AOI_BBOX = (15.615, 60.595, 15.650, 60.620)

METRICS = ["Volym", "Biomassa", "Grundyta", "Medelhojd", "Medeldiameter"]

_token_cache: dict[str, float | str] = {"token": "", "expires_at": 0.0}


def _get_credentials() -> tuple[str, str]:
    client_id = os.environ.get("SKOGSSTYRELSEN_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SKOGSSTYRELSEN_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise ConnectorSkipped(
            "Skogsstyrelsen: SKOGSSTYRELSEN_CLIENT_ID/SKOGSSTYRELSEN_CLIENT_SECRET not set, skipping"
        )
    return client_id, client_secret


def _get_token() -> str:
    if _token_cache["token"] and time.time() < float(_token_cache["expires_at"]):
        return str(_token_cache["token"])

    client_id, client_secret = _get_credentials()
    data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "sks_api",
    }
    try:
        resp = requests.post(TOKEN_URL, data=data, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"Skogsstyrelsen: token request failed: {exc}")

    if resp.status_code != 200:
        raise ConnectorError(f"Skogsstyrelsen: token request HTTP {resp.status_code} - {resp.text[:200]}")

    payload = resp.json()
    access_token = payload.get("access_token")
    expires_in = payload.get("expires_in", 3600)
    if not access_token:
        raise ConnectorError("Skogsstyrelsen: token response missing access_token")

    _token_cache["token"] = access_token
    _token_cache["expires_at"] = time.time() + float(expires_in) - 60  # refresh a minute early
    return access_token


def _wgs84_to_sweref99tm(lat: float, lon: float) -> tuple[float, float]:
    """Forward transverse Mercator (Snyder), GRS80 ellipsoid, central meridian 15E, k0=0.9996.

    This is the standard SWEREF99 TM (EPSG:3006) definition; GRS80 and WGS84 differ by
    sub-millimetre amounts so using WGS84 lat/lon input here is accurate enough for a
    forest-statistics AOI query (not survey-grade cadastral work).
    """
    a = 6378137.0
    f = 1 / 298.257222101
    k0 = 0.9996
    false_easting = 500000.0
    central_meridian = 15.0

    e2 = f * (2 - f)
    e4 = e2 * e2
    e6 = e4 * e2
    ep2 = e2 / (1 - e2)

    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    central_rad = math.radians(central_meridian)

    n = a / math.sqrt(1 - e2 * math.sin(lat_rad) ** 2)
    t = math.tan(lat_rad) ** 2
    c = ep2 * math.cos(lat_rad) ** 2
    aa = math.cos(lat_rad) * (lon_rad - central_rad)

    m = a * (
        (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat_rad
        - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * lat_rad)
        + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * lat_rad)
        - (35 * e6 / 3072) * math.sin(6 * lat_rad)
    )

    easting = false_easting + k0 * n * (
        aa
        + (1 - t + c) * aa**3 / 6
        + (5 - 18 * t + t**2 + 72 * c - 58 * ep2) * aa**5 / 120
    )
    northing = k0 * (
        m
        + n * math.tan(lat_rad) * (
            aa**2 / 2
            + (5 - t + 9 * c + 4 * c**2) * aa**4 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * ep2) * aa**6 / 720
        )
    )
    return easting, northing


def _bbox_to_sweref99tm_wkt(bbox) -> str:
    min_lon, min_lat, max_lon, max_lat = bbox
    corners_wgs84 = [
        (min_lat, min_lon),
        (min_lat, max_lon),
        (max_lat, max_lon),
        (max_lat, min_lon),
        (min_lat, min_lon),
    ]
    projected = [_wgs84_to_sweref99tm(lat, lon) for lat, lon in corners_wgs84]
    ring = ", ".join(f"{e} {n}" for e, n in projected)
    return f"POLYGON(({ring}))"


def _query_metric(metric: str, token: str, aoi_wkt: str) -> dict:
    url = f"{API_BASE}/{metric}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"geometri": aoi_wkt}
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"Skogsstyrelsen {metric}: request failed: {exc}")
    if resp.status_code != 200:
        raise ConnectorError(f"Skogsstyrelsen {metric}: HTTP {resp.status_code} - {resp.text[:200]}")
    try:
        return resp.json()
    except ValueError as exc:
        raise ConnectorError(f"Skogsstyrelsen {metric}: response was not JSON: {exc}")


def fetch_records(bbox=None) -> list[NormalizedRecord]:
    aoi_bbox = bbox or _aoi_bbox_from_env()
    try:
        token = _get_token()
        aoi_wkt_sweref = _bbox_to_sweref99tm_wkt(aoi_bbox)

        min_lon, min_lat, max_lon, max_lat = aoi_bbox
        aoi_wkt_wgs84 = (
            f"POLYGON(({min_lon} {min_lat}, {max_lon} {min_lat}, {max_lon} {max_lat}, "
            f"{min_lon} {max_lat}, {min_lon} {min_lat}))"
        )

        records: list[NormalizedRecord] = []
        for metric in METRICS:
            payload = _query_metric(metric, token, aoi_wkt_sweref)
            metadata = payload.get("metadata", {}) if isinstance(payload, dict) else {}
            observed_at = metadata.get("maxDatum")
            records.append(
                NormalizedRecord(
                    source_id=SOURCE_ID,
                    dataset_id=metric.lower(),
                    feature_id=None,
                    observed_at=_parse_iso(observed_at),
                    attributes=payload,
                    geometry_wkt=aoi_wkt_wgs84,
                    source_url=f"{API_BASE}/{metric}",
                    license=LICENSE_URL,
                )
            )
        return records
    except (ConnectorSkipped, ConnectorError):
        raise
    except Exception as exc:  # network/parse errors become a recorded error, never invented data
        raise ConnectorError(f"Skogsstyrelsen: {exc}")


def _aoi_bbox_from_env():
    raw = os.environ.get("SKOGSSTYRELSEN_AOI_BBOX", "").strip()
    if not raw:
        return DEFAULT_AOI_BBOX
    try:
        parts = tuple(float(x) for x in raw.split(","))
        if len(parts) != 4:
            raise ValueError
        return parts
    except ValueError:
        logger.warning("Skogsstyrelsen: invalid SKOGSSTYRELSEN_AOI_BBOX=%r, using default AOI", raw)
        return DEFAULT_AOI_BBOX


def _parse_iso(value):
    if not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
