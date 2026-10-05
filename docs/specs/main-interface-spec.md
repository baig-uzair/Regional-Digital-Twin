**DALARNA REGIONAL DIGITAL TWIN**

**MAIN INTERFACE — BUTTON, CONTROL & ACTION SPECIFICATION**

*Developer hand-off document \| Based on the supplied Main Dashboard design*

# 1. Purpose

This document defines the behaviour of every visible button, selector, toggle, map control and interactive area in the supplied Dalarna Regional Digital Twin Main Interface. It is intended to be given directly to the developer.

The goal is simple: every visible control must have a clear action, a clear backend request/state change, and a clear visual response. The Main Interface is the stakeholder-facing interface; administrative configuration remains in the Admin/Grafana control interface.

# 2. Main Interface Layout

| **Area**             | **Visible Elements**                                                                                   | **Primary Purpose**                          |
|----------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------|
| Left navigation      | Overview, Map, Simulation, Municipalities, Data Sources, Insights, Reports, Settings                   | Navigate between Digital Twin functions.     |
| Header               | System Online, Last update, location, Current/Simulation toggle, user icon                             | System status and global mode.               |
| Source cards         | SMHI, Trafikverket, SCB, SGU, Skogsstyrelsen, Lantmäteriet                                             | Quick live/source status and summary.        |
| Map area             | Risk selector, zoom, layers, Dalarna map                                                               | Geographic situation and risk visualization. |
| Simulation Control   | Scenario, target year, population change, scope, affected-source toggles, Run, Reset, Advanced options | Build and execute a scenario.                |
| Simulation Results   | Scenario selector, five impact cards, impact-by-source table, regional risk, takeaway                  | Explain scenario consequences.               |
| Municipality Results | Search, municipality filter, Export, View                                                              | Compare municipality-level results.          |

# 3. Global Interaction Rules

- Do not make decorative elements clickable unless an action is defined below.

- Every action must provide immediate visual feedback: loading, success, error, or disabled state.

- Read-only status indicators must not behave like buttons.

- Simulation values are scenario outputs and must always be labelled as simulated; they must not be presented as real measured observations.

- Current/Simulation mode must be visually obvious at all times.

- Changing a simulation input does not silently change the official/live data.

- Run Simulation is the explicit action that creates a new simulation result.

- Reset returns the Simulation Control panel to the last saved/default scenario inputs; it does not delete historical data.

- Map layer changes should be reversible and should not delete source data.

- All API errors must be shown in a non-blocking notification and logged server-side.

# 4. Header Controls

| **Visible Control**              | **User Action**            | **Required Behaviour**                                                   | **Backend / State**                                   | **Preview / Feedback**                                                          |
|----------------------------------|----------------------------|--------------------------------------------------------------------------|-------------------------------------------------------|---------------------------------------------------------------------------------|
| System Online / 6/6 data sources | Click or hover if desired. | Open system/source health summary; do not treat as a simulation control. | GET /api/control/state and source health endpoints.   | Show six source statuses and last successful updates.                           |
| Last update                      | Click optional.            | Open latest update/source timestamp details.                             | GET /api/control/state or /api/datasources/summary.   | Show source-by-source timestamps.                                               |
| Dalarna, Sweden                  | Click optional.            | Open geographic scope information; no data change.                       | Frontend scope info.                                  | Show current regional scope.                                                    |
| Current (2025)                   | Select Current mode.       | Switch Main Dashboard to current/live state.                             | POST /api/control/mode {mode:'live'}                  | Current mode highlighted; simulation result panels become live/current context. |
| Simulation (2030)                | Select Simulation mode.    | Switch dashboard to selected simulation state/year.                      | POST /api/control/mode {mode:'simulation', year:2030} | Simulation mode highlighted; simulated values and scenario appear.              |
| User icon                        | Click.                     | Open user/profile menu and authentication actions.                       | Authentication/session layer.                         | Menu opens; no dashboard data changes.                                          |

# 5. Left Navigation — Button Actions

