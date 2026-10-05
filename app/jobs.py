"""Connector jobs: run one source, store its data, and record the outcome in source_runs.

A job never invents data. On any failure nothing is written to the data tables and the
error is recorded so the source card can show Error/Stale with the last real timestamp.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Optional

import requests

import datasource_store
from app import config, db
from connector_runner import run_connector
from connectors import lantmateriet, scb, sgu, skogsstyrelsen, smhi, trafikverket
from connectors.common import DALARNA_BBOX, ConnectorError, ConnectorSkipped

logger = logging.getLogger("app.jobs")


@dataclass
class JobResult:
    status: str  # ok | fallback | skipped | error
    message: str = ""
    record_count: int = 0
    stored_count: int = 0
    data_origin: Optional[str] = None
    duration_ms: int = 0


# --- connector implementations -------------------------------------------------------------

_ORION_LINK = '<https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'


def _mirror_to_orion(obs: smhi.Observation) -> None:
    """Best-effort NGSI-LD mirror (Orion-LD stays as before). Failures never fail the SMHI run."""
    base = config.orion_url()
    try:
        r = requests.patch(
            f"{base}/{obs.entity_id}/attrs/temperature",
            headers={"Content-Type": "application/json", "Link": _ORION_LINK},
            data=json.dumps({"type": "Property", "value": obs.temperature}),
            timeout=3,
        )
        if r.status_code == 404:
            requests.post(
                base,
                headers={"Content-Type": "application/ld+json"},
                data=json.dumps(
                    {
                        "id": obs.entity_id,
                        "type": "WeatherObserved",
                        "location": {"type": "GeoProperty", "value": {"type": "Point", "coordinates": [obs.lon, obs.lat]}},
                        "temperature": {"type": "Property", "value": obs.temperature, "unitCode": "CEL"},
                        "@context": ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"],
                    }
                ),
                timeout=3,
            )
    except requests.RequestException as exc:
        logger.warning("Orion-LD mirror skipped: %s", exc)


def _job_smhi() -> JobResult:
    obs = smhi.fetch_observation()  # raises ConnectorError; nothing is written on failure
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO regional_telemetry (time, entity_id, temperature, geom)
            SELECT %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)
            WHERE NOT EXISTS (SELECT 1 FROM regional_telemetry WHERE entity_id = %s AND time = %s)
            """,
            (obs.observed_at, obs.entity_id, obs.temperature, obs.lon, obs.lat, obs.entity_id, obs.observed_at),
        )
        stored = cur.rowcount
    _mirror_to_orion(obs)
    return JobResult("ok", f"temperature {obs.temperature} C observed {obs.observed_at.isoformat()}", 1, stored, "live")


def _regional(name: str, module, **kwargs) -> Callable[[], JobResult]:
    def job() -> JobResult:
        result = run_connector(name, module.fetch_records, **kwargs)
        if result.status == "skipped":
            return JobResult("skipped", result.evidence)
        if result.status == "error":
            return JobResult("error", result.evidence)
        origins = {r.attributes.get("data_origin", "live") for r in result.records}
        origin = "fallback" if "fallback" in origins else "live"
        stored = datasource_store.upsert_records(result.records)
        msg = result.evidence
        if origin == "fallback":
            reason = next((r.attributes.get("fallback_reason") for r in result.records if r.attributes.get("fallback_reason")), "")
            msg = f"FALLBACK data (not fetched live): {reason}"[:400]
        return JobResult("fallback" if origin == "fallback" else "ok", msg, result.record_count, stored, origin)

    return job


CONNECTORS: dict[str, Callable[[], JobResult]] = {
    "smhi": _job_smhi,
    "trafikverket": _regional("Trafikverket", trafikverket, bbox=DALARNA_BBOX),
    "scb": _regional("SCB", scb),
    "sgu": _regional("SGU", sgu, bbox=DALARNA_BBOX),
    "skogsstyrelsen": _regional("Skogsstyrelsen", skogsstyrelsen),
    "lantmateriet": _regional("Lantmateriet", lantmateriet, bbox=DALARNA_BBOX),
}

# --- execution ---------------------------------------------------------------------------

_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)


def record_run(source_id: str, trigger: str, started_at, res: JobResult) -> None:
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO source_runs (source_id, trigger, started_at, duration_ms, status, data_origin,
                                     record_count, stored_count, message)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (source_id, trigger, started_at, res.duration_ms, res.status, res.data_origin,
             res.record_count, res.stored_count, (res.message or "")[:1000]),
        )


def run_source(source_id: str, connector_key: str, trigger: str = "schedule") -> JobResult:
    """Run one source now. Returns status 'busy' if a run for it is already in progress."""
    job = CONNECTORS.get(connector_key)
    if job is None:
        return JobResult("error", f"no connector registered for '{connector_key}'")
    lock = _locks[source_id]
    if not lock.acquire(blocking=False):
        return JobResult("busy", "a run for this source is already in progress")
    started = time.time()
    from datetime import datetime, timezone

    started_at = datetime.fromtimestamp(started, tz=timezone.utc)
    try:
        try:
            res = job()
        except ConnectorSkipped as exc:
            res = JobResult("skipped", str(exc))
        except ConnectorError as exc:
            res = JobResult("error", str(exc))
        except Exception as exc:  # noqa: BLE001 - a job must never take the scheduler down
            logger.exception("job %s crashed", source_id)
            res = JobResult("error", f"unexpected error: {type(exc).__name__}: {exc}")
        res.duration_ms = int((time.time() - started) * 1000)
        try:
            record_run(source_id, trigger, started_at, res)
        except Exception:  # noqa: BLE001
            logger.exception("could not record run for %s", source_id)
        logger.info("[%s] %s (%s) %s", source_id, res.status, trigger, res.message[:120])
        return res
    finally:
        lock.release()
