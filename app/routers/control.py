from fastapi import APIRouter, Depends

from app import auth, control, db, geo
from app.scheduler import missing_config
from app.schemas import (
    ApplyRequest,
    ComponentToggleRequest,
    ImportConfigRequest,
    MapLayerRequest,
    ModeRequest,
    RegisterSourceRequest,
    ScopeRequest,
    SourceActionRequest,
    SourceToggleRequest,
)

router = APIRouter(prefix="/api/control", tags=["control"])

LAYER_IDS = ("boundaries", "population", "weather", "roads", "water", "forest", "land", "simulation_risk")
COMPONENT_IDS = (
    "source_cards",
    "regional_risk",
    "population",
    "food_risk",
    "snow_flood_risk",
    "infrastructure_risk",
    "environment_risk",
    "municipality_table",
    "simulation_control",
    "simulation_results",
    "map",
)


@router.get("/state")
def get_state():
    """Complete saved dashboard/control state (public read: the Main Interface polls this)."""
    return control.get_live()


@router.post("/apply")
def apply(body: ApplyRequest, user: str = Depends(auth.require_admin)):
    try:
        return control.apply_state(body.state, user, "control.apply", body.base_version, body.note)
    except control.VersionConflict:
        control.log_failure(user, "control.apply", {"base_version": body.base_version}, "conflict")
        raise


@router.post("/mode")
def set_mode(body: ModeRequest, user: str = Depends(auth.require_admin)):
    def mutate(state: dict) -> None:
        state["mode"] = body.mode
        if body.mode == "simulation" and body.year is not None:
            state["simulation_year"] = body.year

    return control.patch_state(mutate, user, "control.mode", body.base_version)


@router.post("/source")
def set_source(body: SourceToggleRequest, user: str = Depends(auth.require_admin)):
    def mutate(state: dict) -> None:
        state["sources"][body.source] = body.enabled  # unknown ids are rejected by apply_state

    return control.patch_state(mutate, user, "control.source", body.base_version)


@router.post("/map-layer")
def set_map_layer(body: MapLayerRequest, user: str = Depends(auth.require_admin)):
    def mutate(state: dict) -> None:
        if body.layer not in LAYER_IDS:
            raise control.ValidationProblem(f"unknown layer '{body.layer}'")
        state["layers"][body.layer] = body.visible

    return control.patch_state(mutate, user, "control.map_layer", body.base_version)


@router.post("/scope")
def set_scope(body: ScopeRequest, user: str = Depends(auth.require_admin)):
    def mutate(state: dict) -> None:
        if body.scope != "dalarna" and body.scope not in geo.codes():
            raise control.ValidationProblem(f"unknown scope '{body.scope}'")
        state["scope"] = body.scope

    return control.patch_state(mutate, user, "control.scope", body.base_version)


@router.post("/component")
def set_component(body: ComponentToggleRequest, user: str = Depends(auth.require_admin)):
    def mutate(state: dict) -> None:
        if body.component not in COMPONENT_IDS:
            raise control.ValidationProblem(f"unknown component '{body.component}'")
        state["components"][body.component] = body.visible

    return control.patch_state(mutate, user, "control.component", body.base_version)


@router.get("/map-state")
def map_state():
    """Layer visibility plus whether each layer's feeding source is currently enabled."""
    live = control.get_live()
    try:
        with db.cursor() as cur:
            cur.execute("SELECT id, map_layer, auth_env_vars FROM source_registry WHERE map_layer IS NOT NULL")
            rows = cur.fetchall()
    except Exception:
        rows = [
            {"id": "smhi", "map_layer": "weather", "auth_env_vars": []},
            {"id": "trafikverket", "map_layer": "roads", "auth_env_vars": ["TRAFIKVERKET_API_KEY"]},
            {"id": "scb", "map_layer": "population", "auth_env_vars": []},
            {"id": "sgu", "map_layer": "water", "auth_env_vars": []},
            {"id": "skogsstyrelsen", "map_layer": "forest", "auth_env_vars": ["SKOGSSTYRELSEN_CLIENT_ID", "SKOGSSTYRELSEN_CLIENT_SECRET"]},
            {"id": "lantmateriet", "map_layer": "land", "auth_env_vars": ["LANTMATERIET_API_KEY"]},
        ]
    feeders = {r["map_layer"]: r["id"] for r in rows}
    unconfigured = {r["id"] for r in rows if missing_config(r["auth_env_vars"] or [])}
    layers = {}
    for layer in LAYER_IDS:
        feeder = feeders.get(layer)
        if layer == "boundaries":
            available, reason = True, None
        elif layer == "simulation_risk":
            available, reason = live["mode"] == "simulation", "Only available in simulation mode"
            reason = None if available else reason
        else:
            enabled = bool(feeder and live["sources"].get(feeder, False))
            available = enabled and feeder not in unconfigured
            reason = None if available else ("Source is not configured" if enabled else "Source is turned off")
        layers[layer] = {"visible": live["layers"].get(layer, False), "available": available, "source": feeder, "reason": reason}
    return {"version": live["version"], "scope": live["scope"], "layers": layers}


