"""SGU (Geological Survey of Sweden) - OGC API Features, open access (mapping doc 4.4).

Verified live against the real API while building this connector:
  GET https://api.sgu.se/oppnadata/{collection}/ogc/features/v1/collections/{name}/items
      ?bbox=<minlon,minlat,maxlon,maxlat>&f=application/json&limit=...
returns a standard GeoJSON FeatureCollection. No authentication required.
"""
from __future__ import annotations

from typing import Optional

import requests

from .common import DALARNA_BBOX, ConnectorError, NormalizedRecord, logger

SOURCE_ID = "SGU"
TIMEOUT = 20
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/deed.sv"

# dataset_id -> (OGC API "product" path segment, collection id). Collection ids
# confirmed live against /collections on each product (they don't always match the
# product path segment - e.g. the observed-levels product exposes "nivaer"/"stationer").
#
# Finding from live testing (see mapping doc section 8 status table): the "nivaer"
# (observation values) collection has geometry=null on every feature and does not
# support bbox, property-value or sortby filtering (confirmed: bbox raises 400
# "Illegal property name", platsbeteckning=/sortby= are silently ignored) - a
# ~9.75M-row unfiltered table, so it cannot be feasibly or correctly limited to
# Dalarna here. We instead pull "stationer" (the station metadata collection for that
# same product), which DOES carry point geometry and DOES support bbox, as the
# Dalarna-filterable groundwater-levels layer; each station's attributes already
# include its own last reference level (refniva) and site metadata.
COLLECTIONS = {
    "groundwater_bodies": ("grundvattenforekomster", "grundvattenforekomster"),
    "groundwater_level_stations": ("grundvattennivaer-observerade", "stationer"),
}

BASE_URL = "https://api.sgu.se/oppnadata"


def _items_url(product: str, collection: str) -> str:
    return f"{BASE_URL}/{product}/ogc/features/v1/collections/{collection}/items"


def _fetch_collection(dataset_id: str, product: str, collection: str, bbox, limit: int) -> list[NormalizedRecord]:
    url = _items_url(product, collection)
    params = {
        "bbox": ",".join(str(v) for v in bbox),
        "f": "application/json",
        "limit": limit,
    }
    try:
        resp = requests.get(url, params=params, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"SGU {dataset_id}: request failed: {exc}")
    if resp.status_code != 200:
        raise ConnectorError(f"SGU {dataset_id}: HTTP {resp.status_code} - {resp.text[:200]}")

    try:
        payload = resp.json()
    except ValueError as exc:
        raise ConnectorError(f"SGU {dataset_id}: response was not JSON: {exc}")

    features = payload.get("features")
    if features is None:
        raise ConnectorError(f"SGU {dataset_id}: response missing 'features' field")

    records: list[NormalizedRecord] = []
    for feat in features:
        geom = feat.get("geometry")
        props = feat.get("properties", {}) or {}
        records.append(
            NormalizedRecord(
                source_id=SOURCE_ID,
                dataset_id=dataset_id,
                feature_id=str(feat.get("id")) if feat.get("id") is not None else None,
                attributes=props,
                geometry_wkt=_geojson_geometry_to_wkt(geom) if geom else None,
                source_url=url,
                license=LICENSE_URL,
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
    logger.warning("SGU: unsupported geometry type %s, storing without geometry", gtype)
    return None


def fetch_records(bbox=DALARNA_BBOX, limit: int = 200) -> list[NormalizedRecord]:
    records: list[NormalizedRecord] = []
    errors: list[str] = []
    for dataset_id, (product, collection) in COLLECTIONS.items():
        try:
            records.extend(_fetch_collection(dataset_id, product, collection, bbox, limit))
        except ConnectorError as exc:
            logger.error("SGU: collection %s failed: %s", dataset_id, exc)
            errors.append(str(exc))

    if not records and errors:
        raise ConnectorError("; ".join(errors))
    return records
