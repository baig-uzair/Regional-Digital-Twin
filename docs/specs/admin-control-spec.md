**DALARNA REGIONAL DIGITAL TWIN**

**Developer Specification — Admin Control Dashboard, Actions & Preview**

*Version 1.0 \| Implementation-ready functional specification*

# 1. Purpose

This document tells the developer exactly what every Admin Dashboard tab and button does, which backend action it triggers, and what the administrator must see in the Preview. The Admin Dashboard is the control room for the Dalarna Regional Digital Twin. The Main Dashboard is the stakeholder-facing Digital Twin interface.

Core rule: the Admin/Grafana interface controls backend configuration and state. It must not directly manipulate the Main Dashboard HTML/DOM. The Main Dashboard reads the saved control state from the backend.

# 2. Target Architecture

Admin UI / Grafana → FastAPI Control API → configuration/state store → TimescaleDB/PostGIS + Orion-LD → Simulation Engine → Main Dashboard (MapLibre/HTML).

- Unsaved changes appear only in Preview until Save & Apply.

- Save & Apply persists the configuration and updates the Main Dashboard.

- Disabling a source must never delete historical data.

- API keys/secrets stay server-side and never appear in browser code or Grafana variables.

# 3. Navigation

| **Tab**           | **Purpose**                                      | **Preview**                                                          |
|-------------------|--------------------------------------------------|----------------------------------------------------------------------|
| Overview          | System health and current configuration summary. | Source health, last updates, active mode/scenario and system status. |
| Dashboard Control | Control what appears on the Main Dashboard.      | Live stakeholder-dashboard preview.                                  |
| Data Sources      | Enable, disable, configure and refresh sources.  | Source status/layers update.                                         |
| Scenarios         | Create, edit, test and run simulations.          | Scenario consequences and risk results.                              |
| Risk Settings     | Configure risk thresholds.                       | Risk labels update.                                                  |
| Map & Regions     | Control map layers and municipality scope.       | Map changes.                                                         |
| Appearance        | Show/hide dashboard components.                  | Preview hides/shows components.                                      |
| Users & Access    | Administrative permissions.                      | Access state only.                                                   |
| System            | Technical health and logs.                       | API/database/simulation health.                                      |

# 4. Global Buttons

| **Button**      | **Action**                                    | **Backend / Logic**                          | **Preview**                                       |
|-----------------|-----------------------------------------------|----------------------------------------------|---------------------------------------------------|
| Live            | Use real/current source data.                 | POST /api/control/mode {"mode":"live"}       | LIVE indicator + current timestamp.               |
| Simulation      | Use simulation state.                         | POST /api/control/mode {"mode":"simulation"} | SIMULATION MODE banner + scenario/year.           |
| Save & Apply    | Commit pending changes.                       | POST /api/control/apply                      | Saved version/time shown; Main Dashboard updates. |
| Reset           | Discard unsaved changes.                      | Restore last saved state.                    | Preview returns to saved state.                   |
| Refresh Preview | Reload preview from current pending settings. | Frontend state refresh.                      | Preview reflects pending configuration.           |
| Cancel          | Close edit without saving.                    | No persistent change.                        | Return to previous state.                         |

# 5. Dashboard Control

| **Control**     | **Action**                       | **Preview**                      |
|-----------------|----------------------------------|----------------------------------|
| Live            | Use current source data.         | LIVE indicator and current data. |
| Simulation      | Use selected simulation result.  | SIMULATION MODE clearly visible. |
| Active Scenario | Select saved scenario.           | Scenario title/results change.   |
| Target Year     | Select simulation year.          | Year changes.                    |
| Scope           | All Dalarna or one municipality. | Map/table scope changes.         |

# Dashboard Components

| **Component**       | **ON**                        | **OFF**           |
|---------------------|-------------------------------|-------------------|
| Source Cards        | Show six source cards.        | Hide cards only.  |
| Regional Risk       | Show regional risk.           | Hide widget only. |
| Population          | Show population visual.       | Hide visual only. |
| Food / Supply Risk  | Show food/supply risk.        | Hide visual only. |
| Snow / Flood Risk   | Show snow/flood risk.         | Hide visual only. |
| Infrastructure Risk | Show infrastructure risk.     | Hide visual only. |
| Environment Risk    | Show environment risk.        | Hide visual only. |
| Municipality Table  | Show 15-municipality results. | Hide table.       |
| Simulation Results  | Show simulation result panel. | Hide panel.       |
| Map                 | Show Dalarna map.             | Hide map.         |

