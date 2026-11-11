"""Unit and integration tests for Causal Simulation Engine and endpoints."""
import pytest
from simulation.engine import classify_risk, run_simulation


def test_classify_risk_thresholds():
    th = {"low": 0.30, "medium": 0.60, "high": 0.80, "critical": 1.00}
    assert classify_risk(0.15, th) == "Low"
    assert classify_risk(0.35, th) == "Medium"
    assert classify_risk(0.75, th) == "High"
    assert classify_risk(0.95, th) == "Critical"


def test_simulation_engine_formula_and_propagation():
    res = run_simulation(
        scenario="population_growth",
        target_year=2030,
        scope="dalarna",
        driver={"population_change": 0.10},
        is_test=True,
    )
    assert res["is_test"] is True
    assert res["simulated"] is True
    assert res["target_year"] == 2030
    assert len(res["municipalities"]) == 15

    # Check causal formula P_future = P_current * (1 + 0.10)
    for m in res["municipalities"]:
        expected_pop = int(round(m["current_population"] * 1.10))
        assert m["simulated_population"] == expected_pop
        assert "overall_risk" in m
        assert m["overall_risk"]["score"] >= 0.0

    # Ensure key takeaway text is deterministic and meaningful
    takeaway = res["summary"]["key_takeaway"]
    assert "10% population increase" in takeaway


def test_simulation_api_endpoints(client, admin):
    # 1. Scenarios list
    r = client.get("/api/simulation/scenarios")
    res = r.json()
    scenarios = res.get("scenarios", res) if isinstance(res, dict) else res
    assert len(scenarios) >= 3
    assert any(s["id"] == "population_growth" for s in scenarios)

    # 2. Test simulation (safe run)
    r = admin.post(
        "/api/simulation/test",
        json={"scenario": "population_growth", "target_year": 2035, "driver": {"population_change": 0.15}},
    )
    assert r.status_code == 200
    test_run = r.json()
    assert test_run["is_test"] is True
    assert test_run["target_year"] == 2035

    # 3. Official simulation run
    r = admin.post(
        "/api/simulation/run",
        json={"scenario": "rapid_urbanization", "target_year": 2035, "driver": {"population_change": 0.18}},
    )
    assert r.status_code == 200
    official_run = r.json()
    assert official_run["is_test"] is False
    assert official_run["target_year"] == 2035

    # 4. Latest result retrieval
    r = client.get("/api/simulation/result/latest")
    assert r.status_code == 200
    latest = r.json()
    assert latest["run_id"] == official_run["run_id"]
