"""Browser (Playwright) tests: start the real app on the throwaway test database and drive it like a user.

Skipped automatically when Playwright/Chromium or the database is unavailable.
Run:  python -m pytest tests/e2e -q
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests

ROOT = Path(__file__).resolve().parents[2]
PORT = int(os.environ.get("E2E_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"
USER, PASSWORD = "tester", "test-password-123"


def _reset_db():
    from app import control, db

    with db.cursor() as cur:
        cur.execute("TRUNCATE control_state, audit_log, source_runs, regional_datasources RESTART IDENTITY")
        cur.execute("DELETE FROM regional_telemetry")
        cur.execute("DELETE FROM source_registry")
    db.apply_schema()
    control.seed_if_empty()


@pytest.fixture(scope="session")
def server(database):
    pytest.importorskip("playwright.sync_api")
    _reset_db()
    env = {**os.environ, "APP_BOOTSTRAP": "1", "SCHEDULER_ENABLED": "false", "PUBLIC_SIMULATION": "true"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"], cwd=ROOT, env=env)
    try:
        for _ in range(60):
            try:
                if requests.get(f"{BASE}/api/control/state", timeout=1).status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(0.5)
        else:
            pytest.skip("app did not start")
        yield BASE
    finally:
        proc.terminate()
        proc.wait(timeout=10)


@pytest.fixture(scope="session")
def browser_(server):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as exc:  # noqa: BLE001
            pytest.skip(f"Chromium not installed ({exc}); run: python -m playwright install chromium")
        yield b
        b.close()


@pytest.fixture()
def fresh(server):
    """Known control-plane state before each test."""
    _reset_db()
    yield


@pytest.fixture()
def api(server, fresh):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"username": USER, "password": PASSWORD})
    assert r.status_code == 200, r.text
    s.base = BASE
    return s


@pytest.fixture()
def page(browser_, fresh):
    ctx = browser_.new_context(viewport={"width": 1500, "height": 1000}, accept_downloads=True)
    pg = ctx.new_page()
    pg.set_default_timeout(15000)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.errors = errors
    yield pg
    ctx.close()


@pytest.fixture()
def admin_page(page):
    page.goto(f"{BASE}/login")
    page.fill("input[name=username], #username", USER)
    page.fill("input[type=password]", PASSWORD)
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)
    page.goto(f"{BASE}/control.html#overview")
    page.wait_for_selector("#cr-saved:not(:text('Loading'))")
    page.wait_for_selector("#cr-content .cr-card")
    return page