# 6. Data Sources

Use a dynamic source registry. Do not hard-code the six sources into frontend logic; a seventh or eighth source must be addable without rewriting the dashboard.

| **Source**            | **Category**             | **Role**                   | **Main Use**                                            |
|-----------------------|--------------------------|----------------------------|---------------------------------------------------------|
| SMHI Open Data        | Weather                  | Environmental condition    | Weather, temperature, precipitation, snow/frost context |
| Trafikverket          | Traffic / Infrastructure | Infrastructure condition   | Road/traffic and infrastructure risk                    |
| SCB Statistics Sweden | Population / Statistics  | Population driver/exposure | Population and socio-economic indicators                |
| SGU OGC API           | Water / Geology          | Water/geology exposure     | Water, groundwater/geology context                      |
| Skogsstyrelsen        | Forest / Environment     | Natural-resource condition | Forest/environment pressure                             |
| Lantmäteriet NGP      | Land / Geospatial        | Geospatial foundation      | Land parcels, development and map foundation            |

# Source Row Actions

| **Button**      | **Action**                             | **API / Logic**                   | **Preview**                                                            |
|-----------------|----------------------------------------|-----------------------------------|------------------------------------------------------------------------|
| ON/OFF          | Enable or disable source.              | POST /api/control/source          | Status changes; dependent visual/layer is marked unavailable when OFF. |
| ⚙ Configure     | Open source configuration.             | Open edit form.                   | Configuration panel appears.                                           |
| Test Connection | Test API without changing stored data. | POST /api/control/source/test     | Show success/failure, response time, timestamp.                        |
| Refresh Now     | Fetch data immediately.                | POST /api/control/source/refresh  | Show progress, records received, storage result and last-update time.  |
| \+ Add Source   | Register a new source.                 | POST /api/control/source/register | Validated source appears in registry.                                  |
| More            | Open safe source actions.              | Context menu.                     | Show metadata/log options.                                             |

# Source Configuration

- Source name and ID

- Category

- API/base URL

- Authentication type (secret remains server-side)

- Update interval

- Data types/fields to ingest

- Map-layer visibility

- Storage policy

- Spatial coverage

- Test Connection / Refresh Now / Save

# 7. Scenarios

Use one Scenario Editor, not six separate simulation boxes.

| **Control**        | **Purpose**                                       |
|--------------------|---------------------------------------------------|
| \+ Create Scenario | Create reusable scenario.                         |
| Scenario Name      | Human-readable name.                              |
| Driver Source      | Select driver such as SCB.                        |
| Target Year        | Simulation year.                                  |
| Scope              | All Dalarna or selected municipality.             |
| Driver Value       | Example: population +10%.                         |
| Affected Sources   | Show configured dependencies.                     |
| Save Scenario      | Persist definition.                               |
| Run Test           | Validate safely without changing official result. |
| Run Simulation     | Execute and create result.                        |
| View Result        | Open detailed regional/municipality result.       |

# Population Growth Example

Example: SCB population +10% by 2030. The model should propagate consequences through configured dependency relationships, not blindly apply +10% to every source. Illustrative chain: population → traffic demand → infrastructure pressure → land development pressure → environmental pressure → water/supply exposure → overall risk. SMHI remains an environmental/external condition unless a climate scenario explicitly changes it.

A transparent population calculation may use future population = current population × (1 + growth rate)^years. Coefficients must be configurable and documented.

# Simulation API

POST /api/simulation/run

Example request: {"scenario":"population_growth","scope":"dalarna","target_year":2030,"driver":{"population_change":0.10}}

Result should include run ID, scenario, target year, scope, affected sources, municipality impacts, regional risk, assumptions and timestamp.

GET /api/simulation/result/{id} and GET /api/simulation/result/latest

# 8. Simulation Preview

| **Area**            | **Required Content**                                                                                    |
|---------------------|---------------------------------------------------------------------------------------------------------|
| Header              | Scenario, target year, scope, SIMULATION MODE.                                                          |
| Impact Summary      | Population change and major calculated impacts.                                                         |
| Cross-Source Impact | Traffic, infrastructure, land development, environment, water/supply and other configured dependencies. |
| Regional Risk       | Overall Dalarna risk and category breakdown.                                                            |
| Map                 | Municipalities labelled/coloured by calculated risk.                                                    |
| Municipality Table  | All 15 municipalities or selected municipality.                                                         |
| Assumptions         | Driver values, model version and assumptions.                                                           |
| Timestamp           | Run time and result ID.                                                                                 |

