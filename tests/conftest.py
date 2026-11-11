"""Test fixtures. API/DB tests run against a throwaway database (dalarna_dt_test) on the same
Postgres/Timescale server the stack uses (localhost:5432 by default) and are skipped when it
is unreachable. The database password comes from POSTGRES_PASSWORD (loaded from .env if present)."""
import os
import sys
from pathlib import Path

import psycopg2
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# --- environment must be set BEFORE the app modules are imported -------------------------
_env_file = ROOT / ".env"
if _env_file.exists():
    for line in _env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k, v)

TEST_DB = "dalarna_dt_test"
os.environ["POSTGRES_HOST"] = os.environ.get("TEST_POSTGRES_HOST", "localhost")
os.environ["POSTGRES_DB"] = TEST_DB
os.environ["APP_BOOTSTRAP"] = "0"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["ADMIN_USERNAME"] = "tester"
os.environ["ADMIN_PASSWORD"] = "test-password-123"
from app import config, db  # noqa: E402

os.environ["ADMIN_USERNAME"] = "tester"
os.environ["ADMIN_PASSWORD"] = "test-password-123"
os.environ["SESSION_SECRET"] = "test-secret"
for var in ("TRAFIKVERKET_API_KEY", "LANTMATERIET_API_KEY", "LANTMATERIET_BASE_URL", "LANTMATERIET_COLLECTION",
            "SKOGSSTYRELSEN_CLIENT_ID", "SKOGSSTYRELSEN_CLIENT_SECRET"):
    os.environ.pop(var, None)


def _server_params(dbname: str) -> dict:
    p = config.db_params()
    p["dbname"] = dbname
    return p


@pytest.fixture(scope="session")
def database():
    try:
        conn = psycopg2.connect(**_server_params("postgres"))
    except psycopg2.OperationalError as exc:
        pytest.skip(f"PostgreSQL not reachable for tests: {exc}")
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,))
    if not cur.fetchone():
        cur.execute(f'CREATE DATABASE "{TEST_DB}"')
    conn.close()
    db.reset_pool()
    db.apply_schema()
    yield TEST_DB
    db.reset_pool()


@pytest.fixture()
def clean(database):
    """Fresh control plane for each test: default registry, version-1 state, empty history tables."""
    from app import auth, control

    with db.cursor() as cur:
        cur.execute("TRUNCATE control_state, audit_log, source_runs, regional_datasources RESTART IDENTITY")
        cur.execute("DELETE FROM regional_telemetry")
        cur.execute("DELETE FROM source_registry")
    db.apply_schema()  # re-seeds source_registry
    control.seed_if_empty()
    auth._failures.clear()
    yield


@pytest.fixture()
def client(clean):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin(client):
    r = client.post("/api/auth/login", json={"username": "tester", "password": "test-password-123"})
    assert r.status_code == 200, r.text
    return client
