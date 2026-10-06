# AUDIT REPORT - Phase 0

Dalarna Regional Digital Twin: audit of the existing codebase against Spec A (Admin) and Spec B (Main Interface). Date 2026-10-07. No application code was changed in Phase 0.

## 1. What exists today

**Stack.** FastAPI serving a static vanilla-JS frontend (`static/`), psycopg2 to TimescaleDB/PostGIS, Orion-LD (best-effort SMHI mirror only), Mongo (for Orion), Grafana (one French dashboard JSON, no provisioning). Entry point `app/main.py`. Compose services: mongo, orion, timescaledb, ingestor (FastAPI + scheduler), grafana.

**Backend (solid foundation).** DB-backed source registry, versioned `control_state` with optimistic concurrency, `audit_log`, `source_runs`, a registry-driven scheduler that honours saved intervals, honest source status (online/stale/error/not_configured/disabled/fallback), cookie-session admin auth with login throttling, six connectors, 15-municipality GeoJSON (UTF-8 verified). Tables `scenarios` and `simulation_runs` exist but nothing uses them.

**Frontend (mostly a mock-up).** `main.js` renders hard-coded numbers, risk labels and flat-percentage "simulation" maths. `admin.js` renders a hard-coded six-source table where only the ON/OFF toggle and Save & Apply do anything; only the Data Sources tab renders.

**How checked.** Read all backend, frontend, SQL, compose and test files; grepped for DELETE/TRUNCATE, secrets, hard-coded sources/thresholds; verified GeoJSON names; ran `pytest`: **12 passed, 23 skipped**. DB-backed tests skip because Docker Desktop is not running here, so the stack could not be started; DB behaviour findings come from code reading.

## 2. Existing API routes

| Method + path | Handler | Auth | In section 6 |
|---|---|---|---|
| GET /api/control/state | routers/control.py:12 | public | yes (schema differs) |
| POST /api/control/apply | control.py:18 | admin | yes |
| POST /api/control/mode | control.py:27 | admin | yes |
| POST /api/control/source | control.py:37 | admin | yes |
| POST /api/control/map-layer | control.py:45 | admin | yes |
| GET /api/control/map-state | control.py:55 | public | yes |
| GET /api/datasources/summary | routers/data.py:8 | public | yes |
| GET /api/datasources?source= | data.py:13 | public | yes (partial) |
| GET /api/municipalities, /{code} | data.py:18,24 | public | yes (partial) |
| POST /api/auth/login, /logout; GET /api/auth/me | routers/auth.py | - | extra |
| GET /api/system/health | routers/system.py:11 | admin | implied (partial) |
| GET /api/station, /station-air, /air-weather | telemetry.py:110 | public | legacy |
| GET /api/road-weather, /road-station, /station-road, /road | telemetry.py:128 | public | legacy |
| GET /api/simulation/predict | telemetry.py:152 | public | legacy frost model |
| POST /api/simulation/what-if | telemetry.py:161 | public | legacy frost model |
| GET /admin, /login, /cockpit | main.py:123-139 | /admin needs cookie | pages |

**Missing from section 6:** source/test, source/refresh, source/register, refresh-all, simulation/scenarios, simulation/run, simulation/test, simulation/result/{id}, simulation/result/latest, risk/config (GET+POST), risk/calculate. Implied and missing: scenario CRUD, config export/import, audit-log read.

## 3. UI inventory and handler trace

| Where | Control | Handler / backend | Result |
|---|---|---|---|
| Main header | System Online 6/6, Last update | none (hard-coded text) | dead + fake |
| Main header | Dalarna chip | none | decorative |
| Main header | Current (2025) / Simulation (2030) | main.js:109 local year only | partial |
| Main nav | Overview, Map, Municipalities | hash routes | work (fake data) |
| Main nav | Simulation, Data Sources, Insights, Reports, Settings | placeholder main.js:731 | dead |
| Source cards x6 | click | none | dead |
| Map | Zoom +/- | map.js | works |
| Map | Layers icon, Risk selector | none | dead |
| Map | Polygon click | drawer, hard-coded values | partial |
| Sim control | Scenario, Scope, 6 toggles, Advanced | no handlers | dead |
| Sim control | Year pills, Slider, Reset | local state only | partial |
| Sim control | Run | legacy what-if with dummy values | fake |
| Result cards, impact rows, gauge | click | none | dead |
| Municipality table | Search, Filter, View | local | work (hard-coded data) |
| Municipality table | Export | client CSV of hard-coded rows | partial |
| Admin sidebar (9 links) | all | anchors only | dead |
| Admin tabs | Data Sources | renders | works |
| Admin tabs | Scenarios, Risk, Map, Visual, Users | all show Data Sources | broken |
| Data Sources | ON/OFF | pending state + postMessage (never received) | partial |
| Data Sources | Interval, Configure, More, Add Source, 6 Active-Data checkboxes | none | dead |
| Quick actions | Run Test Simulation, Refresh Data | fake success | fake |
| Quick actions | Export / Import Configuration | client JSON / none | partial / dead |
| Save bar | Save & Apply | POST /api/control/apply, hides errors | broken |
| Save bar | Reset to Default | restores saved | works (mislabelled) |

