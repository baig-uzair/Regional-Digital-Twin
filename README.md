# Dalarna Digital Twin — Guide de démarrage

## 1. Démarrage des conteneurs
docker compose up -d --build

## 2. Initialisation de PostGIS et de la table spatiale
docker compose exec -T timescaledb psql -U postgres -d dalarna_dt -c "
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS regional_telemetry (
    time TIMESTAMPTZ NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    temperature DOUBLE PRECISION,
    geom GEOMETRY(Point, 4326)
);
SELECT create_hypertable('regional_telemetry', 'time', if_not_exists => TRUE);
"

## 3. Accès aux services
- Application web : http://localhost:8000
- Tableau de bord Grafana : http://localhost:3000 (identifiants: admin / admin)
