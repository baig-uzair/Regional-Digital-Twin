"""Run each of the 4 new connectors once and print a Pass/Partial/Fail verification result.

Mirrors the mapping doc's section 8 "API Testing and Prototype Verification Plan" table
(Source / First test / Expected evidence / Dalarna test / Integration test / Credential
handling / Status). Run this after setting up credentials in .env, then copy the results
back into that table.

Usage:
    python verify_sources.py            # run all 4 connectors
    python verify_sources.py sgu scb    # run a subset by name
"""
from __future__ import annotations

from pathlib import Path
import json
import os
import sys

# Auto-load .env when running locally so keys set in .env are picked up
_env_file = Path(__file__).resolve().parent / ".env"
if _env_file.exists():
    for line in _env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from connector_runner import run_connector
from connectors import lantmateriet, scb, skogsstyrelsen, sgu, smhi, trafikverket
from connectors.common import DALARNA_BBOX, NormalizedRecord


def _fetch_smhi() -> list[NormalizedRecord]:
    obs = smhi.fetch_observation()
    return [
        NormalizedRecord(
            source_id="SMHI",
            dataset_id="meteorological_observations",
            feature_id=obs.entity_id,
            observed_at=obs.observed_at,
            lon=obs.lon,
            lat=obs.lat,
            geometry_wkt=f"POINT({obs.lon} {obs.lat})",
            attributes={
                "air_temperature_c": obs.temperature,
                "station": "Borlänge flygplats",
                "data_origin": "live",
            },
            source_url=smhi.URL,
            license="https://opendata.smhi.se",
        )
    ]


CONNECTORS = {
    "smhi": (_fetch_smhi, {}),
    "scb": (scb.fetch_records, {}),
    "sgu": (sgu.fetch_records, {"bbox": DALARNA_BBOX}),
    "trafikverket": (trafikverket.fetch_records, {"bbox": DALARNA_BBOX}),
    "skogsstyrelsen": (skogsstyrelsen.fetch_records, {}),
    "lantmateriet": (lantmateriet.fetch_records, {"bbox": DALARNA_BBOX}),
}

STATUS_LABEL = {
    "ok": "Pass",
    "skipped": "Partial (skipped - see evidence)",
    "error": "Fail",
}


def main() -> int:
    requested = [a.lower() for a in sys.argv[1:]] or list(CONNECTORS.keys())
    unknown = [n for n in requested if n not in CONNECTORS]
    if unknown:
        print(f"Unknown connector(s): {', '.join(unknown)}. Known: {', '.join(CONNECTORS)}")
        return 2

    exit_code = 0
    print(f"{'Source':<16} {'Status':<32} {'Duration':<10} {'Records':<8} Evidence")
    print("-" * 110)
    for name in requested:
        fetch_fn, kwargs = CONNECTORS[name]
        result = run_connector(name, fetch_fn, **kwargs)
        label = STATUS_LABEL.get(result.status, result.status)
        print(f"{name:<16} {label:<32} {result.duration_seconds:>7.2f}s  {result.record_count:<8} {result.evidence}")
        if result.sample_record is not None:
            print("  Sample record:")
            print("   ", json.dumps(result.sample_record, default=str, ensure_ascii=False)[:500])
        print()
        if result.status == "error":
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
