"""PostGIS storage for the connectors' NormalizedRecords (table regional_datasources).

Uses the application's connection pool (app.db) so credentials come from the environment
in exactly one place. The schema is applied at startup by app.db.apply_schema().
"""
from __future__ import annotations

import psycopg2.extras

from app import db
from connectors.common import NormalizedRecord


def upsert_records(records: list[NormalizedRecord]) -> int:
    if not records:
        return 0
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
    with db.transaction() as conn:
        cur = conn.cursor()
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
        count = cur.rowcount
        cur.close()
    return count
