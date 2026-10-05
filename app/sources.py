"""Source registry reads, honest status computation and per-source headline metrics."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from app import db
from app.scheduler import missing_config
from connectors import smhi

# Records written by an earlier prototype fallback that returned hand-made geometry/statistics
# instead of real API data. They stay in the table (history is never deleted) but are never
# shown, counted or used by the simulation.
LEGACY_FABRICATED_FEATURES = [
    "LM:DALARNA:BORLANGE:ADM",
    "LM:DALARNA:FALUN:ADM",
    "skogsstyrelsen.dalarna.falun.aoi1",
]
NOT_FABRICATED = "(feature_id IS NULL OR feature_id <> ALL(%s))"

STATUS_LABELS = {
    "online": "Online",
    "stale": "Stale",
    "error": "Error",
    "not_configured": "Not configured",
    "disabled": "Disabled",
    "fallback": "Fallback data",
    "pending": "Waiting for first fetch",
}


def compute_status(
    src: dict,
    last_attempt: Optional[dict],
    last_success: Optional[dict],
    now: datetime,
    missing: list[str],
) -> tuple[str, str]:
    """Return (status, message). Pure function: never claims 'online' without a fresh real success."""
    if not src["enabled"]:
        return "disabled", "Turned off by an administrator. Stored data is kept."
    if missing:
        return "not_configured", "Missing configuration: " + ", ".join(missing)
    if last_attempt is None:
        return "pending", "No fetch has completed yet."
    if last_attempt["status"] == "skipped":
        return "not_configured", last_attempt.get("message") or "Connector skipped"
    if last_attempt["status"] == "error":
        return "error", last_attempt.get("message") or "Last fetch failed"
    if last_success is None:
        return "pending", "No successful fetch yet."
    age = (now - last_success["started_at"]).total_seconds()
    if last_attempt["status"] == "fallback":
        return "fallback", last_attempt.get("message") or "Showing fallback data, not fetched live."
    if age > src["freshness_seconds"]:
        return "stale", f"Data may be outdated. Last update: {last_success['started_at'].isoformat()}"
    return "online", "Last fetch succeeded."


def _runs_by_source(cur) -> tuple[dict, dict]:
    cur.execute(
        """
        SELECT DISTINCT ON (source_id) source_id, started_at, status, data_origin, record_count, stored_count, message, trigger
        FROM source_runs WHERE trigger <> 'test' ORDER BY source_id, started_at DESC
        """
    )
    attempts = {r["source_id"]: r for r in cur.fetchall()}
    cur.execute(
        """
        SELECT DISTINCT ON (source_id) source_id, started_at, data_origin, record_count
        FROM source_runs WHERE trigger <> 'test' AND status IN ('ok', 'fallback')
        ORDER BY source_id, started_at DESC
        """
    )
    successes = {r["source_id"]: r for r in cur.fetchall()}
    return attempts, successes


def _headline(cur, src: dict, counts: dict) -> Optional[dict]:
    """Small real-data summary for a card; None when there is no stored data."""
    sid = src["id"]
    if sid == "smhi":
        cur.execute(
            "SELECT time, temperature FROM regional_telemetry WHERE entity_id = %s ORDER BY time DESC LIMIT 1",
            (smhi.ENTITY_ID,),
        )
        row = cur.fetchone()
        return {"temperature_c": row["temperature"], "observed_at": row["time"]} if row else None
    rec_id = (src.get("config") or {}).get("record_source_id")
    c = counts.get(rec_id)
    if not c:
        return None
    if sid == "trafikverket":
        return {"stations": c["n"], "latest_fetch": c["latest"]}
    if sid == "scb":
        from app import municipalities

        pops = municipalities.populations(cur)
        if pops:
            vals = [p for p in pops.values()]
            return {
                "population_total": sum(p["value"] for p in vals),
                "municipalities": len(vals),
                "period": max(p["period"] for p in vals if p["period"]) if any(p["period"] for p in vals) else None,
                "origin": "fallback" if any(p["origin"] == "fallback" for p in vals) else "live",
            }
        return None
    return {"records": c["n"], "latest_fetch": c["latest"]}


def _counts(cur) -> dict:
    cur.execute(
        f"SELECT source_id, count(*) AS n, max(fetched_at) AS latest FROM regional_datasources WHERE {NOT_FABRICATED} GROUP BY source_id",
        (LEGACY_FABRICATED_FEATURES,),
    )
    return {r["source_id"]: r for r in cur.fetchall()}


def registry_rows(cur) -> list[dict]:
    cur.execute("SELECT * FROM source_registry ORDER BY sort_order, id")
    return cur.fetchall()


def summary() -> dict:
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        rows = registry_rows(cur)
        attempts, successes = _runs_by_source(cur)
        counts = _counts(cur)
        out = []
        for src in rows:
            missing = missing_config(src["auth_env_vars"] or [])
            la, ls = attempts.get(src["id"]), successes.get(src["id"])
            status, message = compute_status(src, la, ls, now, missing)
            out.append(
                {
                    "id": src["id"],
                    "name": src["name"],
                    "category": src["category"],
                    "description": src["description"],
                    "enabled": src["enabled"],
                    "interval_seconds": src["interval_seconds"],
                    "freshness_seconds": src["freshness_seconds"],
                    "map_layer": src["map_layer"],
                    "status": status,
                    "status_label": STATUS_LABELS[status],
                    "message": message,
                    "missing_config": missing,  # names of unset variables, never values
                    "last_attempt_at": la["started_at"] if la else None,
                    "last_success_at": ls["started_at"] if ls else None,
                    "last_error": la["message"] if la and la["status"] == "error" else None,
                    "data_origin": (la or {}).get("data_origin"),
                    "headline": _headline(cur, src, counts) if status not in ("not_configured",) else None,
                }
            )
    online = sum(1 for s in out if s["status"] == "online")
    successes_at = [s["last_success_at"] for s in out if s["last_success_at"]]
    return {
        "sources": out,
        "online_count": online,
        "total": len(out),
        "last_update": max(successes_at) if successes_at else None,
        "generated_at": now,
    }


def features_geojson(source_key: str) -> dict:
    """GeoJSON for a source's stored geometry (existing /api/datasources contract)."""
    fc: dict = {"type": "FeatureCollection", "features": []}
    with db.cursor() as cur:
        if source_key.upper() == "SMHI":
            cur.execute(
                "SELECT time, temperature, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM regional_telemetry "
                "WHERE entity_id = %s ORDER BY time DESC LIMIT 1",
                (smhi.ENTITY_ID,),
            )
            r = cur.fetchone()
            if r:
                fc["features"].append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
                        "properties": {
                            "source_id": "SMHI",
                            "feature_id": smhi.ENTITY_ID,
                            "observed_at": r["time"].isoformat(),
                            "attributes": {"air_temperature_c": r["temperature"]},
                        },
                    }
                )
            return fc
        sql = """
            SELECT DISTINCT ON (dataset_id, feature_id, observed_at)
                   source_id, dataset_id, feature_id, observed_at,
                   ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0005), 5) AS geom_json,
                   attributes, fetched_at, source_url, license
            FROM regional_datasources
            WHERE geom IS NOT NULL AND lower(source_id) = lower(%s) AND """ + NOT_FABRICATED + """
            ORDER BY dataset_id, feature_id, observed_at, fetched_at DESC
            LIMIT 2000
        """
        cur.execute(sql, (source_key, LEGACY_FABRICATED_FEATURES))
        for r in cur.fetchall():
            if not r["geom_json"]:
                continue
            fc["features"].append(
                {
                    "type": "Feature",
                    "geometry": json.loads(r["geom_json"]),
                    "properties": {
                        "source_id": r["source_id"],
                        "dataset_id": r["dataset_id"],
                        "feature_id": r["feature_id"],
                        "observed_at": r["observed_at"].isoformat() if r["observed_at"] else None,
                        "attributes": r["attributes"],
                        "fetched_at": r["fetched_at"].isoformat() if r["fetched_at"] else None,
                        "source_url": r["source_url"],
                        "license": r["license"],
                    },
                }
            )
    return fc
