"""Source status, connectors and the 'never show fake data' rules."""
from datetime import datetime, timedelta, timezone

import psycopg2.extras
import pytest
import requests

from app import db, jobs, sources
from connectors import scb, skogsstyrelsen, smhi, trafikverket
from connectors.common import ConnectorError, ConnectorSkipped

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
SRC = {"enabled": True, "freshness_seconds": 3600}


def _run(status, minutes_ago, message="", origin="live"):
    return {"status": status, "started_at": NOW - timedelta(minutes=minutes_ago), "message": message, "data_origin": origin}


# ---- pure status rules -------------------------------------------------------------------
def test_status_rules():
    cs = sources.compute_status
    assert cs({**SRC, "enabled": False}, None, None, NOW, [])[0] == "disabled"
    assert cs(SRC, None, None, NOW, ["TRAFIKVERKET_API_KEY"])[0] == "not_configured"
    assert cs(SRC, None, None, NOW, [])[0] == "pending"
    assert cs(SRC, _run("skipped", 1, "no creds"), None, NOW, [])[0] == "not_configured"
    ok = _run("ok", 10)
    assert cs(SRC, ok, ok, NOW, [])[0] == "online"
    old = _run("ok", 120)
    assert cs(SRC, old, old, NOW, [])[0] == "stale"
    fb = _run("fallback", 5, "fallback", "fallback")
    assert cs(SRC, fb, fb, NOW, [])[0] == "fallback"


def test_error_status_keeps_last_real_success_visible():
    good, bad = _run("ok", 90), _run("error", 1, "HTTP 503")
    status, msg = sources.compute_status(SRC, bad, good, NOW, [])
    assert status == "error" and msg == "HTTP 503"  # never "online" after a failed fetch


def test_disabled_wins_over_everything():
    assert sources.compute_status({**SRC, "enabled": False}, _run("error", 1), None, NOW, ["X"])[0] == "disabled"


# ---- Trafikverket --------------------------------------------------------------------------
def test_trafikverket_without_key_is_skipped_and_writes_nothing(clean):
    with pytest.raises(ConnectorSkipped):
        trafikverket.fetch_records()
    res = jobs.run_source("trafikverket", "trafikverket", trigger="manual")
    assert res.status == "skipped"
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM regional_datasources WHERE source_id = 'Trafikverket'")
        assert cur.fetchone()["n"] == 0


def test_trafikverket_placeholder_key_counts_as_unset(monkeypatch):
    monkeypatch.setenv("TRAFIKVERKET_API_KEY", "votre_cle_ici")
    with pytest.raises(ConnectorSkipped):
        trafikverket.api_key()


def test_trafikverket_parses_measurements_only():
    xml = """<RESPONSE><RESULT><WeatherMeasurepoint><Id>SE_1</Id><Name>E16 Borlänge</Name>
      <Geometry><WGS84>POINT (15.40 60.50)</WGS84></Geometry>
      <Observation><Sample>2026-10-06T10:00:00.000+02:00</Sample>
        <Air><Temperature><Value>4.5</Value></Temperature></Air>
        <Surface><Temperature><Value>2.1</Value></Temperature></Surface></Observation>
    </WeatherMeasurepoint></RESULT></RESPONSE>"""
    [rec] = trafikverket.parse_response(xml)
    assert rec.feature_id == "SE_1" and rec.geometry_wkt == "POINT(15.4 60.5)"
    assert rec.attributes["air_temperature_c"] == 4.5 and rec.attributes["road_surface_temperature_c"] == 2.1
    assert rec.attributes["wind_speed_ms"] is None  # missing -> None, never a default


def test_trafikverket_api_error_is_an_error_not_data():
    with pytest.raises(ConnectorError):
        trafikverket.parse_response("<RESPONSE><RESULT><ERROR><MESSAGE>bad key</MESSAGE></ERROR></RESULT></RESPONSE>")


def test_trafikverket_request_never_logs_key_in_errors(monkeypatch):
    monkeypatch.setenv("TRAFIKVERKET_API_KEY", "SUPERSECRETKEY")

    def boom(*a, **k):
        raise requests.ConnectionError("failed for url with SUPERSECRETKEY")

    monkeypatch.setattr(requests, "post", boom)
    with pytest.raises(ConnectorError) as e:
        trafikverket.fetch_records()
    assert "SUPERSECRETKEY" not in str(e.value)


# ---- SMHI: no fallback value ------------------------------------------------------------------
def test_smhi_failure_writes_nothing_and_records_the_error(clean, monkeypatch):
    def fail():
        raise ConnectorError("SMHI: request failed: timeout")

    monkeypatch.setattr(smhi, "fetch_observation", fail)
    res = jobs.run_source("smhi", "smhi", trigger="manual")
    assert res.status == "error"
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM regional_telemetry")
        assert cur.fetchone()["n"] == 0, "no 19.5 C fallback (or any value) may be written on failure"
        cur.execute("SELECT status, message FROM source_runs WHERE source_id = 'smhi'")
        run = cur.fetchone()
    assert run["status"] == "error" and "timeout" in run["message"]