| **Navigation Button** | **Action**                         | **What Opens / Changes**                                                                            | **URL/State Recommendation** |
|-----------------------|------------------------------------|-----------------------------------------------------------------------------------------------------|------------------------------|
| Overview              | Open main regional dashboard.      | Return to the supplied dashboard overview.                                                          | / or /overview               |
| Map                   | Open geographic map workspace.     | Show larger map, layers and geographic analysis.                                                    | /map                         |
| Simulation            | Open dedicated scenario workspace. | Show scenario creation, execution and detailed results.                                             | /simulation                  |
| Municipalities        | Open municipality analysis.        | Show all 15 municipalities, comparison and details.                                                 | /municipalities              |
| Data Sources          | Open source monitoring page.       | Show six source connections, health, metadata and latest updates.                                   | /data-sources                |
| Insights              | Open analytical insights.          | Show generated cross-source insights and trends.                                                    | /insights                    |
| Reports               | Open reports.                      | Show/export simulation and regional reports.                                                        | /reports                     |
| Settings              | Open user/dashboard settings.      | Show personal and non-destructive interface settings. Admin configuration remains in Admin/Grafana. | /settings                    |

# 6. Six Data Source Cards

The six cards are primarily status/summary cards. They should become clickable so the user can drill into the corresponding source without leaving the Main Interface context.

| **Card**                     | **Click Action**           | **Displayed Detail**                                                          | **Backend**               |
|------------------------------|----------------------------|-------------------------------------------------------------------------------|---------------------------|
| SMHI — Weather               | Open SMHI detail.          | Current weather, temperature, rain, wind, latest timestamp, map observations. | GET source-specific data. |
| Trafikverket — Traffic (E16) | Open traffic/road detail.  | Traffic state, road condition and latest available telemetry/simulation data. | GET source-specific data. |
| SCB — Population             | Open population detail.    | Population total, 15 municipalities, current/simulated population and trends. | GET SCB/statistical data. |
| SGU — Water/Geology          | Open water/geology detail. | Water objects, geology/groundwater context and map data.                      | GET SGU data.             |
| Skogsstyrelsen — Forest      | Open forest detail.        | Forest coverage/area, environmental context and trends.                       | GET forest data.          |
| Lantmäteriet — Land Registry | Open land detail.          | Parcel count, buildings, land/development context and map data.               | GET land registry data.   |

The Online badge itself is a status indicator. It should not toggle the source. Source enable/disable belongs to the Admin Control Dashboard.

# 7. Map Header — Risk Selector

| **Control**         | **Action**                    | **Backend / Logic**                            | **Expected Result**                              |
|---------------------|-------------------------------|------------------------------------------------|--------------------------------------------------|
| Overall risk ▼      | Select risk layer/category.   | Frontend state or GET configured risk metrics. | Map recolours/updates by selected risk category. |
| Food / Supply risk  | Select category if available. | Use configured risk calculation.               | Municipalities display food/supply risk.         |
| Snow / Flood risk   | Select category.              | Use configured snow/flood risk.                | Map displays snow/flood risk.                    |
| Infrastructure risk | Select category.              | Use configured infrastructure risk.            | Map displays infrastructure risk.                |
| Environment risk    | Select category.              | Use configured environment risk.               | Map displays environment risk.                   |

The risk selector changes visualization only unless the user explicitly enters Simulation and runs a scenario.

# 8. Map Controls

| **Button**          | **Action**                     | **Required Behaviour**                                                                                             |
|---------------------|--------------------------------|--------------------------------------------------------------------------------------------------------------------|
| \+ Zoom In          | Increase map zoom by one step. | Map zooms in; no data changes.                                                                                     |
| − Zoom Out          | Decrease map zoom by one step. | Map zooms out; no data changes.                                                                                    |
| Layers icon         | Open layer selector.           | Show/hide municipality boundaries, weather, roads, water/geology, forest, land parcels and simulation-risk layers. |
| Municipality on map | Click municipality polygon.    | Open municipality quick detail showing name, population and risk values.                                           |
| Risk legend         | Read-only.                     | Explain Low/Medium/High/Critical; no backend action.                                                               |
| Scale bar           | Read-only.                     | Show geographic scale; no backend action.                                                                          |

