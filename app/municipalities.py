"""Per-municipality baselines built from stored SCB records. Nothing here is invented:
a municipality without a stored SCB value reports population = null ("no data")."""
from __future__ import annotations

from typing import Optional

from app import db, geo


def _region_of(attributes: dict, valid: set[str]) -> Optional[str]:
    """Find the municipality code in a record, whatever the SCB region variable is called."""
    for value in attributes.values():
        if isinstance(value, dict) and str(value.get("code")) in valid:
            return str(value["code"])
    return None


def populations(cur) -> dict[str, dict]:
    """{code: {value, period, origin, fetched_at}} using the newest period, then newest fetch."""
    valid = geo.codes()
    cur.execute(
        "SELECT attributes, fetched_at FROM regional_datasources WHERE source_id = 'SCB' "
        "ORDER BY fetched_at DESC LIMIT 20000"
    )
    best: dict[str, dict] = {}
    for row in cur.fetchall():
        attrs = row["attributes"] or {}
        code = _region_of(attrs, valid)
        value = attrs.get("value")
        if code is None or not isinstance(value, (int, float)):
            continue
        period = str(attrs.get("period") or "")
        cand = {
            "value": int(value),
            "period": period or None,
            # rows stored before origin tagging: the old static SCB fallback carries an "indicator" key
            "origin": attrs.get("data_origin") or ("fallback" if "indicator" in attrs else "live"),
            "fetched_at": row["fetched_at"],
        }
        cur_best = best.get(code)
        # rows arrive newest-fetch first, so only a strictly newer period replaces an earlier pick
        if cur_best is None or period > (cur_best["period"] or ""):
            best[code] = cand
    return best


def all_municipalities() -> list[dict]:
    with db.cursor() as cur:
        pops = populations(cur)
    return [{**m, "population": pops.get(m["code"])} for m in geo.municipalities()]


def one(code: str) -> Optional[dict]:
    return next((m for m in all_municipalities() if m["code"] == code), None)


def current_year(items: list[dict]) -> Optional[int]:
    """Latest real data period across municipalities (never hard-coded)."""
    years = [int(m["population"]["period"]) for m in items
             if m["population"] and (m["population"]["period"] or "").isdigit()]
    return max(years) if years else None
