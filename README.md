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

## 4. Nouvelles sources nationales (Lantmäteriet, SCB, Skogsstyrelsen, SGU)

En plus de SMHI et Trafikverket, le jumeau numérique intègre désormais quatre
sources nationales via `connectors/` (voir `dalarna-data-mapping.md` pour le
détail de chaque source). Elles sont stockées dans une table séparée,
`regional_datasources`, créée automatiquement au démarrage de l'ingestor
(`db/regional_datasources.sql`) — elle n'altère pas `regional_telemetry`.

Chaque connecteur tourne dans son propre thread avec son propre intervalle
(SGU: 6h, SCB/Skogsstyrelsen/Lantmäteriet: 24h), car ce sont des données
périodiques, pas de la télémétrie temps réel.

### 4.1 Obtenir les identifiants

- **SGU** : aucun identifiant requis (accès ouvert, CC0).
- **SCB** : aucun identifiant requis (PxWebApi v2). Le connecteur recherche
  une table par mot-clé (`SCB_TABLE_QUERY`, défaut `Folkmängd`) sauf si
  `SCB_TABLE_ID` est fixé dans `.env`.
- **Skogsstyrelsen** : enregistrer une application sur
  https://www.skogsstyrelsen.se/skogsstyrelsensapi pour obtenir un
  `ClientId`/`ClientSecret` (flux OAuth 2.0 Client Credentials, jeton valable
  60 minutes). Renseigner `SKOGSSTYRELSEN_CLIENT_ID` et
  `SKOGSSTYRELSEN_CLIENT_SECRET` dans `.env`.
- **Lantmäteriet** : créer un compte sur https://apimanager.lantmateriet.se,
  souscrire au produit NGP souhaité (l'authentification et l'URL varient
  selon le produit — cf. mapping doc section 4.1) puis renseigner
  `LANTMATERIET_API_KEY`, `LANTMATERIET_BASE_URL` et
  `LANTMATERIET_COLLECTION` dans `.env`. Sans ces trois valeurs, le
  connecteur se désactive proprement (log d'avertissement, pas de crash).

Copier `.env.example` vers `.env` et compléter les valeurs avant de démarrer
les conteneurs.

### 4.2 Vérifier chaque connecteur

```
pip install -r requirements.txt
python verify_sources.py            # les 4 connecteurs
python verify_sources.py sgu scb    # un sous-ensemble
```

Le script exécute chaque connecteur une fois, imprime un statut
Pass/Partial(skipped)/Fail avec preuve (nombre d'enregistrements, extrait
d'un enregistrement, message d'erreur), sur le modèle du tableau de
vérification section 8 de `dalarna-data-mapping.md` — à reporter dans ce
tableau une fois testé en conditions réelles.

### 4.3 Visualisation

- **Carte (index.html)** : panneau "Sources nationales" avec un interrupteur
  par source (SGU, Skogsstyrelsen, Lantmäteriet). SCB n'a pas de géométrie
  (indicateurs tabulaires) donc n'apparaît pas sur la carte — voir Grafana.
- **Grafana** : aucun provisioning automatique n'est configuré pour ce
  dépôt (comme pour le tableau de bord SMHI/Trafikverket existant, créé
  manuellement). Importer `grafana/dashboards/regional_datasources.json`
  via *Dashboards → Import → Upload JSON file*, puis associer la source de
  données PostgreSQL/TimescaleDB existante à la variable demandée. Il
  contient un panneau table par source plus un panneau de comptage par
  source/dataset (observabilité).

### 4.4 Rebuild après modification de `.env`

Après avoir renseigné les identifiants dans `.env`, relancer les conteneurs
pour les prendre en compte (même commande qu'à l'étape 1) :

```
docker compose up -d --build
```
