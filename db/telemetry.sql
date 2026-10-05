-- Time-series table for SMHI observations (and, historically, the former derived road value).
-- Previously created by hand via the README; now applied idempotently at startup.
-- Existing rows are never modified or deleted.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS regional_telemetry (
    time        TIMESTAMPTZ NOT NULL,
    entity_id   VARCHAR(255) NOT NULL,
    temperature DOUBLE PRECISION,
    geom        GEOMETRY(Point, 4326)
);

SELECT create_hypertable('regional_telemetry', 'time', if_not_exists => TRUE);