# 9. Risk Settings

| **Setting**        | **Action**             | **Preview**                                     |
|--------------------|------------------------|-------------------------------------------------|
| LOW threshold      | Set lower boundary.    | Risk classification changes.                    |
| MEDIUM threshold   | Set medium boundary.   | Risk labels update.                             |
| HIGH threshold     | Set high boundary.     | High-risk areas update.                         |
| CRITICAL threshold | Set critical boundary. | Critical areas update.                          |
| Save Risk Settings | Persist configuration. | Main Dashboard uses new thresholds after Apply. |
| Reset              | Restore saved values.  | Preview returns to saved values.                |

Example thresholds: LOW 0.00–0.30, MEDIUM 0.30–0.60, HIGH 0.60–0.80, CRITICAL 0.80–1.00. Treat these as configuration, not hard-coded JavaScript.

# 10. Map & Regions

| **Control**             | **Action**                       | **Preview**                   |
|-------------------------|----------------------------------|-------------------------------|
| Municipality Boundaries | Show/hide boundaries.            | Boundary visibility changes.  |
| Population              | Show/hide population layer.      | Population layer changes.     |
| Weather                 | Show/hide weather layer.         | SMHI layer changes.           |
| Roads                   | Show/hide road/traffic layer.    | Infrastructure layer changes. |
| Water / Geology         | Show/hide SGU layer.             | Water/geology changes.        |
| Forest                  | Show/hide forest layer.          | Forest layer changes.         |
| Land Parcels            | Show/hide land layer.            | Land layer changes.           |
| Simulation Risk         | Show/hide risk overlay.          | Risk overlay changes.         |
| Municipality Selector   | All Dalarna or one municipality. | Map/table scope changes.      |

Required municipalities: Borlänge, Falun, Mora, Ludvika, Avesta, Säter, Hedemora, Leksand, Rättvik, Malung-Sälen, Orsa, Älvdalen, Vansbro, Gagnef, Smedjebacken.

# 11. Appearance

Appearance controls presentation only. It must never delete or disable underlying data.

| **Control**        | **Preview**                  |
|--------------------|------------------------------|
| Source Cards       | Show/hide six source cards.  |
| Regional Risk      | Show/hide regional risk.     |
| Population         | Show/hide population visual. |
| Risk Panels        | Show/hide risk panels.       |
| Municipality Table | Show/hide table.             |
| Simulation Results | Show/hide simulation panel.  |
| Map                | Show/hide map.               |

# 12. Quick Actions

| **Button**           | **Action**                                 | **Success Preview**                              |
|----------------------|--------------------------------------------|--------------------------------------------------|
| Run Test Simulation  | POST /api/simulation/test; safe test only. | ✓ Test completed; official result unchanged.     |
| Refresh All          | POST /api/control/refresh-all.             | Each source success/failure + total.             |
| Export Configuration | Export saved config as JSON.               | Export confirmation.                             |
| Import Configuration | Validate JSON before applying.             | Show change summary + Apply/Cancel.              |
| Save & Apply         | Commit pending config.                     | Show version, timestamp and affected components. |

# 13. Main Dashboard Preview

The Preview must be a compact representation of the actual Main Dashboard, not a separate invented design. Required areas:

- Header: DALARNA REGIONAL DIGITAL TWIN, mode, last update, scope.

- Six source cards: SMHI, Trafikverket, SCB, SGU, Skogsstyrelsen, Lantmäteriet.

- Large Dalarna map with municipality risk.

- Regional risk summary.

- Simulation result/cross-source consequences when simulation mode is active.

- Municipality results table when enabled.

Visual direction: dark/black, clean, modern, minimal repetition, easy to scan. Do not create six separate simulation boxes; use one Simulation Control and one Simulation Results area.

# 14. Preview Examples

