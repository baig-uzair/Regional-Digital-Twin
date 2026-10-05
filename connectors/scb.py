"""SCB (Statistics Sweden) - PxWebApi v2, no authentication (mapping doc 4.2).

api.scb.se was not reachable from this dev environment's network egress, so the
request shapes below follow the official PxWebApi v2 documentation
(https://www.scb.se/en/services/open-data-api/pxwebapi/pxwebapi-2.0) rather than a
live-tested response. `verify_sources.py` is the intended way to confirm the exact
table id / variable codes against the real API and correct anything that drifted.

Rather than hardcoding a possibly-stale table id, this connector searches for a table
by keyword (SCB_TABLE_QUERY, default "Folkmängd" = population) unless SCB_TABLE_ID is
set explicitly, then reads its metadata to find the region variable and request data
filtered to Dalarna (SCB_REGION_CODE, default "20").
"""
from __future__ import annotations

import os

import requests

from .common import logger, SCB_REGION_CODE, ConnectorError, NormalizedRecord

SOURCE_ID = "SCB"
BASE_URL = "https://api.scb.se/OV0104/v2beta/api/v2"
TIMEOUT = 20
LICENSE_URL = "https://www.scb.se/en/services/open-data-api/pxwebapi/pxwebapi-2.0"
DEFAULT_QUERY = "Folkmängd"


def _resolve_table_id() -> str:
    explicit = os.environ.get("SCB_TABLE_ID", "").strip()
    if explicit:
        return explicit

    query = os.environ.get("SCB_TABLE_QUERY", DEFAULT_QUERY)
    try:
        resp = requests.get(f"{BASE_URL}/tables", params={"query": query, "pagesize": 1}, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"SCB: table search request failed: {exc}")
    if resp.status_code != 200:
        raise ConnectorError(f"SCB: table search HTTP {resp.status_code} - {resp.text[:200]}")
    payload = resp.json()
    tables = payload.get("tables") or []
    if not tables:
        raise ConnectorError(f"SCB: no table found for query {query!r}")
    return tables[0]["id"]


def _get_metadata(table_id: str) -> dict:
    try:
        resp = requests.get(f"{BASE_URL}/tables/{table_id}/metadata", timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"SCB: metadata request failed for table {table_id}: {exc}")
    if resp.status_code != 200:
        raise ConnectorError(f"SCB: metadata HTTP {resp.status_code} for table {table_id} - {resp.text[:200]}")
    return resp.json()


def _find_region_variable(metadata: dict) -> str | None:
    for var in metadata.get("variables", []):
        if var.get("type") == "RegionVariable" or "region" in (var.get("code") or "").lower():
            return var["code"]
    return None


def _get_dalarna_fallback_records(reason: str = "") -> list[NormalizedRecord]:
    """STATIC reference population values for the 15 Dalarna municipalities, used only
    when api.scb.se cannot be reached. These values were hard-coded by the project, not
    fetched, and have NOT been re-verified against SCB. Every record is tagged
    data_origin="fallback" so the dashboard labels it as fallback data, never as live.
    """
    municipalities = [
        ("2080", "Falun", 59837),
        ("2081", "Borlänge", 52166),
        ("2082", "Säter", 11215),
        ("2083", "Hedemora", 15468),
        ("2084", "Avesta", 22847),
        ("2085", "Ludvika", 26450),
        ("2061", "Smedjebacken", 10916),
        ("2021", "Vansbro", 6715),
        ("2023", "Malung-Sälen", 10210),
        ("2026", "Gagnef", 10480),
        ("2029", "Leksand", 16085),
        ("2031", "Rättvik", 11105),
        ("2034", "Orsa", 6922),
        ("2039", "Älvdalen", 7052),
        ("2062", "Mora", 20679),
    ]
    table_id = "TAB638"
    source_url = f"{BASE_URL}/tables/{table_id}/data"
    records = []
    for code, name, pop in municipalities:
        attributes = {
            "table_id": table_id,
            "value": pop,
            "region": {"code": code, "label": name},
            "indicator": "Folkmängd (Befolkning)",
            "period": "2024",
            "lan": "20 Dalarnas län",
            "data_origin": "fallback",
            "fallback_reason": reason[:300],
        }
        records.append(
            NormalizedRecord(
                source_id=SOURCE_ID,
                dataset_id=table_id,
                feature_id=f"SCB:POP:{code}",
                observed_at=None,
                attributes=attributes,
                source_url=source_url,
                license=LICENSE_URL,
            )
        )
    return records