# 9. Simulation Control — Detailed Button Specification

This is the main interactive control area in the supplied interface. It should be implemented as one coherent scenario editor, not as separate simulation boxes.

| **Control**                     | **Action**                                          | **Backend / Logic**                                                                   |
|---------------------------------|-----------------------------------------------------|---------------------------------------------------------------------------------------|
| Scenario ▼                      | Select scenario.                                    | GET /api/simulation/scenarios; load default parameters.                               |
| Target year 2026/2030/2035/2040 | Select target year.                                 | Update local scenario state; old result becomes pending if year changes.              |
| Population change slider        | Set growth/decline.                                 | Update driver state; validate range.                                                  |
| Population change value         | Optional direct numeric edit.                       | Synchronize slider and numeric value.                                                 |
| Scope ▼                         | All Dalarna or municipality.                        | Update simulation scope.                                                              |
| SCB toggle                      | Include/exclude population driver/dependency.       | Update scenario dependency configuration.                                             |
| Trafikverket toggle             | Include/exclude traffic/infrastructure consequence. | Update dependency configuration.                                                      |
| Lantmäteriet toggle             | Include/exclude land/development consequence.       | Update dependency configuration.                                                      |
| Skogsstyrelsen toggle           | Include/exclude forest/environment consequence.     | Update dependency configuration.                                                      |
| SGU toggle                      | Include/exclude water/geology consequence.          | Update dependency configuration.                                                      |
| SMHI toggle                     | Include/exclude weather as external condition.      | Update context dependency; do not artificially change weather from population growth. |
| Run Simulation                  | Execute scenario.                                   | POST /api/simulation/run; update map, results and municipality table.                 |
| Reset                           | Restore default/last saved inputs.                  | Clear pending result; never delete stored data.                                       |
| Advanced options ▼              | Expand advanced model parameters.                   | Show coefficients, thresholds, assumptions and model version.                         |

# 10. Run Simulation — Required Flow

- Select scenario.

- Select target year.

- Set the driver value, e.g. population +10%.

- Select scope.

- Confirm affected-source/dependency toggles.

- Click Run Simulation.

- Show 'Running simulation…' and temporarily disable repeated Run clicks.

- Validate scenario on the backend.

- Calculate configured cross-source consequences.

- Return run ID and result.

- Update map, result cards, impact-by-source table and municipality table together.

- Keep SIMULATION mode visible throughout.

# 11. Simulation Result Cards

| **Card**            | **Meaning**                                 | **Action**                                  |
|---------------------|---------------------------------------------|---------------------------------------------|
| Population          | Simulated population and percentage change. | Click → population simulation detail/trend. |
| Food risk           | Calculated food/supply risk.                | Click → contributing factors.               |
| Snow/Flood risk     | Calculated snow/flood risk.                 | Click → contributing factors.               |
| Infrastructure risk | Calculated infrastructure pressure/risk.    | Click → traffic/road drivers.               |
| Environment risk    | Calculated environmental pressure/risk.     | Click → forest/water/land drivers.          |

# 12. Impact by Source Table

| **Element**                          | **Action**      | **Result**                                                       |
|--------------------------------------|-----------------|------------------------------------------------------------------|
| Population (SCB) row                 | Click.          | Open population contribution/detail.                             |
| Traffic (Trafikverket) row           | Click.          | Open traffic/infrastructure contribution.                        |
| Land parcels (Lantmäteriet) row      | Click.          | Open land/development contribution.                              |
| Forest area (Skogsstyrelsen) row     | Click.          | Open forest/environment contribution.                            |
| Water exposure (SGU) row             | Click.          | Open water/geology contribution.                                 |
| Weather (SMHI) row                   | Click.          | Open weather context and indicate whether it is external/causal. |
| Current / Simulated / Change columns | Read-only.      | Compare baseline and scenario.                                   |
| Impact badge                         | Click optional. | Show score, threshold and main contributors.                     |

