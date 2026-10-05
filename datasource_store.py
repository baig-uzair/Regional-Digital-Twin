"""PostGIS storage for the four new connectors' NormalizedRecords, additive to regional_telemetry."""
from __future__ import annotations

import os

import psycopg2
import psycopg2.extras

from connectors.common import NormalizedRecord

DB_HOST = os.environ.get("POSTGRES_HOST", "timescaledb")
DB_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
DB_NAME = os.environ.get("POSTGRES_DB", "dalarna_dt")
DB_USER = os.environ.get("POSTGRES_USER", "postgres")
DB_PASS = os.environ.get("POSTGRES_PASSWORD", "DalarnaTwin2026!")

_SCHEMA_SQL = os.path.join(os.path.dirname(__file__), "db", "regional_datasources.sql")


def _connect():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, database=DB_NAME, user=DB_USER, password=DB_PASS, connect_timeout=5
    )


def ensure_schema() -> None:
    with open(_SCHEMA_SQL, "r", encoding="utf-8") as f:
        ddl = f.read()
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(ddl)
        conn.commit()
        cur.close()
    finally:
        conn.close()


def upsert_records(records: list[NormalizedRecord]) -> int:
    if not records:
        return 0

    conn = _connect()
    try:
        cur = conn.cursor()
        rows = [
            (
                r.source_id,
                r.dataset_id,
                r.feature_id,
                r.observed_at,
                r.geometry_wkt,
                psycopg2.extras.Json(r.attributes),
                r.fetched_at,
                r.source_url,
                r.license,
            )
            for r in records
        ]
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO regional_datasources
                (source_id, dataset_id, feature_id, observed_at, geom, attributes, fetched_at, source_url, license)
            VALUES %s
            ON CONFLICT (source_id, dataset_id, feature_id, observed_at) DO UPDATE SET
                geom = EXCLUDED.geom,
                attributes = EXCLUDED.attributes,
                fetched_at = EXCLUDED.fetched_at,
                source_url = EXCLUDED.source_url,
                license = EXCLUDED.license
            """,
            rows,
            template="(%s, %s, %s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s, %s)",
        )
        conn.commit()
        count = cur.rowcount
        cur.close()
        return count
    finally:
        conn.close()
