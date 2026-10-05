"""The 15 Dalarna municipalities, loaded from the bundled GeoJSON (single source of truth)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

GEOJSON_PATH = Path(__file__).resolve().parent.parent / "static" / "data" / "dalarna_municipalities.geojson"


@lru_cache(maxsize=1)
def municipalities() -> list[dict]:
    data = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
    return [
        {
            "code": f["properties"]["code"],
            "name": f["properties"]["name"],
            "centroid": f["properties"]["centroid"],  # [lon, lat]
        }
        for f in data["features"]
    ]


def codes() -> set[str]:
    return {m["code"] for m in municipalities()}


def by_code(code: str) -> dict | None:
    return next((m for m in municipalities() if m["code"] == code), None)
