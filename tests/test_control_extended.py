"""Unit and integration tests for extended Control actions, export, and dynamic registry."""
import pytest


def test_source_test_endpoint(admin):
    # Testing an existing source (smhi) returns structured response without touching DB
    r = admin.post("/api/control/source/test", json={"source": "smhi"})
    assert r.status_code == 200
    res = r.json()
    assert res["source"] == "smhi"
    assert "latency_ms" in res
    assert "status" in res

    # Unknown source
    r = admin.post("/api/control/source/test", json={"source": "unknown_xyz"})
    assert r.status_code == 404


def test_refresh_all_endpoint(admin):
    r = admin.post("/api/control/refresh-all", json={})
    assert r.status_code == 200
    res = r.json()
    assert res["status"] == "ok"
    assert "results" in res


def test_register_dynamic_source(admin):
    r = admin.post(
        "/api/control/source/register",
        json={
            "id": "test_radar_source",
            "name": "Test Radar Network",
            "base_url": "https://api.example.se/v1",
            "interval_seconds": 1800,
            "enabled": True,
        },
    )
    assert r.status_code == 200
    res = r.json()
    assert res["status"] == "ok"
    assert res["source_id"] == "test_radar_source"


def test_export_and_import_config_validation(admin):
    # 1. Export configuration
    r = admin.get("/api/control/export-config")
    assert r.status_code == 200
    exported = r.json()
    assert "config" in exported

    # 2. Validate valid import
    r = admin.post("/api/control/import-config/validate", json={"state": exported["config"]})
    assert r.status_code == 200
    val = r.json()
    assert val["valid"] is True

    # 3. Validate invalid import
    r = admin.post("/api/control/import-config/validate", json={"state": {"invalid": "data"}})
    assert r.status_code == 200
    val = r.json()
    assert val["valid"] is False
    assert len(val["errors"]) > 0


def test_multi_format_export(client):
    # JSON export
    r = client.get("/api/export?format=json")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    data = r.json()
    assert "municipalities" in data
    assert len(data["municipalities"]) == 15

    # CSV export
    r = client.get("/api/export?format=csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert b"Municipality_Code" in r.content

    # XLSX export
    r = client.get("/api/export?format=xlsx")
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]
    assert len(r.content) > 1000

    # GeoJSON export
    r = client.get("/api/export?format=geojson")
    assert r.status_code == 200
    geo = r.json()
    assert geo["type"] == "FeatureCollection"
    assert len(geo["features"]) == 15


def test_audit_log_endpoint(client):
    r = client.get("/api/system/audit")
    assert r.status_code == 200
    res = r.json()
    assert "events" in res
    assert isinstance(res["events"], list)
