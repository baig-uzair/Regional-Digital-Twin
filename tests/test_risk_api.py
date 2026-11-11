"""Unit and integration tests for Risk Configuration API."""
import pytest


def test_risk_config_get(client):
    r = client.get("/api/risk/config")
    assert r.status_code == 200
    data = r.json()
    assert "thresholds" in data
    assert "weights" in data
    assert data["thresholds"]["low"] < data["thresholds"]["medium"] < data["thresholds"]["high"]


def test_risk_config_update_validation(admin):
    # Valid update
    valid_payload = {
        "thresholds": {"low": 0.25, "medium": 0.55, "high": 0.75, "critical": 1.0},
        "weights": {"population": 0.30, "food": 0.20, "snow_flood": 0.20, "infrastructure": 0.15, "environment": 0.15},
    }
    r = admin.post("/api/risk/config", json=valid_payload)
    assert r.status_code == 200
    res = r.json()
    assert res["thresholds"]["low"] == 0.25

    # Invalid non-ascending thresholds
    invalid_payload = {
        "thresholds": {"low": 0.70, "medium": 0.40, "high": 0.80, "critical": 1.0},
        "weights": {"population": 0.25, "food": 0.20, "snow_flood": 0.20, "infrastructure": 0.20, "environment": 0.15},
    }
    r = admin.post("/api/risk/config", json=invalid_payload)
    assert r.status_code == 422


def test_risk_calculate(client):
    r = client.post("/api/risk/calculate", json={"score": 0.20})
    assert r.status_code == 200
    assert r.json()["level"] == "Low"

    r = client.post("/api/risk/calculate", json={"score": 0.85})
    assert r.status_code == 200
    assert r.json()["level"] in ("High", "Critical")
