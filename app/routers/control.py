from fastapi import APIRouter, Depends

from app import auth, control, db
from app.scheduler import missing_config
from app.schemas import ApplyRequest, MapLayerRequest, ModeRequest, SourceToggleRequest

router = APIRouter(prefix="/api/control", tags=["control"])

LAYER_IDS = ("boundaries", "population", "weather", "roads", "water", "forest", "land", "simulation_risk")


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


@router.get("/map-state")
def map_state():
    """Layer visibility plus whether each layer's feeding source is currently enabled."""
    live = control.get_live()
    with db.cursor() as cur:
        cur.execute("SELECT id, map_layer, auth_env_vars FROM source_registry WHERE map_layer IS NOT NULL")
        rows = cur.fetchall()
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
