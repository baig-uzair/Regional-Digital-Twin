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

import json
import sys

from connector_runner import run_connector
from connectors import lantmateriet, scb, skogsstyrelsen, sgu
from connectors.common import DALARNA_BBOX

CONNECTORS = {
    "lantmateriet": (lantmateriet.fetch_records, {"bbox": DALARNA_BBOX}),
    "scb": (scb.fetch_records, {}),
    "skogsstyrelsen": (skogsstyrelsen.fetch_records, {}),
    "sgu": (sgu.fetch_records, {"bbox": DALARNA_BBOX}),
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
