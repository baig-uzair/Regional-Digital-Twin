# Task: Build the Main Interface + Admin Control Panel for the Dalarna Digital Twin

You are working in the `dalarna-digital-twin-students` repo (Windows machine, Docker Desktop, Python 3.13).
Goal: turn the current prototype into the stakeholder **Main Interface** and the **Admin Control Panel** described in the specs below, with a real backend behind every button.

## Source of truth

- `docs/specs/main-interface-spec.md`: behaviour of every control on the Main Interface.
- `docs/specs/admin-control-spec.md`: behaviour of every tab/button on the Admin Control Panel.
- `docs/design/main-dashboard.jpg` and `docs/design/admin-control.jpg`: layout and visual style only. **The numbers in the images are placeholders.**

Specs decide behaviour. Images decide look and hierarchy. Where this prompt contradicts the specs or images, **this prompt wins**. The corrections are listed in section 2.

---

## 0. Inspect first, then plan (no code yet)

1. Read the existing code: `ingestor.py`, `connector_runner.py`, `connectors/*`, `datasource_store.py`, `db/*.sql`, `index.html`, `Dockerfile`, `docker-compose.yml`, `grafana/`, `verify_sources.py`, `README.md`, `dalarna-data-mapping.md`.
2. Find out and report:
   - how the web app on :8000 is served today (static server? FastAPI? Flask?)
   - which map library `index.html` uses
   - the schemas of `regional_telemetry` and `regional_datasources`
   - how SMHI and Trafikverket ingestion works, and how the connector threads and intervals are scheduled
3. Run `docker info`. If Docker Desktop is not running, tell me so I can start it. You can keep writing code meanwhile, but don't claim anything works until it has been tested against the running stack.
4. Run `git status` and create a branch `feature/control-dashboard`. Never commit `.env`. Don't push unless I ask.
5. Give me a short plan: files to add or change, the DB tables, the API list, and the phase order. **Wait for my OK before coding.**

---

## 1. Architecture

```
Admin Control Panel (/admin) ─┐
                              ├─> FastAPI (/api/...) ─> TimescaleDB/PostGIS ─> connectors + scheduler
Main Interface (/) ───────────┘                      └─> simulation engine
Grafana (:3000) ── reads the same DB, used for monitoring and time series only
```

- **One FastAPI service** serves the static frontend and `/api`. If :8000 is currently something else, migrate it to FastAPI in the same container/service.
- **Frontend: vanilla JS + ES modules, no build step.** Split the current `index.html` into `static/` (`index.html`, `admin.html`, `css/`, `js/`). Use hash routing for the 8 left-nav pages. Keep the current map library if it can do polygons, zoom and layer toggles (Leaflet is fine). Don't rewrite it for its own sake.
- **Pending vs applied state:** the admin edits a *pending* state in the browser. **Save & Apply** posts it to `POST /api/control/apply` together with the base version it was edited from (optimistic concurrency: reject with 409 if the base version is stale). Each apply stores a new version row. The Main Interface polls `GET /api/control/state` every 15 s and re-renders when the version changes.
- **Admin Preview = the real Main Interface**, loaded in an iframe as `/?preview=1`. The admin page sends the pending state with `postMessage`, and the preview renders that state instead of the applied one. This keeps one rendering codebase, as the spec requires ("same backend state model", "not a separate invented design").

## 2. Corrections to the specs and mockups (important)

