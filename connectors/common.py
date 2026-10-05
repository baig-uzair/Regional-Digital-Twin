"""Shared contract for the regional-datasource connectors (mapping doc section 7.1/10).

Each connector module (lantmateriet.py, scb.py, skogsstyrelsen.py, sgu.py) exposes a
single `fetch_records(bbox=DALARNA_BBOX) -> list[NormalizedRecord]` function. Auth and
HTTP handling stay inside each connector; only the normalized output crosses this
boundary, so the ingestor/validation/storage layers never depend on a source's own
request shape (per the "connector -> validation -> transformation -> store" layering).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("connectors")

# Approximate WGS84 bounding box for Dalarna county (Dalarnas lan): (min_lon, min_lat, max_lon, max_lat).
# National datasets are filtered to this box. It is intentionally generous (covers the
# whole county envelope, not a tight boundary) since a precise administrative boundary
# would itself have to come from Lantmaeteriet - verify/tighten with real municipality
# geometries once that connector is confirmed working.
DALARNA_BBOX = (12.0, 59.85, 16.95, 62.05)

# Dalarnas lan SCB region code, used to filter PxWebApi v2 queries.
SCB_REGION_CODE = "20"


@dataclass
class NormalizedRecord:
    """Common internal model per mapping doc section 7.1."""

    source_id: str
    dataset_id: str
    attributes: dict[str, Any]
    feature_id: Optional[str] = None
    observed_at: Optional[datetime] = None
    lon: Optional[float] = None
    lat: Optional[float] = None
    geometry_wkt: Optional[str] = None  # set instead of lon/lat for non-point geometry, always WGS84/4326
    source_url: Optional[str] = None
    license: Optional[str] = None
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class ConnectorError(Exception):
    """Raised when a connector reaches the API but gets an unusable/unexpected response."""


class ConnectorSkipped(Exception):
    """Raised when a connector cannot run at all, e.g. missing credentials/registration."""