## 4. State model

- **Saved:** table `control_state` (versioned JSONB, highest version is live) via `app/control.py`: mode, scope, sources (id to bool), source_intervals, layers (8), components (11), risk_thresholds (low/medium/high upper bounds), active_scenario, simulation_year.
- **Pending:** only in the admin browser (`A.pending`, admin.js:6-8). No server draft, no per-session draft, no Cancel. The Preview never consumes it.
- **Not stored anywhere:** scenarios, simulation results, risk config as its own object.
- `main.js` loads `S.control`, `mapState`, `summary`, `munis` and never uses them to render.

## 5. Rule-violation grep results

| Check | Result |
|---|---|
| DELETE/TRUNCATE/DROP on disable | None found. Disable flips `source_registry.enabled` only (control.py:205-209) |
| Hard-coded source lists in frontend | Yes: admin.js:19-26,41; main.js:118-266,359-391 |
| Hard-coded thresholds in JS | Yes: map.js:5-22,86-104; main.js:34-50,296-301,524 |
| Secrets in frontend / Grafana JSON | None found |
| Secrets in git | `.env` is ignored and never committed. But `.env.example:3`, `docker-compose.yml:62`, `ingestor.py:13` hold the same password; README:21 documents admin/admin |
| Simulation writing live tables | No (no backend simulation exists) |
| Flat % on every source | Yes: main.js:271-272,475-503 including SMHI |
| Admin manipulating Main DOM | No (postMessage), but never received, so Preview is inert |
| Invented data served as real | Yes: sources.py:125-241, municipalities.py:47-74, control.py:58-128 |
| 15 municipalities | Yes in GeoJSON (codes 2021-2085, UTF-8 OK); frontend duplicates by hand; no PostGIS municipality table |

## 6. Gap matrix

