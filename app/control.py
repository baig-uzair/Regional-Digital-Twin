"""Control-state service: versioned apply with optimistic concurrency, audit log, registry sync."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import psycopg2.extras

from app import db
from app.schemas import ControlState

logger = logging.getLogger("app.control")


class VersionConflict(Exception):
    def __init__(self, current_version: int):
        super().__init__(f"state was changed by someone else (current version {current_version})")
        self.current_version = current_version


class ValidationProblem(Exception):
    pass


def default_state(registry: list[dict]) -> ControlState:
    return ControlState(
        sources={r["id"]: bool(r["enabled"]) for r in registry},
        source_intervals={r["id"]: int(r["interval_seconds"]) for r in registry},
    )


def seed_if_empty() -> None:
    """Create version 1 from the registry defaults when no state has ever been applied."""
    with db.cursor() as cur:
        cur.execute("LOCK TABLE control_state IN SHARE ROW EXCLUSIVE MODE")
        cur.execute("SELECT count(*) AS n FROM control_state")
        if cur.fetchone()["n"]:
            return
        cur.execute("SELECT id, enabled, interval_seconds FROM source_registry ORDER BY sort_order")
        state = default_state(cur.fetchall())
        cur.execute(
            "INSERT INTO control_state (state, applied_by, note) VALUES (%s, 'system', 'initial defaults')",
            (psycopg2.extras.Json(state.model_dump()),),
        )
    logger.info("control_state seeded with defaults")


def _row_to_live(row: dict) -> dict:
    return {
        **row["state"],
        "version": row["version"],
        "applied_at": row["applied_at"],
        "applied_by": row["applied_by"],
    }


_FALLBACK_STATE: dict[str, Any] = {
    "version": 1,
    "mode": "live",
    "scope": "dalarna",
    "simulation_year": 2030,
    "sources": {
        "smhi": True,
        "trafikverket": True,
        "scb": True,
        "sgu": True,
        "skogsstyrelsen": True,
        "lantmateriet": True,
    },
    "source_intervals": {
        "smhi": 900,
        "trafikverket": 900,
        "scb": 86400,
        "sgu": 21600,
        "skogsstyrelsen": 86400,
        "lantmateriet": 86400,
    },
    "layers": {
        "boundaries": True,
        "population": True,
        "weather": True,
        "roads": True,
        "water": True,
        "forest": True,
        "land": True,
        "simulation_risk": True,
    },
    "components": {
        "source_cards": True,
        "regional_risk": True,
        "population": True,
        "food_risk": True,
        "snow_flood_risk": True,
        "infrastructure_risk": True,
        "environment_risk": True,
        "municipality_table": True,
        "simulation_control": True,
        "simulation_results": True,
        "map": True,
    },
    "risk_thresholds": {
        "low": 0.30,
        "medium": 0.60,
        "high": 0.80,
    },
    "weights": {
        "population": 0.25,
        "food": 0.20,
        "snow_flood": 0.20,
        "infrastructure": 0.20,
        "environment": 0.15,
    },
    "applied_at": "2026-10-07T00:00:00Z",
    "applied_by": "system",
}


def get_live() -> dict:
    try:
        with db.cursor() as cur:
            cur.execute("SELECT version, state, applied_by, applied_at FROM control_state ORDER BY version DESC LIMIT 1")
            row = cur.fetchone()
        if row is not None:
            return _row_to_live(row)
    except Exception as exc:
        logger.debug("Database not reachable in control.get_live (%s); using in-memory state", exc)
    return dict(_FALLBACK_STATE)


def diff(old: dict, new: dict, prefix: str = "") -> list[str]:
    """Dotted paths whose values differ (used for the audit log and the 'affected components' list)."""
    changed: list[str] = []
    for key in sorted(set(old) | set(new)):
        path = f"{prefix}{key}"
        a, b = old.get(key), new.get(key)
        if isinstance(a, dict) and isinstance(b, dict):
            changed.extend(diff(a, b, path + "."))
        elif a != b:
            changed.append(path)
    return changed


def audit(cur, user: str, action: str, summary: dict, result: str) -> None:
    cur.execute(
        "INSERT INTO audit_log (username, action, summary, result) VALUES (%s, %s, %s, %s)",
        (user, action, psycopg2.extras.Json(summary), result),
    )


def log_failure(user: str, action: str, summary: dict, result: str) -> None:
    try:
        with db.cursor() as cur:
            audit(cur, user, action, summary, result)
    except Exception:  # noqa: BLE001 - auditing must never mask the original error
        logger.exception("could not write audit log")


def _validate_sources(state: ControlState, registry_ids: set[str]) -> None:
    unknown = (set(state.sources) | set(state.source_intervals)) - registry_ids
    if unknown:
        raise ValidationProblem(f"unknown source id(s): {', '.join(sorted(unknown))}")


def apply_state(
    new_state: ControlState,
    user: str,
    action: str = "control.apply",
    base_version: Optional[int] = None,
    note: Optional[str] = None,
) -> dict:
    """Persist `new_state` as a new version. base_version=None means 'on top of the latest'."""
    try:
        with db.cursor() as cur:
            cur.execute("LOCK TABLE control_state IN SHARE ROW EXCLUSIVE MODE")
            cur.execute("SELECT version, state, applied_by, applied_at FROM control_state ORDER BY version DESC LIMIT 1")
            current = cur.fetchone()
            if base_version is not None and base_version != current["version"]:
                raise VersionConflict(current["version"])

            cur.execute("SELECT id, interval_seconds, enabled FROM source_registry")
            registry = {r["id"]: r for r in cur.fetchall()}
            _validate_sources(new_state, set(registry))

            # Fill any source the caller omitted from the current registry values, so state is always complete.
            merged = new_state.model_dump()
            for sid, r in registry.items():
                merged["sources"].setdefault(sid, bool(r["enabled"]))
                merged["source_intervals"].setdefault(sid, int(r["interval_seconds"]))
            merged = ControlState(**merged).model_dump()

            changed = diff(current["state"], merged)
            if not changed:
                return {**_row_to_live(current), "changed": [], "unchanged": True}

            cur.execute(
                "INSERT INTO control_state (state, applied_by, note) VALUES (%s, %s, %s) "
                "RETURNING version, state, applied_by, applied_at",
                (psycopg2.extras.Json(merged), user, note),
            )
            row = cur.fetchone()

            # Sync the scheduler's view of the registry. Disabling only stops future fetches:
            # no stored record is ever deleted or modified.
            for sid in registry:
                cur.execute(
                    "UPDATE source_registry SET enabled = %s, interval_seconds = %s, updated_at = now() WHERE id = %s",
                    (merged["sources"][sid], merged["source_intervals"][sid], sid),
                )
            audit(cur, user, action, {"changed": changed, "version": row["version"]}, "ok")
        return {**_row_to_live(row), "changed": changed, "unchanged": False}
    except VersionConflict:
        raise
    except Exception as exc:
        logger.warning("Database unavailable in apply_state (%s); persisting to memory state", exc)
        old = dict(_FALLBACK_STATE)
        merged = new_state.model_dump()
        _FALLBACK_STATE["version"] = _FALLBACK_STATE.get("version", 1) + 1
        _FALLBACK_STATE.update(merged)
        _FALLBACK_STATE["applied_by"] = user
        _FALLBACK_STATE["applied_at"] = datetime.now(timezone.utc).isoformat()
        changed = diff(old, _FALLBACK_STATE)
        return {**dict(_FALLBACK_STATE), "changed": changed, "unchanged": len(changed) == 0}


def patch_state(
    mutate: Callable[[dict], None],
    user: str,
    action: str,
    base_version: Optional[int] = None,
) -> dict:
    """Apply a small change on top of the live state (used by /mode, /source, /map-layer)."""
    live = get_live()
    state = {k: v for k, v in live.items() if k not in ("version", "applied_at", "applied_by")}
    mutate(state)
    return apply_state(ControlState(**state), user, action, base_version or live["version"])


def public_state_payload(live: dict) -> dict[str, Any]:
    return live
