# Dalarna Digital Twin — Guide de démarrage

## 1. Démarrage des conteneurs
docker compose up -d --build

## 2. Initialisation de la base

Automatique : au démarrage, l'application applique `db/telemetry.sql`,
`db/regional_datasources.sql` et `db/control.sql` (idempotents) et crée l'état de
contrôle initial. Plus besoin de la commande `psql` manuelle. Les données
existantes ne sont jamais modifiées ni supprimées.

Variables à définir dans `.env` (voir `.env.example`) : `POSTGRES_*`,
`ADMIN_USERNAME`, `ADMIN_PASSWORD` (sans mot de passe, la connexion admin est
désactivée), `SESSION_SECRET` (conseillé) et `PUBLIC_SIMULATION`.

## 3. Accès aux services
- Interface principale : http://localhost:8000 (`#/overview`, `#/map`, `#/municipalities`, `#/data-sources`…)
- Panneau d'administration : http://localhost:8000/admin (connexion `ADMIN_USERNAME` / `ADMIN_PASSWORD`)
- API : http://localhost:8000/api/... (ex. `/api/control/state`, `/api/datasources/summary`)
- Tableau de bord Grafana : http://localhost:3000 (utilisateur `admin`, mot de passe = `GRAFANA_ADMIN_PASSWORD` dans `.env`)

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

## 5. Notes d'exploitation (phase 1)

- **Aucune donnée inventée** : si une source échoue, rien n'est écrit et l'erreur est
  enregistrée (`source_runs`). Une source sans identifiants affiche « Not configured ».
  Les valeurs statiques SCB utilisées quand `api.scb.se` est injoignable sont étiquetées
  « fallback data » et ne comptent pas comme « online ».
- Trafikverket : connecteur réel (WeatherMeasurepoint) activé dès que
  `TRAFIKVERKET_API_KEY` est renseignée. L'ancienne valeur dérivée « air − 1,2 °C » a été supprimée.
- Les lignes historiques déjà présentes (route dérivée, anciennes valeurs de repli) ne sont
  pas supprimées mais ne sont jamais affichées ni utilisées.
- Tests : `pip install -r requirements-dev.txt` puis `pytest` (nécessite PostgreSQL sur
  `localhost:5432`, par ex. `docker compose up -d timescaledb`; une base `dalarna_dt_test` est créée).

## 6. Données cartographiques

`static/data/dalarna_municipalities.geojson` : les 15 communes du comté de Dalarna (län 20),
extraites et simplifiées à partir de
https://github.com/okfse/sweden-geojson (Open Knowledge Sweden), elles-mêmes dérivées des
données de Valmyndigheten via OpenDataSoft. Le dépôt indique « Feel free to reuse » mais ne
contient pas de fichier de licence explicite : vérifier les conditions avant une diffusion publique.