# 13. Overall Regional Risk

| **Element**          | **Action**         | **Result**                                           |
|----------------------|--------------------|------------------------------------------------------|
| Risk gauge           | Click.             | Open regional risk breakdown.                        |
| MEDIUM label         | Click.             | Show score, category contributions and threshold.    |
| Key Takeaway         | Read-only summary. | Show concise explanation of scenario outcome.        |
| Key Takeaway details | Optional click.    | Show methodology/assumptions behind the explanation. |

# 14. Municipality Simulation Results

| **Control**           | **Action**                       | **Expected Result**                                 |
|-----------------------|----------------------------------|-----------------------------------------------------|
| Search municipality   | Type name.                       | Filter rows instantly.                              |
| Municipality filter ▼ | Select all or one.               | Table shows selected scope.                         |
| Export                | Export current/filtered results. | Download CSV/XLSX/JSON according to implementation. |
| View icon/button      | Open municipality detail.        | Open detail drawer/page.                            |
| Municipality row      | Click row.                       | Open selected municipality details.                 |
| Risk badge            | Click.                           | Show score and contributors.                        |
| Trend chart           | Hover/click.                     | Show trend values and years.                        |

# 15. Municipality Detail View

When the user clicks View for Borlänge, Falun or another municipality, open a detail drawer or dedicated page containing:

- Municipality name and population.

- Current vs simulated population.

- Food/Supply risk.

- Snow/Flood risk.

- Infrastructure risk.

- Environment risk.

- Overall risk.

- Contributing sources.

- Map location.

- Simulation assumptions.

- Historical/current trend where available.

- Back to Regional View.

# 16. Export Behaviour

| **Export** | **Content**                                                               | **Action**                            |
|------------|---------------------------------------------------------------------------|---------------------------------------|
| CSV        | Municipality rows, current/simulated values, changes and risk categories. | Export current filtered view.         |
| Excel/XLSX | Formatted municipality comparison.                                        | Export current filtered view.         |
| JSON       | Structured simulation result, run ID and assumptions.                     | Export machine-readable result.       |
| PDF/Report | Human-readable regional/municipality report if enabled.                   | Generate report from selected result. |

# 17. Data and Simulation State Rules

| **State**  | **Meaning**                      | **UI Behaviour**                                 |
|------------|----------------------------------|--------------------------------------------------|
| LIVE       | Real/current source state.       | Do not display simulated values as measurements. |
| SIMULATION | Scenario result is being viewed. | Show SIMULATION banner and target year.          |
| RUNNING    | Simulation processing.           | Disable Run temporarily and show progress.       |
| SUCCESS    | Result returned.                 | Update all dependent panels consistently.        |
| ERROR      | Request failed.                  | Keep previous valid result and show error.       |
| STALE      | Data older than freshness rule.  | Show stale indicator and last update.            |

# 18. Error and Loading Messages

| **Situation**         | **Required UI Message**                                      | **Action**                       |
|-----------------------|--------------------------------------------------------------|----------------------------------|
| Simulation running    | Running simulation… Please wait.                             | Disable duplicate Run clicks.    |
| Simulation success    | Simulation completed successfully. Result ID: …              | Enable normal controls.          |
| API unavailable       | Unable to retrieve this source. Showing last available data. | Show last timestamp.             |
| Source stale          | Data may be outdated. Last update: …                         | Offer Refresh where appropriate. |
| Invalid input         | Please correct the highlighted value(s).                     | Keep user input visible.         |
| Export success        | Export created successfully.                                 | Provide download.                |
| Export failure        | Export could not be created. Please try again.               | Keep current results.            |
| No municipality match | No municipality found.                                       | Clear filter or show all.        |

# 19. Suggested Frontend API Contract