def fetch_records(bbox=None) -> list[NormalizedRecord]:
    try:
        table_id = _resolve_table_id()
        metadata = _get_metadata(table_id)
        region_var = _find_region_variable(metadata)
        region_code = os.environ.get("SCB_REGION_CODE", SCB_REGION_CODE)

        params = {"outputformat": "json-stat2"}
        if region_var:
            params[f"valuecodes[{region_var}]"] = region_code

        data_url = f"{BASE_URL}/tables/{table_id}/data"
        resp = requests.get(data_url, params=params, timeout=TIMEOUT)
        if resp.status_code != 200:
            raise ConnectorError(f"SCB: data HTTP {resp.status_code} for table {table_id} - {resp.text[:200]}")

        payload = resp.json()
        records = _jsonstat2_to_records(table_id, payload, data_url)
        for r in records:
            r.attributes["data_origin"] = "live"
        return records
    except Exception as exc:
        logger.warning("SCB: live API unavailable (%s); returning labelled FALLBACK data", exc)
        return _get_dalarna_fallback_records("live API unreachable: " + str(exc).split(" (Caused by")[0][:140])


def _jsonstat2_to_records(table_id: str, payload: dict, source_url: str) -> list[NormalizedRecord]:
    """Flatten a JSON-stat2 cube into one NormalizedRecord per data value."""
    dimension = payload.get("dimension", {})
    dim_ids = payload.get("id", list(dimension.keys()))
    sizes = payload.get("size", [])
    values = payload.get("value", [])
    if not dim_ids or not sizes or values is None:
        raise ConnectorError(f"SCB: table {table_id} response missing expected json-stat2 fields")

    dim_labels = []
    dim_keys = []
    for dim_id in dim_ids:
        cat = dimension.get(dim_id, {}).get("category", {})
        index = cat.get("index", {})
        if isinstance(index, dict):
            ordered = sorted(index.items(), key=lambda kv: kv[1])
            keys = [k for k, _ in ordered]
        else:
            keys = list(index)
        labels = cat.get("label", {})
        dim_keys.append(keys)
        dim_labels.append(labels)

    records: list[NormalizedRecord] = []
    for flat_idx, value in enumerate(values):
        if value is None:
            continue
        coords = _unravel_index(flat_idx, sizes)
        attributes: dict = {"table_id": table_id, "value": value}
        period = None
        for dim_id, keys, labels, coord in zip(dim_ids, dim_keys, dim_labels, coords):
            if coord >= len(keys):
                continue
            key = keys[coord]
            label = labels.get(key, key)
            attributes[dim_id] = {"code": key, "label": label}
            if dim_id.lower() in ("tid", "time"):
                period = key

        records.append(
            NormalizedRecord(
                source_id=SOURCE_ID,
                dataset_id=table_id,
                feature_id=None,
                observed_at=None,
                attributes=attributes,
                source_url=source_url,
                license=LICENSE_URL,
            )
        )
        # `period` is stored as an attribute (SCB periods are like "2024" or "2024M01",
        # not full timestamps) rather than forced into observed_at's datetime type.
        if period is not None:
            attributes["period"] = period

    return records


def _unravel_index(flat_idx: int, sizes: list[int]) -> list[int]:
    coords = []
    remainder = flat_idx
    for size in reversed(sizes):
        coords.append(remainder % size)
        remainder //= size
    return list(reversed(coords))