def test_smhi_success_stores_the_real_observation_once(clean, monkeypatch):
    obs = smhi.Observation(temperature=7.3, observed_at=datetime(2026, 10, 6, 10, tzinfo=timezone.utc))
    monkeypatch.setattr(smhi, "fetch_observation", lambda: obs)
    monkeypatch.setattr(jobs, "_mirror_to_orion", lambda o: None)
    assert jobs.run_source("smhi", "smhi").status == "ok"
    assert jobs.run_source("smhi", "smhi").status == "ok"  # same observation again
    with db.cursor() as cur:
        cur.execute("SELECT temperature FROM regional_telemetry")
        rows = cur.fetchall()
    assert [r["temperature"] for r in rows] == [7.3]


# ---- Skogsstyrelsen / Lantmäteriet: no invented fallback data ----------------------------------
def test_unconfigured_forest_and_land_sources_return_no_records(clean):
    with pytest.raises(ConnectorSkipped):
        skogsstyrelsen.fetch_records()
    for sid, key in (("skogsstyrelsen", "skogsstyrelsen"), ("lantmateriet", "lantmateriet")):
        assert jobs.run_source(sid, key).status == "skipped"
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM regional_datasources")
        assert cur.fetchone()["n"] == 0


def test_legacy_fabricated_records_are_never_served(client):
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO regional_datasources (source_id, dataset_id, feature_id, geom, attributes) "
            "VALUES ('Lantmateriet','ngp_administrative_boundaries','LM:DALARNA:FALUN:ADM', ST_GeomFromText('POINT(15.6 60.6)',4326), '{}')"
        )
    assert client.get("/api/datasources?source=lantmateriet").json()["features"] == []


# ---- SCB: fallback must be labelled -------------------------------------------------------------
def test_scb_fallback_is_tagged_and_surfaced_as_fallback(clean, monkeypatch):
    def down(*a, **k):
        raise requests.ConnectionError("api.scb.se refused")

    monkeypatch.setattr(requests, "get", down)
    recs = scb.fetch_records()
    assert len(recs) == 15 and all(r.attributes["data_origin"] == "fallback" for r in recs)
    res = jobs.run_source("scb", "scb")
    assert res.status == "fallback" and res.data_origin == "fallback"


def test_municipalities_endpoint_labels_fallback_origin(client, monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: (_ for _ in ()).throw(requests.ConnectionError("x")))
    jobs.run_source("scb", "scb")
    data = client.get("/api/municipalities").json()
    assert len(data["municipalities"]) == 15
    assert "Rättvik" in {m["name"] for m in data["municipalities"]}
    assert all(m["population"]["origin"] == "fallback" for m in data["municipalities"])
    assert data["data_year"] == 2024
    summary = client.get("/api/datasources/summary").json()
    scb_card = next(s for s in summary["sources"] if s["id"] == "scb")
    assert scb_card["status"] == "fallback" and summary["online_count"] == 0


def test_municipality_without_data_reports_null_not_a_number(client):
    data = client.get("/api/municipalities").json()
    assert all(m["population"] is None for m in data["municipalities"])
    assert data["data_year"] is None
    assert client.get("/api/municipalities/2081").json()["population"] is None
    assert client.get("/api/municipalities/0000").status_code == 404


# ---- secrets ------------------------------------------------------------------------------------
def test_secret_values_never_appear_in_api_output(client, admin, monkeypatch):
    monkeypatch.setenv("TRAFIKVERKET_API_KEY", "TOPSECRETVALUE42")
    monkeypatch.setenv("SKOGSSTYRELSEN_CLIENT_SECRET", "TOPSECRETVALUE43")
    for path in ("/api/datasources/summary", "/api/control/state", "/api/control/map-state", "/api/system/health"):
        assert "TOPSECRETVALUE" not in client.get(path).text, path
    summary = client.get("/api/datasources/summary").json()
    tv = next(s for s in summary["sources"] if s["id"] == "trafikverket")
    assert tv["missing_config"] == [] and tv["status"] == "pending"  # configured -> waits for first fetch


def test_scheduler_skips_unconfigured_and_disabled_sources(clean):
    from app.scheduler import Scheduler

    due = {r["id"] for r in Scheduler().due_sources()}
    assert due == {"smhi", "scb", "sgu"}  # not trafikverket / skogsstyrelsen / lantmateriet (no credentials)
    with db.cursor() as cur:
        cur.execute("UPDATE source_registry SET enabled = FALSE WHERE id = 'sgu'")
    assert {r["id"] for r in Scheduler().due_sources()} == {"smhi", "scb"}


def test_scheduler_waits_for_interval_but_retries_errors_sooner(clean):
    from app.scheduler import Scheduler

    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        cur.execute("INSERT INTO source_runs (source_id, status, started_at) VALUES ('smhi','ok', %s)", (now - timedelta(minutes=5),))
        cur.execute("INSERT INTO source_runs (source_id, status, started_at) VALUES ('sgu','error', %s)", (now - timedelta(minutes=6),))
        cur.execute("INSERT INTO source_runs (source_id, status, started_at) VALUES ('scb','ok', %s)", (now - timedelta(minutes=6),))
    due = {r["id"] for r in Scheduler().due_sources(now)}
    assert "smhi" not in due  # 15 min interval, ran 5 min ago
    assert "scb" not in due   # 24 h interval
    assert "sgu" in due       # failed 6 min ago -> retry after 5 min, not after 6 h
