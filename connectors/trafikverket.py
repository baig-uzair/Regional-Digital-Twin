"""Trafikverket Open API - WeatherMeasurepoint (road weather stations) inside Dalarna.

Request format (POST XML, `LOGIN authenticationkey`, `QUERY objecttype="WeatherMeasurepoint"
schemaversion="2.1"`) and the Observation.* field paths follow the pytrafikverket client
library. The spatial `WITHIN ... shape="box"` filter follows Trafikverket's query docs; it
has NOT been run against the live API yet because no TRAFIKVERKET_API_KEY is configured.

No key (or the .env placeholder) -> ConnectorSkipped -> the source shows "Not configured"
and nothing is written. Values are measurements only; nothing is derived or invented.
"""
from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Optional

import requests

from .common import DALARNA_BBOX, ConnectorError, ConnectorSkipped, NormalizedRecord

SOURCE_ID = "Trafikverket"
DATASET_ID = "weather_measurepoint"
API_URL = "https://api.trafikinfo.trafikverket.se/v2/data.xml"
LICENSE_URL = "https://www.trafiklab.se/api/trafiklab-apis/trafikverket/"
TIMEOUT = 30
PLACEHOLDERS = {"", "votre_cle_ici", "your_key_here", "changeme"}

INCLUDES = [
    "Id",
    "Name",
    "Geometry.WGS84",
    "ModifiedTime",
    "Observation.Sample",
    "Observation.Air.Temperature.Value",
    "Observation.Air.RelativeHumidity.Value",
    "Observation.Wind.Speed.Value",
    "Observation.Wind.Direction.Value",
    "Observation.Surface.Temperature.Value",
    "Observation.Surface.Ice",
    "Observation.Weather.Precipitation",
]


def api_key() -> str:
    key = os.environ.get("TRAFIKVERKET_API_KEY", "").strip()
    if key.lower() in PLACEHOLDERS:
        raise ConnectorSkipped("Trafikverket: TRAFIKVERKET_API_KEY not set (or still the placeholder)")
    return key


def build_request_xml(key: str, bbox=DALARNA_BBOX) -> str:
    min_lon, min_lat, max_lon, max_lat = bbox
    includes = "".join(f"<INCLUDE>{i}</INCLUDE>" for i in INCLUDES)
    return (
        f'<REQUEST><LOGIN authenticationkey="{key}"/>'
        f'<QUERY objecttype="WeatherMeasurepoint" schemaversion="2.1">{includes}'
        f'<FILTER><AND><EQ name="Deleted" value="false"/>'
        f'<WITHIN name="Geometry.WGS84" shape="box" value="{min_lon} {min_lat}, {max_lon} {max_lat}"/>'
        f"</AND></FILTER></QUERY></REQUEST>"
    )


def _num(node: ET.Element, path: str) -> Optional[float]:
    el = node.find(path)
    if el is None or el.text is None:
        return None
    try:
        return float(el.text)
    except ValueError:
        return None


def _text(node: ET.Element, path: str) -> Optional[str]:
    el = node.find(path)
    return el.text if el is not None and el.text else None


def _point(wgs84: Optional[str]) -> Optional[tuple[float, float]]:
    m = re.search(r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)", wgs84 or "")
    return (float(m.group(1)), float(m.group(2))) if m else None


def parse_response(xml_text: str) -> list[NormalizedRecord]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ConnectorError(f"Trafikverket: response was not XML: {exc}")
    err = root.find("./RESULT/ERROR")
    if err is not None:
        raise ConnectorError(f"Trafikverket: API error: {_text(err, 'MESSAGE') or 'unknown'}")

    records: list[NormalizedRecord] = []
    for node in root.findall("./RESULT/WeatherMeasurepoint"):
        station_id = _text(node, "Id")
        if not station_id:
            continue
        sample = _text(node, "Observation/Sample")
        observed_at = None
        if sample:
            try:
                observed_at = datetime.fromisoformat(sample.replace("Z", "+00:00"))
                if observed_at.tzinfo is None:
                    observed_at = observed_at.replace(tzinfo=timezone.utc)
            except ValueError:
                observed_at = None
        pt = _point(_text(node, "Geometry/WGS84"))
        records.append(
            NormalizedRecord(
                source_id=SOURCE_ID,
                dataset_id=DATASET_ID,
                feature_id=station_id,
                observed_at=observed_at,
                geometry_wkt=f"POINT({pt[0]} {pt[1]})" if pt else None,
                attributes={
                    "name": _text(node, "Name"),
                    "air_temperature_c": _num(node, "Observation/Air/Temperature/Value"),
                    "road_surface_temperature_c": _num(node, "Observation/Surface/Temperature/Value"),
                    "relative_humidity_pct": _num(node, "Observation/Air/RelativeHumidity/Value"),
                    "wind_speed_ms": _num(node, "Observation/Wind/Speed/Value"),
                    "wind_direction_deg": _num(node, "Observation/Wind/Direction/Value"),
                    "road_ice": (_text(node, "Observation/Surface/Ice") or "").lower() == "true",
                    "precipitation": _text(node, "Observation/Weather/Precipitation"),
                    "data_origin": "live",
                },
                source_url=API_URL,
                license=LICENSE_URL,
            )
        )
    return records


def fetch_records(bbox=DALARNA_BBOX) -> list[NormalizedRecord]:
    key = api_key()
    try:
        resp = requests.post(
            API_URL,
            data=build_request_xml(key, bbox).encode("utf-8"),
            headers={"Content-Type": "text/xml"},
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise ConnectorError(f"Trafikverket: request failed: {type(exc).__name__}")  # never echo URL/key
    if resp.status_code == 401:
        raise ConnectorError("Trafikverket: authentication failed (HTTP 401) - check TRAFIKVERKET_API_KEY")
    if resp.status_code != 200:
        raise ConnectorError(f"Trafikverket: HTTP {resp.status_code}")
    return parse_response(resp.text)
