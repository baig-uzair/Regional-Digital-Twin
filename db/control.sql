-- Control plane for the Main Interface + Admin Control Panel.
-- Applied idempotently at startup. Secrets are NEVER stored here: auth_env_vars holds the
-- NAMES of environment variables only.

CREATE TABLE IF NOT EXISTS source_registry (
    id               TEXT PRIMARY KEY,                 -- slug, e.g. 'smhi'
    name             TEXT NOT NULL,
    category         TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    base_url         TEXT,
    auth_type        TEXT NOT NULL DEFAULT 'none',     -- none | api_key | oauth_client_credentials
    auth_env_vars    TEXT[] NOT NULL DEFAULT '{}',     -- names only
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds >= 60),
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    map_layer        TEXT,                             -- layer id this source feeds
    freshness_seconds INTEGER NOT NULL CHECK (freshness_seconds >= 60),
    connector        TEXT NOT NULL,                    -- key into app/connector_registry.py
    config           JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order       INTEGER NOT NULL DEFAULT 100,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO source_registry
    (id, name, category, description, base_url, auth_type, auth_env_vars, interval_seconds, enabled,
     map_layer, freshness_seconds, connector, config, sort_order)
VALUES
    ('smhi', 'SMHI', 'Weather',
     'Weather observations: temperature, precipitation, snow/frost context.',
     'https://opendata-download-metobs.smhi.se', 'none', '{}', 900, TRUE, 'weather', 7200,
     'smhi', '{"role":"external_condition"}', 10),
    ('trafikverket', 'Trafikverket', 'Traffic / Infrastructure',
     'Road weather stations (WeatherMeasurepoint) for road and infrastructure conditions.',
     'https://api.trafikinfo.trafikverket.se', 'api_key', '{TRAFIKVERKET_API_KEY}', 900, TRUE, 'roads', 7200,
     'trafikverket', '{"record_source_id":"Trafikverket"}', 20),
    ('scb', 'SCB', 'Population / Statistics',
     'Population and socio-economic indicators for the 15 municipalities.',
     'https://api.scb.se', 'none', '{}', 86400, TRUE, 'population', 259200,
     'scb', '{"record_source_id":"SCB"}', 30),
    ('sgu', 'SGU', 'Water / Geology',
     'Groundwater bodies and geology context (OGC API Features).',
     'https://api.sgu.se', 'none', '{}', 21600, TRUE, 'water', 64800,
     'sgu', '{"record_source_id":"SGU"}', 40),
    ('skogsstyrelsen', 'Skogsstyrelsen', 'Forest / Environment',
     'Forest stand statistics (Skogliga grunddata).',
     'https://api.skogsstyrelsen.se', 'oauth_client_credentials',
     '{SKOGSSTYRELSEN_CLIENT_ID,SKOGSSTYRELSEN_CLIENT_SECRET}', 86400, TRUE, 'forest', 259200,
     'skogsstyrelsen', '{"record_source_id":"Skogsstyrelsen"}', 50),
    ('lantmateriet', 'Lantmäteriet', 'Land / Geospatial',
     'Land parcels, development and map foundation (National Geodata Platform).',
     'https://apimanager.lantmateriet.se', 'api_key',
     '{LANTMATERIET_API_KEY,LANTMATERIET_BASE_URL,LANTMATERIET_COLLECTION}', 86400, TRUE, 'land', 259200,
     'lantmateriet', '{"record_source_id":"Lantmateriet"}', 60)
ON CONFLICT (id) DO NOTHING;

-- One row per applied configuration; the highest version is the live state.
CREATE TABLE IF NOT EXISTS control_state (
    version    SERIAL PRIMARY KEY,
    state      JSONB NOT NULL,
    applied_by TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note       TEXT
);

-- Admin users table for database-driven authentication
CREATE TABLE IF NOT EXISTS admin_users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(128),
    role          VARCHAR(32) DEFAULT 'admin',
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login    TIMESTAMPTZ
);

INSERT INTO admin_users (username, password_hash, full_name, role, is_active)
VALUES ('admin', 'admin', 'System Administrator', 'admin', TRUE)
ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_log (
    id       BIGSERIAL PRIMARY KEY,
    ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
    username TEXT NOT NULL,
    action   TEXT NOT NULL,
    summary  JSONB NOT NULL DEFAULT '{}'::jsonb,
    result   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log (ts DESC);

-- Health history for every connector run (scheduled, manual, or test).
CREATE TABLE IF NOT EXISTS source_runs (
    id           BIGSERIAL PRIMARY KEY,
    source_id    TEXT NOT NULL,
    trigger      TEXT NOT NULL DEFAULT 'schedule',      -- schedule | manual | test
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms  INTEGER,
    status       TEXT NOT NULL,                         -- ok | fallback | skipped | error
    data_origin  TEXT,                                  -- live | fallback
    record_count INTEGER NOT NULL DEFAULT 0,
    stored_count INTEGER NOT NULL DEFAULT 0,
    message      TEXT
);
CREATE INDEX IF NOT EXISTS idx_source_runs_source ON source_runs (source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS scenarios (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    driver_source    TEXT NOT NULL,
    driver           JSONB NOT NULL DEFAULT '{}'::jsonb,
    target_year      INTEGER,
    scope            TEXT NOT NULL DEFAULT 'dalarna',
    affected_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    description      TEXT NOT NULL DEFAULT '',
    created_by       TEXT NOT NULL DEFAULT 'system',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'dalarna';
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS affected_sources JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

INSERT INTO scenarios (id, name, driver_source, driver, target_year, scope, affected_sources, description, created_by)
VALUES 
    ('population_growth', 'Population Growth (+10% by 2030)', 'SCB', '{"population_change": 0.10}'::jsonb, 2030, 'dalarna', '["scb", "trafikverket", "sgu", "skogsstyrelsen", "lantmateriet"]'::jsonb, 'Baseline regional demographic growth across 15 municipalities.', 'system'),
    ('rapid_urbanization', 'Rapid Urbanization (+18% by 2035)', 'SCB', '{"population_change": 0.18}'::jsonb, 2035, 'dalarna', '["scb", "trafikverket", "lantmateriet"]'::jsonb, 'Concentrated expansion in Borlänge, Falun, and regional corridors.', 'system'),
    ('climate_freeze_thaw', 'Severe Winter Freeze-Thaw', 'Trafikverket', '{"road_temp_delta": -3.5, "freeze_cycles": 14}'::jsonb, 2026, 'dalarna', '["trafikverket", "smhi", "sgu"]'::jsonb, 'Infrastructure stress and black-ice risk on high-traffic routes (E16).', 'system')
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    driver_source = EXCLUDED.driver_source,
    driver = EXCLUDED.driver,
    target_year = EXCLUDED.target_year,
    scope = EXCLUDED.scope,
    affected_sources = EXCLUDED.affected_sources,
    description = EXCLUDED.description;


CREATE TABLE IF NOT EXISTS simulation_runs (
    run_id        TEXT PRIMARY KEY,
    scenario_id   TEXT REFERENCES scenarios (id),
    is_test       BOOLEAN NOT NULL DEFAULT FALSE,
    input         JSONB NOT NULL,
    result        JSONB NOT NULL,
    model_version TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE simulation_runs ALTER COLUMN run_id TYPE TEXT;
CREATE INDEX IF NOT EXISTS idx_simulation_runs_created ON simulation_runs (created_at DESC);
