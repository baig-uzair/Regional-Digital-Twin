"""Known gaps against the specs, found while verifying the backend (see docs/FINAL_REPORT.md).

Each test states the REQUIRED behaviour and is marked xfail(strict=True): it documents the defect today and
fails loudly (XPASS) the moment the backend is fixed, so the marker must then be deleted.
"""
import psycopg2
import pytest

from app import db

STATE_KEYS = ("mode", "scope", "sources", "source_intervals", "layers", "components", "risk_thresholds", "active_scenario", "simulation_year")


def run(c, **kw):
    body = {"scenario": "population_growth", "target_year": 2030, "scope": "dalarna", "driver": {"population_change": 0.10}}
    body.update(kw)
    r = c.post("/api/simulation/run", json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.xfail(strict=True, reason="A-7.3: target_year is ignored; population must follow current x (1 + rate)^years")
def test_population_formula_depends_on_target_year(admin):
    pops = [run(admin, target_year=y)["summary"]["population_simulated"] for y in (2026, 2030, 2040)]
    assert pops[0] < pops[1] < pops[2]


def test_simulation_uses_saved_risk_thresholds(admin):
    st = admin.get("/api/control/state").json()
    body = {k: st[k] for k in STATE_KEYS}
    body["risk_thresholds"] = {"low": 0.2, "medium": 0.4, "high": 0.5}
    assert admin.post("/api/control/apply", json={"base_version": st["version"], "state": body}).status_code == 200
    th = run(admin)["assumptions"]["thresholds"]
    assert (th["low"], th["medium"], th["high"]) == (0.2, 0.4, 0.5)


@pytest.mark.xfail(strict=True, reason="A-7: a scenario without a population driver must not apply +10% population")
def test_non_population_scenario_does_not_apply_population_change(admin):
    r = run(admin, scenario="climate_freeze_thaw", target_year=2026, driver={"road_temp_delta": -3.5})
    assert r["summary"]["population_change_pct"] == 0


@pytest.mark.xfail(strict=True, reason="B-9: switching the driver source (SCB) off must remove the population effect")
def test_excluding_the_driver_source_removes_its_effect(admin):
    r = run(admin, excluded_sources=["scb"])
    assert r["summary"]["population_change_pct"] == 0


@pytest.mark.xfail(strict=True, reason="A-17: the audit log must be admin-only")
def test_audit_log_requires_admin(client):
    assert client.get("/api/system/audit").status_code in (401, 403)


def test_simulation_results_are_persisted(admin):
    run_id = run(admin)["run_id"]
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM simulation_runs")
        assert cur.fetchone()["n"] >= 1, f"{run_id} only lives in process memory"


def test_scenario_can_be_created(admin):
    body = {"id": "gap_test", "name": "Gap test", "driver_source": "SCB", "target_year": 2030, "scope": "dalarna", "driver": {"population_change": 0.05}}
    assert admin.post("/api/simulation/scenarios", json=body).status_code in (200, 201)


@pytest.mark.xfail(strict=True, reason="R-2.3/A-6.6: a registered 7th source needs a generic connector so Test/Refresh work")
def test_registered_source_can_be_refreshed(admin):
    reg = {"id": "gap7", "name": "Gap Seven", "category": "Energy", "base_url": "https://example.org/api", "interval_seconds": 900}
    assert admin.post("/api/control/source/register", json=reg).status_code == 200
    r = admin.post("/api/control/source/refresh", json={"source": "gap7"})
    assert "no connector registered" not in r.json().get("message", "")


@pytest.mark.xfail(strict=True, reason="X-1: when the database is unreachable the API must answer 503, never invented 'online' data")
def test_no_invented_source_status_when_database_is_down(client, monkeypatch):
    def boom(*a, **k):
        raise psycopg2.OperationalError("db down")

    monkeypatch.setattr(db, "cursor", boom)
    r = client.get("/api/datasources/summary")
    assert r.status_code == 503


@pytest.mark.xfail(strict=True, reason="X-1: saving configuration must fail (503) when the database is down instead of 'saving' to memory")
def test_apply_fails_when_database_is_down(admin, monkeypatch):
    st = admin.get("/api/control/state").json()
    body = {k: st[k] for k in STATE_KEYS}
    body["scope"] = "2080"

    def boom(*a, **k):
        raise psycopg2.OperationalError("db down")

    monkeypatch.setattr(db, "cursor", boom)
    assert admin.post("/api/control/apply", json={"base_version": st["version"], "state": body}).status_code == 503


@pytest.mark.xfail(strict=True, reason="B-12: 'current' values in impact_by_source must come from stored data, not literals")
def test_impact_current_values_are_not_hard_coded_literals(admin):
    imp = {i["id"]: i for i in run(admin)["impact_by_source"]}
    assert imp["lantmateriet"]["current"] != "12,450" and imp["skogsstyrelsen"]["current"] != "450,000 ha"