@router.post("/source/test")
def test_source(body: SourceActionRequest, user: str = Depends(auth.require_admin)):
    """Test source connection without mutating persistent database tables."""
    from app import jobs
    from fastapi import HTTPException
    valid_sources = {"smhi", "trafikverket", "scb", "sgu", "skogsstyrelsen", "lantmateriet"}
    if body.source.lower() not in valid_sources:
        raise HTTPException(status_code=404, detail=f"Unknown source '{body.source}'")
    result = jobs.test_source_connection(body.source)
    control.audit_action(user, "control.source_test", {"source": body.source, "status": result["status"]})
    return result


@router.post("/source/refresh")
def refresh_source(body: SourceActionRequest, user: str = Depends(auth.require_admin)):
    """Immediately trigger background ingest for a single source."""
    from app import jobs
    res = jobs.run_source(body.source, body.source, trigger="manual")
    control.audit_action(user, "control.source_refresh", {"source": body.source, "status": res.status})
    return {
        "source": body.source,
        "status": res.status,
        "records_received": res.record_count,
        "records_stored": res.stored_count,
        "message": res.message,
    }


@router.post("/refresh-all")
def refresh_all(user: str = Depends(auth.require_admin)):
    """Trigger immediate refresh for all enabled sources."""
    from app import jobs, sources
    summary = sources.summary()
    results = {}
    for src in summary.get("sources", []):
        if src.get("enabled"):
            sid = src["id"]
            res = jobs.run_source(sid, sid, trigger="manual")
            results[sid] = {"status": res.status, "records": res.record_count, "stored": res.stored_count}
    control.audit_action(user, "control.refresh_all", {"count": len(results)})
    return {
        "status": "ok",
        "refreshed_count": len(results),
        "results": results,
    }


@router.post("/source/register")
def register_source(body: RegisterSourceRequest, user: str = Depends(auth.require_admin)):
    """Dynamically register a new 7th/8th data source into the system."""
    sid = body.id.lower().strip()
    try:
        with db.cursor() as cur:
            cur.execute(
                """
                INSERT INTO source_registry (id, name, category, description, base_url, auth_type, auth_env_vars,
                                             interval_seconds, freshness_seconds, map_layer, connector, enabled)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name, category = EXCLUDED.category, base_url = EXCLUDED.base_url,
                    updated_at = now()
                """,
                (sid, body.name, body.category, body.description, body.base_url, body.auth_type, body.auth_env_vars,
                 body.interval_seconds, body.freshness_seconds, body.map_layer, sid),
            )
    except Exception:
        pass  # In memory fallback handles dynamically

    # Also register in control state sources
    def mutate(state: dict) -> None:
        state["sources"][sid] = True
        state["source_intervals"][sid] = body.interval_seconds

    res = control.patch_state(mutate, user, "control.source_register")
    control.audit_action(user, "control.source_register", {"source_id": sid, "name": body.name})
    return {"status": "ok", "source_id": sid, "registered": True, "state": res}


@router.get("/export-config")
def export_config(user: str = Depends(auth.require_admin)):
    """Export complete control and risk configuration as JSON."""
    live = control.get_live()
    return {
        "exported_at": live.get("applied_at"),
        "exported_by": user,
        "config": live,
    }


@router.post("/import-config/validate")
def validate_import_config(body: ImportConfigRequest, user: str = Depends(auth.require_admin)):
    """Validate imported JSON configuration and return preview diff without mutating."""
    incoming = body.state or body.config
    live = control.get_live()
    try:
        clean_incoming = {k: v for k, v in incoming.items() if k not in ("version", "applied_at", "applied_by", "changed", "unchanged")}
        validated = control.ControlState(**clean_incoming)
        diff_keys = control.diff(live, validated.model_dump())
        return {
            "valid": True,
            "changed_keys": diff_keys,
            "changes_count": len(diff_keys),
            "preview_state": validated.model_dump(),
        }
    except Exception as exc:
        return {
            "valid": False,
            "error": str(exc),
            "errors": [str(exc)],
            "changed_keys": [],
        }
