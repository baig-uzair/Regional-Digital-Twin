"""PostgreSQL access (psycopg2 pool) and idempotent schema bootstrap."""
from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import psycopg2
import psycopg2.extras
import psycopg2.pool

from app import config

logger = logging.getLogger("app.db")

DB_DIR = Path(__file__).resolve().parent.parent / "db"
SCHEMA_FILES = ["telemetry.sql", "regional_datasources.sql", "control.sql"]

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


_last_failed_connect = 0.0


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool, _last_failed_connect
    with _pool_lock:
        if _pool is None:
            now = time.monotonic()
            if now - _last_failed_connect < 10.0:
                raise psycopg2.OperationalError("Database recently unreachable (retry cooldown)")
            try:
                _pool = psycopg2.pool.ThreadedConnectionPool(1, 12, **config.db_params())
            except Exception:
                _last_failed_connect = now
                raise
        return _pool


def reset_pool() -> None:
    """Drop the pool (tests change the target database)."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.closeall()
            _pool = None


@contextmanager
def transaction():
    pool = _get_pool()
    conn = None
    try:
        conn = pool.getconn()
        yield conn
        conn.commit()
    except Exception:
        if conn is not None:
            conn.rollback()
        raise
    finally:
        if conn is not None:
            pool.putconn(conn)


@contextmanager
def cursor():
    """Dict cursor inside a transaction that commits on success and rolls back on error."""
    with transaction() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
        finally:
            cur.close()


def ping() -> bool:
    try:
        with cursor() as cur:
            cur.execute("SELECT 1")
        return True
    except Exception:  # noqa: BLE001
        return False


def apply_schema() -> None:
    for name in SCHEMA_FILES:
        ddl = (DB_DIR / name).read_text(encoding="utf-8-sig")
        try:
            with transaction() as conn:
                cur = conn.cursor()
                cur.execute(ddl)
                cur.close()
        except psycopg2.errors.FeatureNotSupported:
            # When running on standard PostgreSQL without PostGIS or TimescaleDB extensions,
            # strip unsupported extension statements and hypertable calls, and adapt geometry type
            safe_ddl = ddl
            for stmt in [
                "CREATE EXTENSION IF NOT EXISTS postgis;",
                "CREATE EXTENSION IF NOT EXISTS timescaledb;",
                "SELECT create_hypertable('regional_telemetry', 'time', if_not_exists => TRUE);",
                "CREATE INDEX IF NOT EXISTS idx_regional_datasources_geom ON regional_datasources USING GIST (geom);",
            ]:
                safe_ddl = safe_ddl.replace(stmt, "-- " + stmt)
            safe_ddl = safe_ddl.replace("GEOMETRY(Point, 4326)", "TEXT")
            safe_ddl = safe_ddl.replace("GEOMETRY(Geometry, 4326)", "TEXT")
            with transaction() as conn:
                cur = conn.cursor()
                cur.execute(safe_ddl)
                cur.close()
        logger.info("schema applied: %s", name)


def wait_for_db(timeout_s: int = 90) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if ping():
            return True
        time.sleep(2)
    return False
