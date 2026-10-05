"""Control API: auth, versioned apply, concurrency, validation, history preservation."""
import psycopg2.extras

from app import db


def _state(client):
    r = client.get("/api/control/state")
    assert r.status_code == 200
    return r.json()


def _strip(s):
    return {k: v for k, v in s.items() if k not in ("version", "applied_at", "applied_by", "changed", "unchanged")}


def test_state_is_public_and_complete(client):
    s = _state(client)
    assert s["version"] == 1 and s["mode"] == "live" and s["scope"] == "dalarna"
    assert set(s["sources"]) == {"smhi", "trafikverket", "scb", "sgu", "skogsstyrelsen", "lantmateriet"}
    assert s["risk_thresholds"] == {"low": 0.3, "medium": 0.6, "high": 0.8}


def test_mutating_endpoints_require_admin(client):
    s = _state(client)
    calls = [
        ("/api/control/apply", {"base_version": 1, "state": _strip(s)}),
        ("/api/control/mode", {"mode": "simulation"}),
        ("/api/control/source", {"source": "smhi", "enabled": False}),
        ("/api/control/map-layer", {"layer": "roads", "visible": False}),
    ]
    for path, body in calls:
        r = client.post(path, json=body)
        assert r.status_code == 401, path
        assert r.json()["error"]["code"] == "unauthorized"
    assert _state(client)["version"] == 1, "nothing may change without a login"
    assert client.get("/api/system/health").status_code == 401


def test_login_rejects_bad_credentials_and_throttles(client):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "tester", "password": "wrong"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": "tester", "password": "test-password-123"})
    assert r.status_code == 429  # even the right password is refused while throttled


def test_apply_creates_new_version_and_syncs_registry(admin):
    s = _state(admin)
    new = _strip(s)
    new["sources"]["smhi"] = False
    new["source_intervals"]["sgu"] = 1800
    new["layers"]["roads"] = False
    r = admin.post("/api/control/apply", json={"base_version": 1, "state": new})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 2 and body["applied_by"] == "tester"
    assert set(body["changed"]) == {"sources.smhi", "source_intervals.sgu", "layers.roads"}
    assert _state(admin)["layers"]["roads"] is False
    with db.cursor() as cur:
        cur.execute("SELECT id, enabled, interval_seconds FROM source_registry WHERE id IN ('smhi','sgu') ORDER BY id")
        rows = {r["id"]: r for r in cur.fetchall()}
        cur.execute("SELECT action, result FROM audit_log ORDER BY id")
        audit = cur.fetchall()
    assert rows["smhi"]["enabled"] is False and rows["sgu"]["interval_seconds"] == 1800
    assert audit and audit[-1]["action"] == "control.apply" and audit[-1]["result"] == "ok"


def test_apply_with_stale_base_version_is_rejected(admin):
    new = _strip(_state(admin))
    new["mode"] = "simulation"
    assert admin.post("/api/control/apply", json={"base_version": 1, "state": new}).status_code == 200
    r = admin.post("/api/control/apply", json={"base_version": 1, "state": new | {"scope": "2081"}})
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "version_conflict" and err["current_version"] == 2
    assert _state(admin)["scope"] == "dalarna", "a rejected apply must not change anything"


def test_noop_apply_does_not_create_a_version(admin):
    r = admin.post("/api/control/apply", json={"base_version": 1, "state": _strip(_state(admin))})
    assert r.status_code == 200 and r.json()["unchanged"] is True and r.json()["version"] == 1


def test_validation_errors_use_one_shape(admin):
    base = _strip(_state(admin))
    bad_cases = [
        base | {"scope": "9999"},
        base | {"risk_thresholds": {"low": 0.9, "medium": 0.5, "high": 0.6}},
        base | {"mode": "turbo"},
        base | {"source_intervals": {"smhi": 5}},
        base | {"unexpected_field": 1},
    ]
    for state in bad_cases:
        r = admin.post("/api/control/apply", json={"base_version": 1, "state": state})
        assert r.status_code == 422, state
        assert r.json()["error"]["code"] == "validation_error"
    r = admin.post("/api/control/apply", json={"base_version": 1, "state": base | {"sources": {"nope": True}}})
    assert r.status_code == 422 and "nope" in r.json()["error"]["message"]
    assert _state(admin)["version"] == 1


def test_disabling_a_source_never_deletes_history(admin):
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO regional_datasources (source_id, dataset_id, feature_id, attributes) VALUES ('SGU','groundwater_bodies','x1', %s)",
            (psycopg2.extras.Json({"k": 1}),),
        )
    assert admin.post("/api/control/source", json={"source": "sgu", "enabled": False}).status_code == 200
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM regional_datasources WHERE source_id = 'SGU'")
        assert cur.fetchone()["n"] == 1
    sgu = next(s for s in admin.get("/api/datasources/summary").json()["sources"] if s["id"] == "sgu")
    assert sgu["status"] == "disabled"


def test_mode_and_map_layer_endpoints(admin):
    r = admin.post("/api/control/mode", json={"mode": "simulation", "year": 2030})
    assert r.status_code == 200 and r.json()["mode"] == "simulation" and r.json()["simulation_year"] == 2030
    assert admin.post("/api/control/map-layer", json={"layer": "forest", "visible": False}).json()["layers"]["forest"] is False
    assert admin.post("/api/control/map-layer", json={"layer": "bogus", "visible": True}).status_code == 422
    assert admin.post("/api/control/source", json={"source": "bogus", "enabled": True}).status_code == 422


def test_map_state_marks_unconfigured_and_disabled_sources_unavailable(admin):
    layers = admin.get("/api/control/map-state").json()["layers"]
    assert layers["boundaries"]["available"] is True
    assert layers["roads"]["available"] is False and layers["roads"]["reason"] == "Source is not configured"
    assert layers["water"]["available"] is True
    admin.post("/api/control/source", json={"source": "sgu", "enabled": False})
    assert admin.get("/api/control/map-state").json()["layers"]["water"]["reason"] == "Source is turned off"


def test_unknown_api_path_is_json_404(client):
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_admin_page_requires_login(client):
    r = client.get("/admin", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/login")
    assert client.get("/login").status_code == 200
