"""Tests for the live telemetry and simulation endpoints."""
from fastapi.testclient import TestClient
from app.main import app


def test_station_air_returns_200():
    client = TestClient(app)
    r = client.get("/api/station")
    assert r.status_code == 200
    data = r.json()
    assert "temperature" in data
    assert isinstance(data["temperature"]["value"], (int, float))
    assert data["source"] == "SMHI"


def test_station_road_returns_200():
    client = TestClient(app)
    r = client.get("/api/road-weather")
    assert r.status_code == 200
    data = r.json()
    assert "temperature" in data
    assert isinstance(data["temperature"]["value"], (int, float))
    assert data["source"] == "Trafikverket"


def test_simulation_predict_returns_risk_matrix():
    client = TestClient(app)
    r = client.get("/api/simulation/predict")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert "label" in data
    assert "color" in data
    assert "action" in data


def test_simulation_what_if_calculates_scenario():
    client = TestClient(app)
    r = client.post(
        "/api/simulation/what-if",
        json={"simulated_road_temp": -2.0, "simulated_air_temp": 2.0},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "DANGER_BLACK_ICE"
    assert "color" in data


def test_cockpit_page_returns_index_html():
    client = TestClient(app)
    r = client.get("/cockpit")
    assert r.status_code == 200
    assert "Dalarna Digital Twin" in r.text
