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


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = psycopg2.pool.ThreadedConnectionPool(1, 12, **config.db_params())
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
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
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
        with transaction() as conn:
            cur = conn.cursor()
            cur.execute(ddl)
            cur.close()
        logger.info("schema applied: %s", name)


def wait_for_db(timeout_s: int = 90) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if ping():
            return True
        time.sleep(2)
    return False
