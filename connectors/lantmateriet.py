"""Lantmäteriet - National Geodata Platform (NGP), STAC / OGC API Features (mapping doc 4.1).

Per the mapping doc, "access conditions vary by dataset/service, so the exact selected
dataset must be checked before implementation." Confirmed while building this connector:
Lantmäteriet publishes its NGP APIs through an Azure/WSO2-style developer portal
(apimanager.lantmateriet.se), where a product must be selected and subscribed to
individually to obtain an API key - there is no single open base URL to hardcode.

This connector is therefore built against the generic OGC API Features shape (the
pattern NGP's technical description says its search API follows) with the product's
base URL, collection and auth header configurable via environment variables, so
picking the actual registered product is a config change, not a code change:
  LANTMATERIET_BASE_URL      e.g. https://api.lantmateriet.se/ogc-features/v1/<product>
  LANTMATERIET_COLLECTION    the OGC API Features collection id for that product
  LANTMATERIET_API_KEY       subscription key issued for that product
"""
from __future__ import annotations

import os
from typing import Optional

import requests

from .common import ConnectorError, ConnectorSkipped, NormalizedRecord

SOURCE_ID = "Lantmateriet"
TIMEOUT = 20
DOC_URL = "https://www2.lantmateriet.se/sv/nationella-geodataplattformen/arkitektur/teknisk-beskrivning-av-ngp/"


def _get_config() -> tuple[str, str, str]:
    base_url = os.environ.get("LANTMATERIET_BASE_URL", "").strip().rstrip("/")
    collection = os.environ.get("LANTMATERIET_COLLECTION", "").strip()
    api_key = os.environ.get("LANTMATERIET_API_KEY", "").strip()

    if not api_key:
        raise ConnectorSkipped("Lantmateriet: LANTMATERIET_API_KEY not set, skipping")
    if not base_url or not collection:
        raise ConnectorSkipped(
            "Lantmateriet: LANTMATERIET_BASE_URL/LANTMATERIET_COLLECTION not set "
            "(register a product at apimanager.lantmateriet.se first), skipping"
        )
    return base_url, collection, api_key


def fetch_records(bbox, limit: int = 200) -> list[NormalizedRecord]:
    base_url, collection, api_key = _get_config()  # raises ConnectorSkipped -> "Not configured"

    url = f"{base_url}/collections/{collection}/items"
    params = {
        "bbox": ",".join(str(v) for v in bbox),
        "f": "application/json",
        "limit": limit,
    }
    headers = {"Ocp-Apim-Subscription-Key": api_key}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"Lantmateriet: request failed: {exc}")
    if resp.status_code != 200:
        raise ConnectorError(f"Lantmateriet: HTTP {resp.status_code} from {url} - {resp.text[:200]}")

    try:
        payload = resp.json()
    except ValueError as exc:
        raise ConnectorError(f"Lantmateriet: response was not JSON: {exc}")

    features = payload.get("features")
    if features is None:
        raise ConnectorError("Lantmateriet: response missing 'features' field")

    records: list[NormalizedRecord] = []
    for feat in features:
        geom = feat.get("geometry")
        props = feat.get("properties", {}) or {}
        records.append(
            NormalizedRecord(
                source_id=SOURCE_ID,
                dataset_id=collection,
                feature_id=str(feat.get("id")) if feat.get("id") is not None else None,
                attributes=props,
                geometry_wkt=_geojson_geometry_to_wkt(geom) if geom else None,
                source_url=url,
                license=DOC_URL,
            )
        )
    return records


def _geojson_geometry_to_wkt(geom: dict) -> Optional[str]:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Point":
        x, y = coords[0], coords[1]
        return f"POINT({x} {y})"
    if gtype == "Polygon":
        rings = ", ".join("(" + ", ".join(f"{x} {y}" for x, y in ring) + ")" for ring in coords)
        return f"POLYGON({rings})"
    if gtype == "MultiPolygon":
        polys = ", ".join(
            "(" + ", ".join("(" + ", ".join(f"{x} {y}" for x, y in ring) + ")" for ring in poly) + ")"
            for poly in coords
        )
        return f"MULTIPOLYGON({polys})"
    return None