| **Endpoint**                      | **Used By**         | **Purpose**                               |
|-----------------------------------|---------------------|-------------------------------------------|
| GET /api/control/state            | Header/global state | Current mode, scope and UI configuration. |
| GET /api/datasources/summary      | Source cards        | Source health and latest updates.         |
| GET /api/datasources?source=…     | Source details      | Source-specific records.                  |
| GET /api/simulation/scenarios     | Scenario selector   | List available scenarios.                 |
| POST /api/simulation/run          | Run Simulation      | Execute scenario.                         |
| GET /api/simulation/result/{id}   | Simulation results  | Retrieve result.                          |
| GET /api/simulation/result/latest | Overview            | Retrieve latest result.                   |
| GET /api/risk/config              | Risk visualization  | Retrieve thresholds.                      |
| POST /api/risk/calculate          | Risk results        | Calculate risk if required.               |
| GET /api/control/map-state        | Map                 | Retrieve layer state.                     |
| POST /api/control/map-layer       | Map layers          | Change layer state.                       |
| GET /api/municipalities           | Municipality table  | Retrieve all 15 municipalities.           |
| GET /api/municipalities/{id}      | Municipality detail | Retrieve one municipality.                |

# 20. Critical Rule — Never Mix Live and Simulation Data

The supplied design shows Current (2025) and Simulation (2030). These must remain conceptually separate. Current values come from connected data sources; simulated values are Digital Twin scenario outputs.

Example: if SCB current population is 288,000 and the simulation produces 316,800, the interface must label 316,800 as simulated. The same principle applies to traffic, land, forest, water exposure and risk.

# 21. Main Interface Preview Behaviour

For this Main Interface, Preview means the immediate visual response after a user changes a control. It is different from the Admin/Grafana Preview.

| **User Action**                     | **Immediate Preview**                                                         |
|-------------------------------------|-------------------------------------------------------------------------------|
| Select Simulation (2030)            | Header switches to Simulation; simulated context and target year appear.      |
| Move population slider to +10%      | Value changes; existing result is marked pending until Run Simulation.        |
| Change target year to 2035          | 2035 highlights; the old 2030 result must not be presented as a 2035 result.  |
| Toggle Trafikverket out of scenario | Traffic consequence is marked excluded; source data itself remains available. |
| Click Run Simulation                | Loading state, then all result panels update consistently.                    |
| Choose Infrastructure Risk          | Map colours change to infrastructure risk.                                    |
| Click Layers                        | Layer menu opens and selected layers can be shown/hidden.                     |
| Click a municipality                | Municipality quick detail opens.                                              |
| Search Borlänge                     | Matching municipality rows remain.                                            |
| Click Export                        | Current filtered result is exported.                                          |
| Click View                          | Detailed municipality view opens.                                             |

# 22. Acceptance Checklist

- [ ] Every visible button/control in the supplied design has an implemented action.

- [ ] Left navigation opens the correct workspace.

- [ ] Current and Simulation modes are clearly separated.

- [ ] Source cards show source status and support drill-down.

- [ ] Map zoom controls work.

- [ ] Map layer control works.

- [ ] Risk selector changes map visualization.

- [ ] Simulation controls remain synchronized.

- [ ] Run Simulation calls the backend and updates all dependent panels.

- [ ] Reset does not delete data.

- [ ] Simulation outputs are clearly labelled as simulated.

- [ ] Impact-by-source values are traceable to configured dependencies.

- [ ] Municipality search/filter works across all 15 municipalities.

- [ ] Municipality View opens detailed results.

- [ ] Export exports the current/selected result.

- [ ] Loading, success, stale and error states are implemented.

- [ ] Live data is never overwritten by simulation data.

- [ ] API credentials are never exposed in frontend code.

- [ ] Main Dashboard uses a consistent backend state.

# 23. Final UX Requirement

Preserve the supplied interface's hierarchy: six source cards → regional map → Simulation Control → Simulation Results → Impact by Source → Municipality Results. Keep the dark, clean, decision-support style. Do not add controls unless they have a clear user purpose.

Every interactive element must answer: WHAT does it change, WHERE does it change, and WHAT does the user see afterward? The interface should provide immediate feedback without clutter.
