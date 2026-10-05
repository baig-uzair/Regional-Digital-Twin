"""Shared call -> validate -> transform -> (store) -> log runner for the 4 new connectors.

Used by both the ingestor's scheduling loop and verify_sources.py so the two never
drift apart: a connector that "works" for verify_sources.py works the same way when
the ingestor calls it on a schedule.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from connectors.common import ConnectorError, ConnectorSkipped, NormalizedRecord

logger = logging.getLogger("connector_runner")


@dataclass
class RunResult:
    name: str
    status: str  # "ok" | "skipped" | "error"
    duration_seconds: float
    record_count: int = 0
    sample_record: Optional[dict] = None
    evidence: str = ""
    records: list[NormalizedRecord] = field(default_factory=list)


def _validate(records: list[NormalizedRecord], name: str) -> None:
    for r in records:
        if not r.source_id or not r.dataset_id:
            raise ConnectorError(f"{name}: record missing required source_id/dataset_id")
        if r.attributes is None:
            raise ConnectorError(f"{name}: record missing required attributes")


def run_connector(name: str, fetch_fn: Callable[..., list[NormalizedRecord]], *args, **kwargs) -> RunResult:
    start = time.monotonic()
    try:
        records = fetch_fn(*args, **kwargs)
        _validate(records, name)
        duration = time.monotonic() - start
        sample = None
        if records:
            r = records[0]
            sample = {
                "source_id": r.source_id,
                "dataset_id": r.dataset_id,
                "feature_id": r.feature_id,
                "attributes": r.attributes,
            }
        logger.info(
            "[%s] status=ok duration=%.2fs records=%d",
            name, duration, len(records),
        )
        return RunResult(
            name=name,
            status="ok",
            duration_seconds=duration,
            record_count=len(records),
            sample_record=sample,
            evidence=f"{len(records)} record(s) retrieved and validated",
            records=records,
        )
    except ConnectorSkipped as exc:
        duration = time.monotonic() - start
        logger.warning("[%s] status=skipped duration=%.2fs reason=%s", name, duration, exc)
        return RunResult(name=name, status="skipped", duration_seconds=duration, evidence=str(exc))
    except ConnectorError as exc:
        duration = time.monotonic() - start
        logger.error("[%s] status=error duration=%.2fs reason=%s", name, duration, exc)
        return RunResult(name=name, status="error", duration_seconds=duration, evidence=str(exc))
    except Exception as exc:  # noqa: BLE001 - a connector must never crash the ingestor loop
        duration = time.monotonic() - start
        logger.error("[%s] status=error duration=%.2fs reason=unexpected:%s", name, duration, exc)
        return RunResult(name=name, status="error", duration_seconds=duration, evidence=f"unexpected error: {exc}")
