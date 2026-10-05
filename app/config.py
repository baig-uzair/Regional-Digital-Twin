"""Runtime configuration, read from the environment (docker compose injects .env).

Values are read lazily through functions so tests can monkeypatch the environment.
No credentials have defaults here: a missing database password simply fails to connect.
"""
from __future__ import annotations

import os
import secrets

PLACEHOLDERS = {"", "votre_cle_ici", "your_key_here", "changeme"}

_random_secret = secrets.token_urlsafe(32)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def db_params() -> dict:
    return {
        "host": _env("POSTGRES_HOST", "timescaledb"),
        "port": int(_env("POSTGRES_PORT", "5432")),
        "dbname": _env("POSTGRES_DB", "dalarna_dt"),
        "user": _env("POSTGRES_USER", "postgres"),
        "password": _env("POSTGRES_PASSWORD"),
        "connect_timeout": 5,
    }


def admin_credentials() -> tuple[str, str]:
    return _env("ADMIN_USERNAME").strip(), _env("ADMIN_PASSWORD")


def session_secret() -> str:
    """SESSION_SECRET if set; otherwise a per-process random value (sessions reset on restart)."""
    return _env("SESSION_SECRET") or _random_secret


def session_secret_is_persistent() -> bool:
    return bool(_env("SESSION_SECRET"))


def public_simulation() -> bool:
    """Whether POST /api/simulation/run is open to Main Interface visitors (no admin login)."""
    return _env("PUBLIC_SIMULATION", "true").strip().lower() in ("1", "true", "yes", "on")


def scheduler_enabled() -> bool:
    return _env("SCHEDULER_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")


def bootstrap_enabled() -> bool:
    """Schema apply + seed + scheduler start at app startup (tests switch this off)."""
    return _env("APP_BOOTSTRAP", "true").strip().lower() in ("1", "true", "yes", "on")


def orion_url() -> str:
    return _env("ORION_URL", "http://orion:1026/ngsi-ld/v1/entities")


def env_is_set(name: str) -> bool:
    """True when the variable holds a real value (never returns the value itself)."""
    return _env(name).strip().lower() not in PLACEHOLDERS
