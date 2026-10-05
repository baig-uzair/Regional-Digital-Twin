-- Additive schema for the four new sources (Lantmäteriet, SCB, Skogsstyrelsen, SGU).
-- Does NOT modify regional_telemetry (SMHI/Trafikverket), per mapping doc section 7.1.
-- Applied automatically at ingestor startup (see db_setup.py); kept here as a
-- reference/manual-run copy, same as regional_telemetry's own bootstrap in README.md.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS regional_datasources (
    id           BIGSERIAL PRIMARY KEY,
    source_id    VARCHAR(64) NOT NULL,          -- e.g. 'SCB', 'SGU', 'Skogsstyrelsen', 'Lantmateriet'
    dataset_id   VARCHAR(128) NOT NULL,          -- original dataset/collection/table id
    feature_id   VARCHAR(255),                   -- source feature/observation key, nullable
    observed_at  TIMESTAMPTZ,                    -- observation/reference period, NOT the fetch time
    geom         GEOMETRY(Geometry, 4326),        -- nullable, WGS84
    attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_url   TEXT,
    license      TEXT
);

CREATE INDEX IF NOT EXISTS idx_regional_datasources_source ON regional_datasources (source_id, dataset_id);
CREATE INDEX IF NOT EXISTS idx_regional_datasources_geom ON regional_datasources USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_regional_datasources_fetched_at ON regional_datasources (fetched_at DESC);

-- Best-effort de-dup key for upserts. Postgres treats NULLs as distinct in unique
-- constraints, so records with a NULL feature_id/observed_at (e.g. Skogsstyrelsen's
-- area statistics) will insert a new row each poll rather than truly upsert - acceptable
-- for this prototype since fetched_at still lets you keep only the latest per source/dataset.
CREATE UNIQUE INDEX IF NOT EXISTS uq_regional_datasources_identity
    ON regional_datasources (source_id, dataset_id, feature_id, observed_at);