Evidence path legend: main.js, admin.js, map.js, api.js = static/js/*; control.py, sources.py, jobs.py, scheduler.py, schemas.py, auth.py, municipalities.py, geo.py = app/*.py; routers/* = app/routers/*; *.sql = db/*.sql. Priority: P0 blocker/rule violation/security, P1 required feature, P2 polish, P3 keep.

| ID | Spec | Requirement | Status | Evidence (file:line) | Fix needed | Priority |
|---|---|---|---|---|---|---|
| R-2.1 | Both | Pending vs saved; Save & Apply only commit; Reset discards; Cancel closes | PARTIAL | admin.js:6-8,256,299; control.py:164-211 | Pending only in browser; add server draft + Cancel; Preview never receives pending | P1 |
| R-2.2 | Both | Never delete history on disable | DONE | control.py:203-209; no DELETE/TRUNCATE anywhere; tests/test_control_api.py:102 | Keep (datasource_store.py:42-48 upsert overwrites same-key rows: low risk) | P3 |
| R-2.3 | Both | Dynamic source registry, not hard-coded in frontend | VIOLATES RULE | admin.js:19-26,41; main.js:118-266,359-391; routers/control.py:64-71; jobs.py:106-113 | Render from /api/datasources/summary; generic connector for new sources | P0 |
| R-2.4 | Both | Secrets server-side only (JS/Grafana/git) | VIOLATES RULE | Frontend+Grafana JSON clean; .env.example:3, docker-compose.yml:62, ingestor.py:13 commit password 'DalarnaTwin2026!'; README.md:21 | Rotate, remove from tracked files/history, add secret-scan test | P0 |
| R-2.5 | Both | Live/Simulation never mix; simulated labelled; sim never overwrites live | VIOLATES RULE | main.js:271-272,475-506 client fake sim; municipalities.py:47-63 fallback tagged 'live'; sources.py:125-241 invented stats | Backend engine writes only simulation_runs; remove fabricated fallbacks; label simulated | P0 |
| R-2.6 | Both | Dependency-based simulation; SMHI external | VIOLATES RULE | main.js:475-506 flat multipliers incl. SMHI temp (:503); no backend engine | Implement dependency chain engine | P0 |
| R-2.7 | Both | Risk thresholds backend config, not JS | VIOLATES RULE | map.js:5-22,86-104; main.js:34-50,524; schemas.py:40-51 (no /api/risk/config) | Add /api/risk/config, server-side classification | P0 |
| R-2.8 | Both | 15 municipalities, correct å/ä/ö | PARTIAL | GeoJSON 15 features UTF-8 OK; geo.py:12-21; main.js:34-50 hard-coded; main.js:351-356 only 3 in scope | Drive UI from /api/municipalities; UTF-8 test | P1 |
| R-2.9 | Both | Auth + audit log | PARTIAL | auth.py:49-53; control.py:144-156,210; single env admin; no audit read; fallback path skips audit control.py:214-223 | Roles, audit read endpoint, no silent fallback | P1 |
| R-2.10 | Both | Every control has action + feedback; decorative not buttons | BROKEN | Dead: main.js:292,280-286,361-390,395; admin.js:81-86,91,92,105,136-165,223 | Wire or remove each | P1 |
| R-2.11 | Both | Non-blocking errors, logged, keep previous result | PARTIAL | api.js:3-27; main.py:66-97; main.js:54-60 swallows; admin.js:286 hides failure | Use toast, keep last good result | P1 |
| R-2.12 | Both | Dark clean design; ONE sim control + results | DONE | main.js:316-534 | Keep | P3 |
| A-L.1 | A | Controls left, Preview right; Preview shows real Main look | BROKEN | admin.js:170-187 iframe; admin.js:51-55 postMessage but main.js has no listener | Implement preview protocol using same Main components | P0 |
| A-3.1 | A | Tab: Overview | MISSING | No tab admin.html:191-209 | Build | P1 |
| A-3.2 | A | Tab: Dashboard Control | MISSING | Sidebar label only admin.html:140 | Build mode/scenario/year/scope/components | P0 |
| A-3.3 | A | Tab: Data Sources | PARTIAL | admin.js:57-168 only ON/OFF works | Add interval/configure/test/refresh/add/more | P0 |
| A-3.4 | A | Tab: Scenarios | BROKEN | admin.html:195; render ignores activeTab admin.js:235-248 | Build + tab router | P0 |
| A-3.5 | A | Tab: Risk Settings | BROKEN | admin.html:198 same render bug | Build | P0 |
| A-3.6 | A | Tab: Map & Regions | BROKEN | admin.html:201 same | Build | P1 |
| A-3.7 | A | Tab: Appearance | BROKEN | Named 'Visual Settings' admin.html:204; same bug | Build; share components object | P1 |
| A-3.8 | A | Tab: Users & Access | BROKEN | admin.html:207 same bug | Build read-only access + roles | P2 |
| A-3.9 | A | Tab: System | MISSING | No tab; /api/system/health exists system.py:11-28 | Build | P1 |
| A-4.1 | A | Live button -> POST /api/control/mode | MISSING | No button; endpoint routers/control.py:27-34 | Add + LIVE preview indicator | P1 |
| A-4.2 | A | Simulation button -> POST /api/control/mode | MISSING | No button | Add + SIMULATION banner | P1 |
| A-4.3 | A | Save & Apply -> POST /api/control/apply | BROKEN | admin.js:275-293 any error => 'Saved changes applied locally.' (:286), local version bump (:285) | Show real error; show version/time/affected | P0 |
| A-4.4 | A | Reset restores last saved | PARTIAL | admin.js:299-303; labelled 'Reset to Default' admin.html:236 | Relabel; reset server draft | P2 |
| A-4.5 | A | Refresh Preview | MISSING | No button | Add | P2 |
| A-4.6 | A | Cancel | MISSING | No button | Add | P2 |
| A-5.1 | A | Dashboard Control: Live/Sim, scenario, year, scope | MISSING | State fields schemas.py:55-63; no UI | Build | P0 |
| A-5.2 | A | 10 component toggles | PARTIAL | schemas.py:26-37 (key food_risk vs food_supply_risk); no UI; Main ignores S.control | UI + Main honours | P0 |
| A-5.3 | A | OFF hides visual only | MISSING | Main never reads components | Enforce + test | P1 |
| A-6.1 | A | Source registry, six sources | PARTIAL | db/control.sql:24-54 OK; UI hard-coded admin.js:19-26 with fake lastUpdate | Render from API | P0 |
| A-6.2 | A | ON/OFF -> /api/control/source; dependents 'unavailable' | PARTIAL | routers/control.py:37-42,55-87; Main ignores mapState main.js:65 | Use mapState in Main/Preview | P1 |
| A-6.3 | A | Configure form | MISSING | admin.js:91 dead; no endpoint | Endpoint + form | P1 |
| A-6.4 | A | Test Connection endpoint/UI | MISSING | Absent; trigger 'test' reserved control.sql:79 | Implement, store nothing | P1 |
| A-6.5 | A | Refresh Now endpoint/UI | MISSING | Absent; jobs.run_source jobs.py:133 | Implement | P1 |
| A-6.6 | A | Add Source -> /register | MISSING | Absent; CONNECTORS static jobs.py:106-113; admin.js:105 dead | Endpoint + generic connector | P0 |
| A-6.7 | A | More menu | MISSING | admin.js:92 dead | Metadata/log menu | P2 |
| A-6.8 | A | Config form fields | PARTIAL | Columns control.sql:5-22; missing data types/storage policy/coverage | Extend config JSONB + form | P1 |
| A-6.9 | A | Scheduler uses saved interval after Apply | DONE | control.py:205-209; scheduler.py:59-85; tests/test_control_api.py:47 | Keep; wire UI select | P3 |
| A-7.1 | A | ONE Scenario Editor controls | MISSING | No UI | Build | P0 |
| A-7.2 | A | Scenario CRUD | MISSING | Table control.sql:90-101 unused | Implement + seed | P0 |
| A-7.3 | A | Population formula current*(1+g)^years | MISSING | None | Implement + test | P0 |
| A-7.4 | A | Configurable documented coefficients | MISSING | None | Config + docs | P0 |
| A-7.5 | A | POST /api/simulation/run | MISSING | Only legacy frost endpoints telemetry.py:152-164 | Implement; keep legacy as alias | P0 |
| A-7.6 | A | POST /api/simulation/test (safe) | MISSING | None | Implement | P0 |
| A-7.7 | A | Result fields (run id, scenario, year, scope, sources, impacts, risk, assumptions, ts) | MISSING | simulation_runs control.sql:103-111 unused | Implement + GET endpoints | P0 |
| A-8.1 | A | Sim Preview: Header (scenario/year/scope/SIMULATION MODE) | MISSING | None | Render from stored result | P1 |
| A-8.2 | A | Sim Preview: Impact Summary | VIOLATES RULE | main.js:530 fabricated | Render from stored result | P0 |
| A-8.3 | A | Sim Preview: Cross-Source Impact | VIOLATES RULE | main.js:465-506 flat | Render from stored result | P0 |
| A-8.4 | A | Sim Preview: Regional Risk + breakdown | VIOLATES RULE | main.js:515-524 static | Render from stored result | P0 |
| A-8.5 | A | Sim Preview: Map coloured by risk | VIOLATES RULE | map.js:86-104 hard-coded | Render from stored result | P0 |
| A-8.6 | A | Sim Preview: Municipality table | VIOLATES RULE | main.js:34-50,551-578 hard-coded | Render from stored result | P0 |
| A-8.7 | A | Sim Preview: Assumptions + model version | MISSING | None | Render from stored result | P1 |
| A-8.8 | A | Sim Preview: Timestamp + result ID | MISSING | None | Render from stored result | P1 |
| A-9.1 | A | Editable LOW/MED/HIGH/CRITICAL | MISSING | No UI | Build | P0 |
| A-9.2 | A | Preview recalculates live | MISSING | None | Use /api/risk/calculate | P1 |
| A-9.3 | A | Save Risk Settings persists | PARTIAL | In control state schemas.py:40-51 (3 keys); no endpoints | GET/POST /api/risk/config, 4-band, alias | P0 |
| A-9.4 | A | Main uses new thresholds after Apply | VIOLATES RULE | Hard-coded main.js/map.js | Server-classified labels | P0 |
| A-9.5 | A | Reset restores saved | MISSING | None | Add | P2 |
| A-9.6 | A | Validation ascending/0-1/no gaps | PARTIAL | schemas.py:47-51 requires 0<low | 4-band validator | P1 |
| A-10.1 | A | 8 layer toggles | PARTIAL | schemas.py:15-23; routers/control.py:45-52; no UI; map.js only boundaries :193-198 | UI + real layers | P1 |
| A-10.2 | A | Municipality selector | PARTIAL | schemas.py:56,65-70; no UI; main.js:351-356 | Build from API | P1 |
| A-11.1 | A | Appearance show/hide 7 components | MISSING | No UI | Shared components object | P1 |
| A-12.1 | A | Run Test Simulation | BROKEN | admin.js:315-320 legacy what-if, fake pass | Real endpoint | P1 |
| A-12.2 | A | Refresh All | BROKEN | admin.js:307-312 GET summary, claims synced | Real endpoint | P0 |
| A-12.3 | A | Export Configuration | PARTIAL | admin.js:323-330 client-side | Server export | P2 |
| A-12.4 | A | Import: validate, summary, Apply/Cancel | MISSING | admin.js:223 dead | Implement | P1 |
| A-12.5 | A | Save & Apply shows version/time/affected | PARTIAL | Backend control.py:210-211; UI discards | Show | P1 |
| A-13.1 | A | Preview area: Header+mode+last update+scope | VIOLATES RULE | main.js:79-107 hard-coded | Drive from backend | P0 |
| A-13.2 | A | Preview area: Six source cards | VIOLATES RULE | main.js:118-266 hard-coded | Drive from backend | P0 |
| A-13.3 | A | Preview area: Dalarna map with risk | PARTIAL | Real map map.js:60-130, fake colours | Drive from backend | P1 |
| A-13.4 | A | Preview area: Regional risk summary | VIOLATES RULE | main.js:511-533 static | Drive from backend | P0 |
| A-13.5 | A | Preview area: Sim results/cross-source | VIOLATES RULE | main.js:399-509 static | Drive from backend | P0 |
| A-13.6 | A | Preview area: Municipality table | VIOLATES RULE | main.js:538-651 hard-coded | Drive from backend | P0 |
| A-14.1 | A | Preview test: SMHI OFF pending-off then Main disabled | BROKEN | No listener; no disabled state | Implement + Playwright | P0 |
| A-14.2 | A | Preview test: Forest layer OFF preview then Main | MISSING | No layer UI; map.js overlays no-op :210-212 | Implement + Playwright | P0 |
| A-14.3 | A | Preview test: Population +10%/2030 preview then Main | MISSING | No engine/persistence | Implement + Playwright | P0 |
| A-14.4 | A | Preview test: Change HIGH threshold | MISSING | No threshold UI/engine | Implement + Playwright | P0 |
| A-14.5 | A | Preview test: Select Borlänge focus then saved scope | MISSING | setScope map.js:199-209 never called | Implement + Playwright | P1 |
| A-14.6 | A | Preview test: Change interval pending then scheduler | MISSING | Select not wired admin.js:81-86 | Implement + Playwright | P1 |
| A-17.1 | A | Admin auth on control endpoints | DONE | auth.py:49; routers/control.py:19,28,38,46; tests:24 | Keep | P3 |
| A-17.2 | A | No secrets in frontend/Grafana | VIOLATES RULE | docker-compose.yml:62 Grafana password, anonymous Viewer :63-64, sanitize off :68 | Move to .env, disable anon, rotate | P0 |
| A-17.3 | A | Validate imported config | MISSING | No import | pydantic + registry checks | P1 |
| A-17.4 | A | Audit log | PARTIAL | control.py:144-156; no read endpoint; skipped on fallback | GET /api/audit-log; audit all mutations | P1 |
| A-17.5 | A | Never delete history | DONE | See R-2.2 | Keep | P3 |
| A-17.6 | A | Sim labelled as scenarios not forecasts | MISSING | No disclaimer | Label everywhere | P1 |
| A-17.7 | A | Authorization/roles | PARTIAL | Single credential auth.py:63-77; no RBAC/CSRF token | Roles | P2 |
| B-4.1 | B | System Online / 6/6 -> health summary | VIOLATES RULE | main.js:85-90 hard-coded; data data.py:8 | Bind + popover | P0 |
| B-4.2 | B | Last update -> per-source timestamps | VIOLATES RULE | main.js:96 hard-coded | Bind + popover | P0 |
| B-4.3 | B | Dalarna chip scope info | PARTIAL | main.js:99-102 static | Popover | P3 |
| B-4.4 | B | Current (2025) -> live | BROKEN | main.js:109-114 local year only | Session live view | P1 |
| B-4.5 | B | Simulation (2030) -> simulation + year | BROKEN | main.js:109-114 | Session sim view + banner | P1 |
| B-4.6 | B | User icon menu | MISSING | Absent | Add | P2 |
| B-5.1 | B | Nav: Overview | PARTIAL | main.js:709-716 fake data | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-5.2 | B | Nav: Map | PARTIAL | main.js:717-727 no controls | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-5.3 | B | Nav: Simulation | MISSING | Placeholder main.js:731-738 | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-5.4 | B | Nav: Municipalities | PARTIAL | main.js:728-730 table only | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-5.5 | B | Nav: Data Sources | MISSING | Placeholder | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-5.6 | B | Nav: Insights | MISSING | Placeholder | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-5.7 | B | Nav: Reports | MISSING | Placeholder | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-5.8 | B | Nav: Settings | MISSING | Placeholder | Real page; support path URLs (hash today index.html:29-57) | P1 |
| B-6.1 | B | Cards show real status/values | VIOLATES RULE | main.js:118-266 hard-coded, always Online | Bind to summary | P0 |
| B-6.2 | B | Cards clickable drill-down x6 | MISSING | No click handler | Drawer per source | P1 |
| B-6.3 | B | GET /api/datasources?source= records | PARTIAL | data.py:13-15 GeoJSON only | Add metrics/trends | P1 |
| B-6.4 | B | Online badge read-only | DONE | <span> main.js:133 | Keep; real status | P3 |
| B-7.1 | B | Risk selector recolours map | BROKEN | main.js:280-286 no handler; Snow/Flood missing; map.js:215-219 no-op | Wire | P1 |
| B-8.1 | B | Zoom +/- | DONE | main.js:671-672; map.js:164-170 | Keep | P3 |
| B-8.2 | B | Layers icon menu | BROKEN | main.js:292 no handler | Layer menu | P1 |
| B-8.3 | B | Polygon click quick detail | PARTIAL | map.js:149-155; main.js:675-696 hard-coded | Use API | P1 |
| B-8.4 | B | Legend + scale read-only | PARTIAL | main.js:296-309 static '40 km' | Legend from risk config; real scale | P2 |
| B-9.1 | B | Scenario dropdown from API | MISSING | main.js:323-328 hard-coded | Implement | P0 |
| B-9.2 | B | Year change makes result pending | PARTIAL | main.js:333-338,755-761 | Pending/stale handling | P0 |
| B-9.3 | B | Slider + numeric synced/validated | PARTIAL | Slider only main.js:346 | Add input + validation | P1 |
| B-9.4 | B | Scope dropdown | BROKEN | 3 options main.js:351-356; S.simScope unused | 15 + pass to run | P1 |
| B-9.5 | B | Source dependency toggles | BROKEN | No handlers main.js:361-390 | Wire to run | P1 |
| B-9.6 | B | Run -> POST /api/simulation/run, all panels | VIOLATES RULE | main.js:764-788 dummy what-if + 350ms setTimeout | Real call | P0 |
| B-9.7 | B | Reset clears pending result | PARTIAL | main.js:793-799 | Clear result | P2 |
| B-9.8 | B | Advanced options | BROKEN | main.js:395 static | Panel | P2 |
| B-10.1 | B | Run flow states | MISSING | Only 'Simulating...' main.js:767 | State machine | P0 |
| B-11.1 | B | 5 result cards clickable | VIOLATES RULE | main.js:408-449 hard-coded | Bind + drawer | P0 |
| B-12.1 | B | Impact by Source table traceable, rows clickable | VIOLATES RULE | main.js:465-506 flat; SMHI changes :503 | Bind to result | P0 |
| B-13.1 | B | Gauge, label, takeaway, methodology | VIOLATES RULE | main.js:512-533 static | Bind | P0 |
| B-14.1 | B | Search + 'No municipality found.' | PARTIAL | main.js:801-842 no message | Add | P2 |
| B-14.2 | B | Filter dropdown | PARTIAL | main.js:595-600 no critical | Use risk config | P2 |
| B-14.3 | B | View + row click | PARTIAL | main.js:873-877 no row click | Add | P2 |
| B-14.4 | B | Risk badge detail; trend hover | MISSING | main.js:567-569 static | Bind | P2 |
| B-15.1 | B | Detail drawer full content + Back to Regional View | PARTIAL | main.js:675-696 partial | Complete | P1 |
| B-16.1 | B | Export CSV filtered view | PARTIAL | main.js:856-868 all hard-coded rows | Filtered backend export | P1 |
| B-16.2 | B | Export XLSX | MISSING | None | Add | P2 |
| B-16.3 | B | Export JSON run ID + assumptions | MISSING | None | Add | P1 |
| B-16.4 | B | PDF/report | MISSING | None | Optional | P3 |
| B-17.1 | B | LIVE state | MISSING | Simulated always shown | Mode-aware | P0 |
| B-17.2 | B | SIMULATION banner | MISSING | #banner empty index.html:79 | Banner | P1 |
| B-17.3 | B | RUNNING state | PARTIAL | main.js:767-768 | Progress | P1 |
| B-17.4 | B | SUCCESS consistent panels | MISSING | Independent hard-coded | Single result store | P0 |
| B-17.5 | B | ERROR keep previous | MISSING | main.js:780 swallowed | Toast + keep | P1 |
| B-17.6 | B | STALE | PARTIAL | Backend sources.py:56-57; no UI | Indicator | P1 |
| B-18.1 | B | Message: Running simulation... Please wait. | MISSING | main.js:767 differs | Exact wording | P2 |
| B-18.2 | B | Message: Simulation completed successfully. Result ID: ... | MISSING | main.js:784 differs | Exact wording | P2 |
| B-18.3 | B | Message: Unable to retrieve this source. Showing last available data. | MISSING | Absent | Exact wording | P2 |
| B-18.4 | B | Message: Data may be outdated. Last update: ... | PARTIAL | Backend sources.py:57; no UI | Exact wording | P2 |
| B-18.5 | B | Message: Please correct the highlighted value(s). | PARTIAL | Server main.py:75; no UI | Exact wording | P2 |
| B-18.6 | B | Message: Export created successfully. | MISSING | main.js:866 differs | Exact wording | P2 |
| B-18.7 | B | Message: Export could not be created. Please try again. | MISSING | Absent | Exact wording | P2 |
| B-18.8 | B | Message: No municipality found. | MISSING | Absent | Exact wording | P2 |
| E-1 | Both | Endpoint: GET /api/control/state | PARTIAL | routers/control.py:12; schema differs from spec | Extend additively | P1 |
| E-2 | Both | Endpoint: POST /api/control/apply | PARTIAL | routers/control.py:18; DB-down silent memory save control.py:214-223 | Server draft; remove fallback | P0 |
| E-3 | Both | Endpoint: POST /api/control/mode | PARTIAL | routers/control.py:27; no scenario_id | Add scenario_id | P1 |
| E-4 | Both | Endpoint: POST /api/control/source | DONE | routers/control.py:37 | Keep | P3 |
| E-5 | Both | Endpoint: POST /api/control/source/test | MISSING | Absent | Implement | P1 |
| E-6 | Both | Endpoint: POST /api/control/source/refresh | MISSING | Absent | Implement | P1 |
| E-7 | Both | Endpoint: POST /api/control/source/register | MISSING | Absent | Implement | P0 |
| E-8 | Both | Endpoint: POST /api/control/refresh-all | MISSING | Absent | Implement | P0 |
| E-9 | Both | Endpoint: POST /api/control/map-layer | DONE | routers/control.py:45 | Keep | P3 |
| E-10 | Both | Endpoint: GET /api/control/map-state | DONE | routers/control.py:55-87; fallback :64-71 | Remove fallback | P2 |
| E-11 | Both | Endpoint: GET /api/datasources/summary | DONE | data.py:8; fabricated fallback sources.py:125-241 | Remove fallback | P1 |
| E-12 | Both | Endpoint: GET /api/datasources?source= | PARTIAL | data.py:13 GeoJSON only | See B-6.3 | P1 |
| E-13 | Both | Endpoint: GET /api/simulation/scenarios | MISSING | Absent | Implement | P0 |
| E-14 | Both | Endpoint: POST /api/simulation/run | MISSING | Absent | Implement | P0 |
| E-15 | Both | Endpoint: POST /api/simulation/test | MISSING | Absent | Implement | P0 |
| E-16 | Both | Endpoint: GET /api/simulation/result/{id} | MISSING | Absent | Implement | P0 |
| E-17 | Both | Endpoint: GET /api/simulation/result/latest | MISSING | Absent | Implement | P0 |
| E-18 | Both | Endpoint: GET /api/risk/config | MISSING | Absent | Implement | P0 |
| E-19 | Both | Endpoint: POST /api/risk/config | MISSING | Absent | Implement | P0 |
| E-20 | Both | Endpoint: POST /api/risk/calculate | MISSING | Absent | Implement | P0 |
| E-21 | Both | Endpoint: GET /api/municipalities | PARTIAL | data.py:18; no risk; fabricated fallback municipalities.py:47-74 | Add risk; remove fallback | P1 |
| E-22 | Both | Endpoint: GET /api/municipalities/{id} | PARTIAL | data.py:24 | Add detail | P1 |
| E-23 | Both | Endpoint: Scenario CRUD | MISSING | Absent | Implement | P0 |
| E-24 | Both | Endpoint: Config export/import | MISSING | Absent | Implement | P1 |
| E-25 | Both | Endpoint: Audit-log read | MISSING | Absent | Implement | P1 |
| E-26 | Both | Endpoint: System health (API/DB/Orion-LD/sim) | PARTIAL | system.py:11-28 DB+scheduler only | Add checks | P2 |
| C-1 | Both | Conflict 1: duplicate Map Controls, use fuller | DONE | B-8.x follows fuller | None | P3 |
| C-2 | Both | Conflict 2: Main toggle session-only | PARTIAL | main.js:109-114 already client-only; no session persistence | Session view state | P2 |
| C-3 | Both | Conflict 3: mode accepts year + scenario_id | PARTIAL | schemas.py:87-90 year only | Add scenario_id | P2 |
| C-4 | Both | Conflict 4: extend state schema | PARTIAL | layers/components/version exist; risk config missing | Additive | P1 |
| C-5 | Both | Conflict 5: one components object | DONE | schemas.py:26-37 | Align key names | P3 |
| C-6 | Both | Conflict 6: sources keyed by registry id as objects | PARTIAL | Keyed by id but bool schemas.py:57 | Accept both, emit objects | P2 |
| C-7 | Both | Conflict 7: datasources/municipalities still required | DONE | data.py:8-28 | Keep | P3 |
| X-1 | Both | No invented data when DB/connector unavailable | VIOLATES RULE | control.py:58-128,214-223; sources.py:125-241; municipalities.py:47-74; routers/control.py:64-71 | Return unavailable; tests/test_sources_honesty.py:165 expects null | P0 |
| X-2 | Both | Test coverage of section 9 | PARTIAL | 12 passed, 23 skipped (no Docker); none for sim/risk/register/import/E2E | Add tests | P1 |
| X-3 | Both | Baseline uncommitted | PARTIAL | git: 17 modified files vs HEAD ae69cf3 | Commit baseline first | P1 |
| X-4 | Both | Infra hardening | PARTIAL | docker-compose.yml:5-6,29-30 exposed DBs; :63-68 anon Grafana; :latest; Dockerfile root | Harden | P1 |
| X-5 | A | Admin UI imitates Grafana branding, not Grafana | PARTIAL | admin.html:107-113; grafana JSON French, unprovisioned | Decision needed | P2 |
| X-6 | Both | Legacy cockpit/ingestor.py with creds; French strings | PARTIAL | ingestor.py:13; telemetry.py:31-59; Dockerfile:9-13 omits index.html | Remove creds; keep aliases | P2 |

## 7. Summary counts

| Status | Rows |
|---|---|
| DONE | 14 |
| PARTIAL | 54 |
| MISSING | 74 |
| BROKEN | 18 |
| VIOLATES RULE | 25 |
| **Total** | **185** |

Open rows by priority: P0: 66, P1: 72, P2: 31, P3: 2

## 8. Top 10 risks

1. Main Dashboard is a static mock-up: numbers, risk labels and map colours are hard-coded and would be presented as real data (R-2.5, X-1).
2. No simulation engine or API; client flat-% maths violates the dependency rule and even changes SMHI weather (R-2.6, A-7.x).
3. Risk thresholds hard-coded in JS; no `/api/risk/config` (R-2.7).
4. Credentials committed: `DalarnaTwin2026!` in `.env.example`, `docker-compose.yml`, `ingestor.py`; anonymous Grafana with HTML sanitising off (R-2.4, A-17.2).
5. Save & Apply claims success on failure, and the backend silently "saves" to memory when the DB is down (A-4.3, X-1).
6. Fabricated fallbacks return "Online", 288,000 residents, 87 stations, population tagged `live` when data is unavailable (X-1).
7. Preview is inert; five of six admin tabs render the wrong page; most buttons dead (A-L.1, A-3.x, R-2.10).
8. Sources hard-coded in frontend and job map; a 7th source needs code (R-2.3, A-6.6).
9. source test/refresh/register/refresh-all missing; "Refresh Data" fakes success (A-6.4-6.6, A-12.2).
10. No safety net: DB tests skip, 17 files uncommitted, no tests for simulation/risk/import/registry growth/E2E (X-2, X-3).

## 9. Proposed fix plan per phase

| Phase | Scope |
|---|---|
| 0.5 | Commit baseline; rotate/remove leaked password; start Postgres so DB tests run |
| 1 | Server draft/publish + Cancel/Reset, additive state schema, remove silent fallbacks, admin shell with 9 routed tabs, Live/Simulation/Save/Reset/Refresh Preview/Cancel, layers + components UI, working Preview protocol (Main listens, compact `?preview=1`) |
| 2 | source test/refresh/refresh-all/register, generic REST/GeoJSON connector, configure form, interval UI, dynamic cards/rows |
| 3 | Scenario CRUD + seed, dependency engine (docs/SIMULATION_MODEL.md), run/test/result endpoints, results only in `simulation_runs` |
| 4 | `/api/risk/config` (4-band, back-compat alias), server classification, municipality risk for all 15, risk selector recolouring |
| 5 | Main Dashboard rebuilt on backend state/results: header, cards, drill-downs, impact table, gauge, municipality table/drawer, exports, UI states + exact messages, all nav pages |
| 6 | Roles, audit read, config import/export with validation, secret scan + git cleanup, infra hardening, Playwright E2E, docs |

## 10. Decisions needed from you

1. **Admin UI vs real Grafana (X-5).** `/admin` is a custom page styled like Grafana. I propose keeping it as the control room (it must call the FastAPI API), rename the branding, and link Grafana from the System tab. OK?
2. **Mode toggle (conflict #2).** The Main toggle is already client-only and never calls `/api/control/mode`, so the code matches your resolution. No conflict to flag.
3. **Leaked password.** Removing `DalarnaTwin2026!` from tracked files is easy; rewriting git history is destructive, so I will not do it without your go-ahead. Rotate it anywhere it is deployed.
4. **Docker.** Not running here, so DB tests skip. Please start Docker Desktop (or give me another Postgres/Timescale) so the full suite can run.
5. **Threshold schema.** Plan: 4-band lower bounds (0.00/0.30/0.60/0.80), existing 3-key `risk_thresholds` kept as a read-compatible alias. Confirm.