1. **The Admin panel is a custom page, not a Grafana dashboard.** Grafana panels can't do pending/apply state, POST actions, forms or a live preview. Build `/admin` with Grafana's dark look, as in the mockup. Grafana stays for monitoring: **provision** its datasource and dashboards automatically (`grafana/provisioning/...`) instead of the current manual JSON import. Link it from the admin header ("View in Grafana") and from the System tab.
2. **Never show fake numbers or a fake "Online" status.** The mockup shows 6/6 Online, ~450,000 ha forest and 12,450 parcels. Skogsstyrelsen and Lantmäteriet have no credentials yet, and `TRAFIKVERKET_API_KEY` is still a placeholder. Each source card must honestly show one of: `Online`, `Stale` (older than its freshness rule), `Error` (with the last error), `Not configured` (credentials missing), or `Disabled`. The header shows a computed `x/6 sources online`. An SCB fallback dataset must be labelled "fallback data", not "live".
3. **The mockup map is wrong.** It is missing **Rättvik**, and its shapes aren't geographic. Use real boundaries for all 15 municipalities. Bundle a simplified open GeoJSON at `static/data/dalarna_municipalities.geojson` (filter to län 20) and record its source and licence in the README. Codes: 2021 Vansbro, 2023 Malung-Sälen, 2026 Gagnef, 2029 Leksand, 2031 Rättvik, 2034 Orsa, 2039 Älvdalen, 2061 Smedjebacken, 2062 Mora, 2080 Falun, 2081 Borlänge, 2082 Säter, 2083 Hedemora, 2084 Avesta, 2085 Ludvika.
4. **SMHI must not change in a population scenario.** The mockup shows "7.1 → 7.3 °C" there, which contradicts the spec. SMHI stays unchanged and is marked `External` unless the scenario is explicitly a climate scenario.
5. **Population driver semantics.** Slider "+10% by 2030" means **total change by the target year**: future = current × 1.10. This matches the mockup (288,000 → 316,800). Offer "annual growth rate" mode in Advanced options as an alternative: future = current × (1+r)^(target_year − base_year).
6. **"Current (2025)" must not be hard-coded.** Derive the year from the latest real data period. Target years are 2026, 2030, 2035 and 2040.
7. **Orion-LD** (named in the admin spec) is out of scope. Don't add it.
8. The source list must be **dynamic** (a source registry), not six hard-coded cards. A 7th source must appear without frontend changes.

## 3. Data model

Put the new SQL in `db/control.sql` and apply it idempotently at startup, the same way `regional_datasources.sql` is applied.

- `source_registry`: id, name, category, description, base_url, auth_type, `auth_env_vars` (names only, **never secret values**), interval_seconds, enabled, map_layer, freshness_seconds, config jsonb, timestamps. Seed it with the 6 sources and their current intervals.
- `control_state`: version (serial), state jsonb, applied_by, applied_at. The latest row is the live state. Seed it with the example in admin spec §16, plus risk thresholds and the component visibility flags.
- `audit_log`: user, timestamp, action, payload summary, result.
- `scenarios`: id, name, driver_source, driver jsonb, target_year, scope, affected_sources, created_by, timestamps.
- `simulation_runs`: run_id (uuid), scenario_id, is_test, input jsonb, result jsonb, model_version, created_at.

Disabling a source stops its scheduled ingestion only. **Never delete or modify historical rows.**

## 4. Simulation engine

Put it in `simulation/engine.py`: pure Python, no I/O, unit tested.

- The dependency graph and coefficients live in `config/simulation_model.json`, versioned and documented. Default chain: population (SCB) → traffic demand (Trafikverket) → infrastructure pressure; population → land development (Lantmäteriet) → environment/forest (Skogsstyrelsen); population → water exposure (SGU). SMHI is an external condition.
- Use per-municipality baselines from real SCB data. Compute risk scores from 0 to 1 per category: food/supply, snow/flood, infrastructure, environment. Overall risk is a configurable weighted combination. Classify with the thresholds from control state (defaults: LOW <0.30, MEDIUM <0.60, HIGH <0.80, CRITICAL ≥0.80).
- If a source has no data, or is toggled out of the scenario, its consequence is marked `excluded` / `no data`, not invented.
- Every result contains: run_id, scenario, target year, scope, affected sources, per-municipality impacts, regional risk, category breakdown, assumptions, model_version, timestamp, and `"simulated": true`.
- `POST /api/simulation/test` runs the same engine but stores `is_test=true` and never becomes the "latest official" result.
- Live mode risk is the same engine with a zero driver, applied to current data.
- The Key Takeaway text is generated deterministically from the result (template-based, no LLM).

## 5. API

Implement the union of the endpoint lists in **admin spec §15** and **main-interface spec §19**, plus:

- `GET /api/datasources/summary` and `GET /api/datasources?source=…`
- `GET /api/municipalities` and `GET /api/municipalities/{code}`
- `GET /api/export?format=csv|xlsx|json&run_id=…&filter=…` (use openpyxl for XLSX; PDF can come later)
- `GET /api/control/export-config` and `POST /api/control/import-config/validate`. Validate returns a diff; nothing is applied until Save & Apply.
- `GET /api/system/health`: DB, scheduler, each connector, and the last error.

Rules:

- Validate input with Pydantic. Return errors in one JSON shape. Log server-side.
- **Auth:** every mutating `/api/control/*`, `/api/risk/config` POST and source endpoint requires an admin login. Read `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env` (add both to `.env.example`), use a session cookie, and protect `/admin`. Main Interface read endpoints and `POST /api/simulation/run` from the Main Interface are public for now; make that a config flag.
- Scheduler: connector intervals come from `source_registry` and are re-read after Apply. **Refresh Now** triggers one immediate run. **Test Connection** fetches without storing and returns ok/fail, response time and a sample count. **Refresh All** returns per-source results plus a total.

## 6. Main Interface (`/`)

Follow `main-interface-spec.md` section by section. Keep the hierarchy: **source cards → map → Simulation Control → Simulation Results → Impact by Source → Municipality Results.**

- Header: computed system status, last update, Current/Simulation toggle, and a clear **SIMULATION MODE** banner with the target year whenever simulation is shown.
- Source cards come from the registry and show honest status (§2.2). Clicking a card opens a detail drawer.
- Map: risk category selector, zoom, a layer menu (boundaries, weather, roads, water/geology, forest, land, simulation risk), a municipality click quick detail, the legend and a scale bar.
- Simulation Control is **one** editor. Slider and number stay in sync. Changing year or driver marks the shown result **pending**. Run is disabled while running. Reset restores defaults and never deletes data.
- Results, impact table, map and municipality table update together from one result object. Every simulated value is visibly labelled simulated.
- Municipality table: search, filter, export, a View drawer (spec §15) and the "No municipality found" state.
- Implement every message in spec §18 and all six states in §17 (LIVE, SIMULATION, RUNNING, SUCCESS, ERROR, STALE).
- Components hidden by admin control state are not rendered at all (not just greyed out).
- The other nav pages (Map, Simulation, Municipalities, Data Sources, Insights, Reports, Settings) get real but simple content that reuses the same components. No dead links.

## 7. Admin Control Panel (`/admin`)

Follow `admin-control-spec.md`. Tabs: Overview, Dashboard Control, Data Sources, Scenarios, Risk Settings, Map & Regions, Appearance, Users & Access, System.

- Layout: controls on the left/centre, the **live Preview iframe on the right**, as in the mockup.
- Global bar: Live/Simulation, **Save & Apply** (the single commit action), Reset, Refresh Preview, and a "N unsaved changes" indicator. Warn before leaving with unsaved changes.
- Data Sources: registry table with ON/OFF, interval, last update, status, ⚙ Configure (form per spec §6; secrets are shown only as "set / not set"), Test Connection, Refresh Now, ⋯ menu (metadata, recent log), and + Add Source with validation.
- Quick Actions: Run Test Simulation, Refresh All, Export Config, Import Config (shows a diff, then Apply/Cancel).
- Users & Access: the current admin user and an audit log viewer is enough for now.
- Every example in admin spec §14 must behave exactly as written.

## 8. Work in phases (admin spec §18 order)

1. Control state, source enable/disable, map layers, live/simulation mode, Save & Apply, and the Main Interface skeleton with real data
2. Source test, refresh, refresh-all, registry and Add Source
3. Scenarios, test and run simulation, results
4. Risk config, municipality-level calculations, exports
5. Preview ↔ Main Interface synchronisation polish
6. Auth hardening, audit log, import/export config, Grafana provisioning, README

After **each** phase:
- run `pytest`
- rebuild with `docker compose up -d --build`
- curl the new endpoints
- open the pages in a browser and check them
- commit with a clear message
- give me a 3–5 line report of what works, what doesn't and what's untested

## 9. Tests and final verification

- `tests/` with pytest:
  - engine: dependency propagation, SMHI unchanged, excluded sources, threshold classification, total vs annual mode
  - API: FastAPI TestClient, auth required on mutating endpoints, apply/version conflict, import validation
  - config schema validation
- At the end, write `docs/ACCEPTANCE.md`. Walk through **both** acceptance checklists (main spec §22 and admin spec §19) and mark each item Pass / Fail / Not tested, with evidence (command output, endpoint response, or what you saw in the browser).
- Update `README.md` (keep its existing French) with: new env vars, how to start, URLs (`/`, `/admin`, Grafana), and how to add a new source.

## Don'ts

- Don't hard-code mockup numbers, the source list, risk thresholds or the current year in JS.
- Don't expose API keys anywhere in the frontend, Grafana variables or exported config.
- Don't delete data when something is disabled, hidden or reset.
- Don't build six separate simulation boxes.
- Don't add controls that have no defined action.
- Don't mark anything as working that you haven't actually run.