| **Admin Change**       | **Preview Before Apply**                                     | **After Save & Apply**                                                            |
|------------------------|--------------------------------------------------------------|-----------------------------------------------------------------------------------|
| SMHI OFF               | SMHI marked pending-off; weather layer shown as pending-off. | Main Dashboard shows SMHI disabled and weather visual unavailable.                |
| Forest layer OFF       | Forest disappears only in Preview.                           | Forest layer hidden on Main Dashboard.                                            |
| Population +10% / 2030 | Scenario configuration/result preview shown.                 | Saved scenario/result appears on Main Dashboard when simulation mode is selected. |
| Change HIGH threshold  | Risk labels recalculate in Preview.                          | Main Dashboard uses new threshold.                                                |
| Select Borlänge        | Map/table focus on Borlänge.                                 | Saved dashboard scope becomes Borlänge.                                           |
| Change update interval | New interval shown as pending.                               | Scheduler uses saved interval after Apply.                                        |

# 15. Backend API

| **Endpoint**                      | **Purpose**                                    |
|-----------------------------------|------------------------------------------------|
| GET /api/control/state            | Return complete saved dashboard/control state. |
| POST /api/control/apply           | Persist pending configuration.                 |
| POST /api/control/mode            | Set live/simulation mode.                      |
| POST /api/control/source          | Enable/disable source.                         |
| POST /api/control/source/test     | Test source.                                   |
| POST /api/control/source/refresh  | Refresh one source.                            |
| POST /api/control/source/register | Register source.                               |
| POST /api/control/refresh-all     | Refresh all enabled sources.                   |
| POST /api/control/map-layer       | Set layer visibility.                          |
| GET /api/control/map-state        | Return map state.                              |
| GET /api/simulation/scenarios     | List scenarios.                                |
| POST /api/simulation/run          | Run scenario.                                  |
| POST /api/simulation/test         | Run safe test.                                 |
| GET /api/simulation/result/{id}   | Get result.                                    |
| GET /api/simulation/result/latest | Get latest result.                             |
| GET /api/risk/config              | Get risk configuration.                        |
| POST /api/risk/config             | Update risk configuration.                     |
| POST /api/risk/calculate          | Calculate risk.                                |

# 16. Control State Example

GET /api/control/state example: {"mode":"live","scope":"dalarna","sources":{"smhi":true,"trafikverket":true,"scb":true,"sgu":true,"skogsstyrelsen":true,"lantmateriet":true},"layers":{"population":true,"roads":true,"water":true,"forest":true,"land":true,"simulation_risk":true},"active_scenario":null,"simulation_year":null}

# 17. Security & Governance

- Only authenticated administrators may use control endpoints.

- Never expose API keys in frontend code, browser storage, Grafana variables or dashboard JSON.

- Validate imported configuration before applying it.

- Audit-log configuration changes with user, timestamp, action and result.

- Never delete historical data when a source/layer is disabled.

- Clearly label simulation outputs as scenarios, not real agency forecasts.

- Use authorization on system-changing endpoints.

# 18. Implementation Priority

| **Phase** | **Implementation**                                                                    |
|-----------|---------------------------------------------------------------------------------------|
| 1         | Control state, source enable/disable, map layers, live/simulation mode, Save & Apply. |
| 2         | Source test, refresh, refresh-all, source registry/add-source.                        |
| 3         | Scenario registry, Test Simulation, Run Simulation, result retrieval.                 |
| 4         | Risk configuration and municipality-level calculations.                               |
| 5         | Preview ↔ Main Dashboard synchronization.                                             |
| 6         | Authentication, audit logging, import/export, production hardening.                   |

# 19. Acceptance Checklist

- [ ] Every button has a defined action and backend/API behaviour.

- [ ] Every tab has a defined purpose.

- [ ] Preview clearly shows what the Main Dashboard will look like.

- [ ] Unsaved changes do not silently alter the live dashboard.

- [ ] Save & Apply is the explicit commit action.

- [ ] Turning a source OFF does not delete stored historical data.

- [ ] New sources can be registered without rewriting the dashboard.

- [ ] Simulation is dependency-based, not the same percentage applied to every source.

- [ ] Simulation outputs are clearly labelled as scenarios.

- [ ] All 15 Dalarna municipalities are supported.

- [ ] Risk thresholds are configurable, not hard-coded in JavaScript.

- [ ] API secrets remain server-side.

- [ ] Main Dashboard and Preview use the same backend state model.

# 20. Final UX Rule

Before clicking any control, the administrator must be able to understand WHAT will change, WHERE it will change, and WHAT the Main Dashboard will look like afterward. Therefore, each configuration page should place the controls on the left/centre and the Main Dashboard Preview on the right. Use clear status messages and make Save & Apply the single explicit commit action.
