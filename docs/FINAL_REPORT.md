# FINAL REPORT

Gap matrix from `docs/AUDIT_REPORT.md`, re-evaluated after the fixes. Every status below is backed by a test name or file; anything that is not fully done says what is still open.

**Written for:** the project owner, who needs to know exactly what works and what does not.

## 1. Result in one paragraph

The **Main Dashboard** and the **Control Room** were rebuilt on backend data: no hard-coded sources, numbers, thresholds or risk colours remain in the frontend. The Spec B interactions and the Spec A Preview cases pass in a real browser (39 Playwright tests). The password that was committed to git is removed from the working tree and a secret scan guards it. The **backend simulation and data layers still have defects** that the UI cannot hide (e.g. the target year does not change the result, saved risk thresholds are not used by the engine, no scenario CRUD, silent fake fallbacks when the database is down). These are encoded as 11 strict-xfail tests in `tests/test_spec_gaps.py`.

## 2. How to run and test

```powershell
docker compose up -d timescaledb        # database for tests and local runs
python -m pip install -r requirements.txt -r requirements-dev.txt playwright
python -m playwright install chromium   # once
python -m pytest -q                     # unit/API (needs the DB) + browser tests, ~2 min
python -m pytest tests/e2e -q           # only the browser tests (starts its own server on port 8765 and a throwaway database)
python -m uvicorn app.main:app --port 8000   # run the app: http://localhost:8000/  and  /admin (Control Room)
```

Result of the last run: **91 passed, 11 xfailed** (documented backend gaps). Browser tests use the database `dalarna_dt_test`, never your real data.

## 3. Gap matrix with final status

| ID | Spec | Requirement | Audit status | Final status | Evidence (test / file) | Still open |
|---|---|---|---|---|---|---|
| R-2.1 | Both | Pending vs saved; Save & Apply only commit; Reset discards; Cancel closes | PARTIAL | PARTIAL | Draft kept per admin session (sessionStorage), Preview-only until Save & Apply: tests/e2e/test_control_room.py::test_global_buttons_live_simulation_reset_cancel_refresh, ::test_unsaved_draft_survives_reload_but_not_applied | No server-side draft table |
| R-2.2 | Both | Never delete history on disable | DONE | DONE | tests/e2e/test_control_room.py::test_disabling_a_source_keeps_history; tests/test_control_api.py::test_disabling_a_source_never_deletes_history |  |
| R-2.3 | Both | Dynamic source registry, not hard-coded in frontend | VIOLATES RULE | PARTIAL | UI renders sources from the registry: tests/e2e/test_control_room.py::test_add_seventh_source_appears_everywhere_without_code_changes | Backend has no generic connector: tests/test_spec_gaps.py::test_registered_source_can_be_refreshed (xfail) |
| R-2.4 | Both | Secrets server-side only (JS/Grafana/git) | VIOLATES RULE | PARTIAL | Password removed from tracked files, compose reads GRAFANA_ADMIN_PASSWORD from .env: tests/test_secret_scan.py (5 tests) | Old password is still in git history (rewrite needs your approval); rotate it wherever deployed |
| R-2.5 | Both | Live/Simulation never mix; simulated labelled; sim never overwrites live | VIOLATES RULE | PARTIAL | LIVE shows no simulated values; every simulated value carries a SIMULATED tag: tests/e2e/test_main_dashboard.py::test_mode_toggle_is_a_session_view_and_does_not_change_saved_state | Backend impact 'current' values are literals: tests/test_spec_gaps.py::test_impact_current_values_are_not_hard_coded_literals |
| R-2.6 | Both | Dependency-based simulation; SMHI external | VIOLATES RULE | PARTIAL | Engine applies per-source coefficients and leaves SMHI unchanged (tests/test_simulation_api.py) | target_year ignored, driver exclusion ignored: tests/test_spec_gaps.py |
| R-2.7 | Both | Risk thresholds backend config, not JS | VIOLATES RULE | PARTIAL | Main Dashboard reads thresholds from the backend: tests/e2e/test_main_dashboard.py::test_main_dashboard_uses_backend_thresholds_and_components | Engine labels use config thresholds: tests/test_spec_gaps.py::test_simulation_uses_saved_risk_thresholds |
| R-2.8 | Both | 15 municipalities, correct å/ä/ö | PARTIAL | DONE | 15 rows, UTF-8 names, diacritic-insensitive search: tests/e2e/test_main_dashboard.py::test_municipality_search_view_detail_and_back |  |
| R-2.9 | Both | Auth + audit log | PARTIAL | PARTIAL | Admin auth on control endpoints (tests/test_control_api.py); audit written on apply/source/test/refresh | Audit log readable without login: tests/test_spec_gaps.py::test_audit_log_requires_admin; single admin role |
| R-2.10 | Both | Every control has action + feedback; decorative not buttons | BROKEN | DONE | Every control in both UIs has an action; clicked in tests/e2e/test_main_dashboard.py and tests/e2e/test_control_room.py |  |
| R-2.11 | Both | Non-blocking errors, logged, keep previous result | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_failed_run_keeps_previous_result_and_shows_error; tests/e2e/test_control_room.py::test_failed_apply_keeps_draft_and_reports_the_error |  |
| R-2.12 | Both | Dark clean design; ONE sim control + results | DONE | DONE | One Simulation Control + one Results area (static/js/dashboard.js) |  |
| A-L.1 | A | Controls left, Preview right; Preview shows real Main look | BROKEN | DONE | tests/e2e/test_control_room.py::test_layout_has_controls_left_and_preview_right, ::test_source_off_is_pending_in_preview_then_live_after_apply |  |
| A-3.1 | A | Tab: Overview | MISSING | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.2 | A | Tab: Dashboard Control | MISSING | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.3 | A | Tab: Data Sources | PARTIAL | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.4 | A | Tab: Scenarios | BROKEN | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.5 | A | Tab: Risk Settings | BROKEN | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.6 | A | Tab: Map & Regions | BROKEN | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.7 | A | Tab: Appearance | BROKEN | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.8 | A | Tab: Users & Access | BROKEN | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-3.9 | A | Tab: System | MISSING | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content |  |
| A-4.1 | A | Live button -> POST /api/control/mode | MISSING | DONE | tests/e2e/test_control_room.py::test_global_buttons_live_simulation_reset_cancel_refresh (Live/Simulation stage the mode in the draft; it is committed by Save & Apply) |  |
| A-4.2 | A | Simulation button -> POST /api/control/mode | MISSING | DONE | tests/e2e/test_control_room.py::test_global_buttons_live_simulation_reset_cancel_refresh (Live/Simulation stage the mode in the draft; it is committed by Save & Apply) |  |
| A-4.3 | A | Save & Apply -> POST /api/control/apply | BROKEN | DONE | tests/e2e/test_control_room.py::test_source_off_is_pending_in_preview_then_live_after_apply, ::test_failed_apply_keeps_draft_and_reports_the_error, ::test_version_conflict_is_explained |  |
| A-4.4 | A | Reset restores last saved | PARTIAL | DONE | tests/e2e/test_control_room.py::test_global_buttons_live_simulation_reset_cancel_refresh |  |
| A-4.5 | A | Refresh Preview | MISSING | DONE | tests/e2e/test_control_room.py::test_global_buttons_live_simulation_reset_cancel_refresh |  |
| A-4.6 | A | Cancel | MISSING | DONE | tests/e2e/test_control_room.py::test_global_buttons_live_simulation_reset_cancel_refresh |  |
| A-5.1 | A | Dashboard Control: Live/Sim, scenario, year, scope | MISSING | DONE | tests/e2e/test_control_room.py::test_select_borlange_scope_pending_then_saved |  |
| A-5.2 | A | 10 component toggles | PARTIAL | DONE | tests/e2e/test_control_room.py::test_appearance_and_dashboard_control_share_one_components_object |  |
| A-5.3 | A | OFF hides visual only | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_main_dashboard_uses_backend_thresholds_and_components |  |
| A-6.1 | A | Source registry, six sources | PARTIAL | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content (Data Sources tab renders from /api/datasources/summary) |  |
| A-6.2 | A | ON/OFF -> /api/control/source; dependents 'unavailable' | PARTIAL | DONE | tests/e2e/test_control_room.py::test_forest_layer_off_only_in_preview_until_applied; tests/e2e/test_main_dashboard.py::test_disabled_source_is_shown_as_disabled_on_main |  |
| A-6.3 | A | Configure form | MISSING | PARTIAL | Configure form shows all fields; interval is editable (staged) | Name/URL/auth edits need a backend configure endpoint (not available) |
| A-6.4 | A | Test Connection endpoint/UI | MISSING | DONE | tests/e2e/test_control_room.py::test_test_connection_and_refresh_report_results_and_do_not_lose_data; tests/test_control_extended.py |  |
| A-6.5 | A | Refresh Now endpoint/UI | MISSING | DONE | tests/e2e/test_control_room.py::test_test_connection_and_refresh_report_results_and_do_not_lose_data; tests/test_control_extended.py |  |
| A-6.6 | A | Add Source -> /register | MISSING | PARTIAL | tests/e2e/test_control_room.py::test_add_seventh_source_appears_everywhere_without_code_changes | New source cannot be fetched yet: tests/test_spec_gaps.py::test_registered_source_can_be_refreshed |
| A-6.7 | A | More menu | MISSING | DONE | tests/e2e/test_control_room.py::test_all_nine_tabs_exist_and_render_their_own_content (Data Sources tab renders from /api/datasources/summary) |  |
| A-6.8 | A | Config form fields | PARTIAL | PARTIAL | Form has name, ID, category, URL, auth type, secret env-var NAMES, interval, stale-after, map layer, description | No data-types/spatial-coverage storage |
| A-6.9 | A | Scheduler uses saved interval after Apply | DONE | DONE | tests/e2e/test_control_room.py::test_update_interval_is_pending_then_scheduler_value_after_apply; tests/test_control_api.py::test_apply_creates_new_version_and_syncs_registry |  |
| A-7.1 | A | ONE Scenario Editor controls | MISSING | PARTIAL | Editor with all controls: tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview | Save Scenario needs backend CRUD: tests/test_spec_gaps.py::test_scenario_can_be_created |
| A-7.2 | A | Scenario CRUD | MISSING | MISSING | UI built (Save Scenario calls POST/PUT /api/simulation/scenarios and reports unsupported servers) | Backend endpoint missing: tests/test_spec_gaps.py::test_scenario_can_be_created |
| A-7.3 | A | Population formula current*(1+g)^years | MISSING | BROKEN |  | Population ignores target_year: tests/test_spec_gaps.py::test_population_formula_depends_on_target_year |
| A-7.4 | A | Configurable documented coefficients | MISSING | PARTIAL | Coefficients live in config/simulation_model.json and are shown in Advanced options / Methodology | Not editable through the API or the UI |
| A-7.5 | A | POST /api/simulation/run | MISSING | PARTIAL | POST /api/simulation/run accepts the spec body (tests/test_simulation_api.py) | Engine gaps: tests/test_spec_gaps.py |
| A-7.6 | A | POST /api/simulation/test (safe) | MISSING | DONE | tests/e2e/test_control_room.py::test_run_test_simulation_leaves_official_result_unchanged |  |
| A-7.7 | A | Result fields (run id, scenario, year, scope, sources, impacts, risk, assumptions, ts) | MISSING | PARTIAL | Result has run id, scenario, year, scope, impacts, regional risk, assumptions, timestamp | Stored in memory only: tests/test_spec_gaps.py::test_simulation_results_are_persisted |
| A-8.1 | A | Sim Preview: Header (scenario/year/scope/SIMULATION MODE) | MISSING | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-8.2 | A | Sim Preview: Impact Summary | VIOLATES RULE | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-8.3 | A | Sim Preview: Cross-Source Impact | VIOLATES RULE | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-8.4 | A | Sim Preview: Regional Risk + breakdown | VIOLATES RULE | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-8.5 | A | Sim Preview: Map coloured by risk | VIOLATES RULE | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-8.6 | A | Sim Preview: Municipality table | VIOLATES RULE | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-8.7 | A | Sim Preview: Assumptions + model version | MISSING | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-8.8 | A | Sim Preview: Timestamp + result ID | MISSING | DONE | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview; tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| A-9.1 | A | Editable LOW/MED/HIGH/CRITICAL | MISSING | DONE | tests/e2e/test_control_room.py::test_threshold_change_recalculates_labels_live_and_applies |  |
| A-9.2 | A | Preview recalculates live | MISSING | DONE | tests/e2e/test_control_room.py::test_threshold_change_recalculates_labels_live_and_applies |  |
| A-9.3 | A | Save Risk Settings persists | PARTIAL | DONE | tests/e2e/test_control_room.py::test_threshold_change_recalculates_labels_live_and_applies (staged in the draft, persisted by Save & Apply; also GET/POST /api/risk/config) |  |
| A-9.4 | A | Main uses new thresholds after Apply | VIOLATES RULE | PARTIAL | Main Dashboard recomputes labels from the live thresholds: tests/e2e/test_main_dashboard.py::test_main_dashboard_uses_backend_thresholds_and_components | API labels in results use config thresholds: tests/test_spec_gaps.py::test_simulation_uses_saved_risk_thresholds |
| A-9.5 | A | Reset restores saved | MISSING | DONE | tests/e2e/test_control_room.py::test_threshold_change_recalculates_labels_live_and_applies |  |
| A-9.6 | A | Validation ascending/0-1/no gaps | PARTIAL | DONE | tests/e2e/test_control_room.py::test_threshold_change_recalculates_labels_live_and_applies |  |
| A-10.1 | A | 8 layer toggles | PARTIAL | DONE | tests/e2e/test_control_room.py::test_forest_layer_off_only_in_preview_until_applied, ::test_select_borlange_scope_pending_then_saved |  |
| A-10.2 | A | Municipality selector | PARTIAL | DONE | tests/e2e/test_control_room.py::test_forest_layer_off_only_in_preview_until_applied, ::test_select_borlange_scope_pending_then_saved |  |
| A-11.1 | A | Appearance show/hide 7 components | MISSING | DONE | tests/e2e/test_control_room.py::test_appearance_and_dashboard_control_share_one_components_object |  |
| A-12.1 | A | Run Test Simulation | BROKEN | DONE | tests/e2e/test_control_room.py::test_run_test_simulation_leaves_official_result_unchanged |  |
| A-12.2 | A | Refresh All | BROKEN | DONE | tests/e2e/test_control_room.py::test_refresh_all_reports_per_source_and_total |  |
| A-12.3 | A | Export Configuration | PARTIAL | DONE | tests/e2e/test_control_room.py::test_config_export_and_import_validation |  |
| A-12.4 | A | Import: validate, summary, Apply/Cancel | MISSING | DONE | tests/e2e/test_control_room.py::test_config_export_and_import_validation |  |
| A-12.5 | A | Save & Apply shows version/time/affected | PARTIAL | DONE | tests/e2e/test_control_room.py::test_source_off_is_pending_in_preview_then_live_after_apply (modal shows version, time, affected components) |  |
| A-13.1 | A | Preview area: Header+mode+last update+scope | VIOLATES RULE | DONE | Preview is the real Main Dashboard (?preview=1): tests/e2e/test_control_room.py::test_layout_has_controls_left_and_preview_right |  |
| A-13.2 | A | Preview area: Six source cards | VIOLATES RULE | DONE | Preview is the real Main Dashboard (?preview=1): tests/e2e/test_control_room.py::test_layout_has_controls_left_and_preview_right |  |
| A-13.3 | A | Preview area: Dalarna map with risk | PARTIAL | DONE | Preview is the real Main Dashboard (?preview=1): tests/e2e/test_control_room.py::test_layout_has_controls_left_and_preview_right |  |
| A-13.4 | A | Preview area: Regional risk summary | VIOLATES RULE | DONE | Preview is the real Main Dashboard (?preview=1): tests/e2e/test_control_room.py::test_layout_has_controls_left_and_preview_right |  |
| A-13.5 | A | Preview area: Sim results/cross-source | VIOLATES RULE | DONE | Preview is the real Main Dashboard (?preview=1): tests/e2e/test_control_room.py::test_layout_has_controls_left_and_preview_right |  |
| A-13.6 | A | Preview area: Municipality table | VIOLATES RULE | DONE | Preview is the real Main Dashboard (?preview=1): tests/e2e/test_control_room.py::test_layout_has_controls_left_and_preview_right |  |
| A-14.1 | A | Preview test: SMHI OFF pending-off then Main disabled | BROKEN | DONE | tests/e2e/test_control_room.py::test_source_off_is_pending_in_preview_then_live_after_apply |  |
| A-14.2 | A | Preview test: Forest layer OFF preview then Main | MISSING | DONE | tests/e2e/test_control_room.py::test_forest_layer_off_only_in_preview_until_applied |  |
| A-14.3 | A | Preview test: Population +10%/2030 preview then Main | MISSING | PARTIAL | tests/e2e/test_control_room.py::test_scenario_editor_test_run_shows_result_in_preview (result in Preview); saved result on Main via /api/simulation/run | Year has no effect on values: tests/test_spec_gaps.py::test_population_formula_depends_on_target_year |
| A-14.4 | A | Preview test: Change HIGH threshold | MISSING | DONE | tests/e2e/test_control_room.py::test_threshold_change_recalculates_labels_live_and_applies |  |
| A-14.5 | A | Preview test: Select Borlänge focus then saved scope | MISSING | DONE | tests/e2e/test_control_room.py::test_select_borlange_scope_pending_then_saved |  |
| A-14.6 | A | Preview test: Change interval pending then scheduler | MISSING | DONE | tests/e2e/test_control_room.py::test_update_interval_is_pending_then_scheduler_value_after_apply |  |
| A-17.1 | A | Admin auth on control endpoints | DONE | DONE | tests/test_control_api.py::test_mutating_endpoints_require_admin; /admin redirects to login: tests/e2e/test_control_room.py::test_admin_page_requires_login |  |
| A-17.2 | A | No secrets in frontend/Grafana | VIOLATES RULE | DONE | tests/test_secret_scan.py; compose no longer holds a Grafana password; anonymous Grafana is opt-in |  |
| A-17.3 | A | Validate imported config | MISSING | DONE | tests/e2e/test_control_room.py::test_config_export_and_import_validation (invalid import rejected with a message) |  |
| A-17.4 | A | Audit log | PARTIAL | PARTIAL | Audit rows written; shown in System tab | tests/test_spec_gaps.py::test_audit_log_requires_admin |
| A-17.5 | A | Never delete history | DONE | DONE | See R-2.2 |  |
| A-17.6 | A | Sim labelled as scenarios not forecasts | MISSING | DONE | SIMULATED tag, SIMULATION MODE banner and 'not agency forecasts' note: tests/e2e/test_main_dashboard.py |  |
| A-17.7 | A | Authorization/roles | PARTIAL | PARTIAL | Admin-only control endpoints | Single admin role; no RBAC |
| B-4.1 | B | System Online / 6/6 -> health summary | VIOLATES RULE | DONE | tests/e2e/test_main_dashboard.py::test_header_chips_show_health_and_timestamps |  |
| B-4.2 | B | Last update -> per-source timestamps | VIOLATES RULE | DONE | tests/e2e/test_main_dashboard.py::test_header_chips_show_health_and_timestamps |  |
| B-4.3 | B | Dalarna chip scope info | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_header_chips_show_health_and_timestamps |  |
| B-4.4 | B | Current (2025) -> live | BROKEN | DONE | tests/e2e/test_main_dashboard.py::test_mode_toggle_is_a_session_view_and_does_not_change_saved_state |  |
| B-4.5 | B | Simulation (2030) -> simulation + year | BROKEN | DONE | tests/e2e/test_main_dashboard.py::test_mode_toggle_is_a_session_view_and_does_not_change_saved_state |  |
| B-4.6 | B | User icon menu | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_header_chips_show_health_and_timestamps |  |
| B-5.1 | B | Nav: Overview | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page | Routes use #/route (no SPA path fallback in the static server) |
| B-5.2 | B | Nav: Map | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page |  |
| B-5.3 | B | Nav: Simulation | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page |  |
| B-5.4 | B | Nav: Municipalities | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page |  |
| B-5.5 | B | Nav: Data Sources | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page |  |
| B-5.6 | B | Nav: Insights | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page |  |
| B-5.7 | B | Nav: Reports | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page |  |
| B-5.8 | B | Nav: Settings | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_every_nav_route_opens_its_own_page |  |
| B-6.1 | B | Cards show real status/values | VIOLATES RULE | DONE | tests/e2e/test_main_dashboard.py::test_cards_come_from_the_registry_not_hard_coded |  |
| B-6.2 | B | Cards clickable drill-down x6 | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_source_card_drilldown |  |
| B-6.3 | B | GET /api/datasources?source= records | PARTIAL | PARTIAL | Drill-down combines /api/datasources/summary and /api/datasources?source= | Endpoint returns geometry records only (no trends/metrics) |
| B-6.4 | B | Online badge read-only | DONE | DONE | tests/e2e/test_main_dashboard.py::test_online_badge_is_read_only |  |
| B-7.1 | B | Risk selector recolours map | BROKEN | DONE | tests/e2e/test_main_dashboard.py::test_risk_selector_recolours_the_map |  |
| B-8.1 | B | Zoom +/- | DONE | DONE | tests/e2e/test_main_dashboard.py::test_layers_menu_and_zoom |  |
| B-8.2 | B | Layers icon menu | BROKEN | DONE | tests/e2e/test_main_dashboard.py::test_layers_menu_and_zoom |  |
| B-8.3 | B | Polygon click quick detail | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_municipality_search_view_detail_and_back (map popup + drawer) |  |
| B-8.4 | B | Legend + scale read-only | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_current_simulated_change_columns_and_legend_are_not_buttons; scale bar follows zoom |  |
| B-9.1 | B | Scenario dropdown from API | MISSING | DONE | Scenarios from GET /api/simulation/scenarios; defaults load on change: tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run |  |
| B-9.2 | B | Year change makes result pending | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-9.3 | B | Slider + numeric synced/validated | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-9.4 | B | Scope dropdown | BROKEN | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-9.5 | B | Source dependency toggles | BROKEN | PARTIAL | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run | Engine ignores excluding the driver: tests/test_spec_gaps.py::test_excluding_the_driver_source_removes_its_effect |
| B-9.6 | B | Run -> POST /api/simulation/run, all panels | VIOLATES RULE | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-9.7 | B | Reset clears pending result | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-9.8 | B | Advanced options | BROKEN | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-10.1 | B | Run flow states | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_run_disables_button_and_shows_running_message |  |
| B-11.1 | B | 5 result cards clickable | VIOLATES RULE | DONE | tests/e2e/test_main_dashboard.py::test_result_cards_impact_rows_and_gauge_open_details |  |
| B-12.1 | B | Impact by Source table traceable, rows clickable | VIOLATES RULE | PARTIAL | tests/e2e/test_main_dashboard.py::test_result_cards_impact_rows_and_gauge_open_details; SMHI row External; excluded rows struck out | 'current' values are literals: tests/test_spec_gaps.py::test_impact_current_values_are_not_hard_coded_literals |
| B-13.1 | B | Gauge, label, takeaway, methodology | VIOLATES RULE | DONE | tests/e2e/test_main_dashboard.py::test_result_cards_impact_rows_and_gauge_open_details |  |
| B-14.1 | B | Search + 'No municipality found.' | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_municipality_search_view_detail_and_back |  |
| B-14.2 | B | Filter dropdown | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_municipality_search_view_detail_and_back |  |
| B-14.3 | B | View + row click | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_municipality_search_view_detail_and_back |  |
| B-14.4 | B | Risk badge detail; trend hover | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_municipality_search_view_detail_and_back |  |
| B-15.1 | B | Detail drawer full content + Back to Regional View | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_municipality_search_view_detail_and_back |  |
| B-16.1 | B | Export CSV filtered view | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_exports_csv_json_and_messages |  |
| B-16.2 | B | Export XLSX | MISSING | PARTIAL | XLSX built in the browser with SheetJS from cdnjs | Not covered by an automated test (needs internet) |
| B-16.3 | B | Export JSON run ID + assumptions | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_exports_csv_json_and_messages |  |
| B-16.4 | B | PDF/report | MISSING | PARTIAL | Print / Save as PDF through the browser | No server-side PDF report |
| B-17.1 | B | LIVE state | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_mode_toggle_is_a_session_view_and_does_not_change_saved_state |  |
| B-17.2 | B | SIMULATION banner | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-17.3 | B | RUNNING state | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-17.4 | B | SUCCESS consistent panels | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_run_disables_button_and_shows_running_message |  |
| B-17.5 | B | ERROR keep previous | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_failed_run_keeps_previous_result_and_shows_error |  |
| B-17.6 | B | STALE | PARTIAL | PARTIAL | Stale/error banner built from backend status (static/js/dashboard.js renderBanner) | No automated test for the stale state |
| B-18.1 | B | Message: Running simulation... Please wait. | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_exports_csv_json_and_messages, ::test_municipality_search_view_detail_and_back |  |
| B-18.2 | B | Message: Simulation completed successfully. Result ID: ... | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_exports_csv_json_and_messages, ::test_municipality_search_view_detail_and_back |  |
| B-18.3 | B | Message: Unable to retrieve this source. Showing last available data. | MISSING | PARTIAL | Exact wording implemented in static/js/dashboard.js | No automated test for these three |
| B-18.4 | B | Message: Data may be outdated. Last update: ... | PARTIAL | PARTIAL | Exact wording implemented in static/js/dashboard.js | No automated test for these three |
| B-18.5 | B | Message: Please correct the highlighted value(s). | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_exports_csv_json_and_messages, ::test_municipality_search_view_detail_and_back |  |
| B-18.6 | B | Message: Export created successfully. | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_exports_csv_json_and_messages, ::test_municipality_search_view_detail_and_back |  |
| B-18.7 | B | Message: Export could not be created. Please try again. | MISSING | PARTIAL | Exact wording implemented in static/js/dashboard.js | No automated test for these three |
| B-18.8 | B | Message: No municipality found. | MISSING | DONE | tests/e2e/test_main_dashboard.py::test_simulation_control_flow_pending_year_exclusion_and_run, ::test_exports_csv_json_and_messages, ::test_municipality_search_view_detail_and_back |  |
| E-1 | Both | Endpoint: GET /api/control/state | PARTIAL | PARTIAL | GET /api/control/state returns versioned state (tests/test_control_api.py) | Shape differs from the suggested example (sources are booleans, applied_* names) |
| E-2 | Both | Endpoint: POST /api/control/apply | PARTIAL | PARTIAL | tests/test_control_api.py | No server-side draft; DB-down 'save' goes to memory: tests/test_spec_gaps.py::test_apply_fails_when_database_is_down |
| E-3 | Both | Endpoint: POST /api/control/mode | PARTIAL | PARTIAL | tests/test_control_api.py::test_mode_and_map_layer_endpoints | No scenario_id |
| E-4 | Both | Endpoint: POST /api/control/source | DONE | DONE | tests/test_control_api.py |  |
| E-5 | Both | Endpoint: POST /api/control/source/test | MISSING | DONE | tests/test_control_extended.py |  |
| E-6 | Both | Endpoint: POST /api/control/source/refresh | MISSING | DONE | tests/test_control_extended.py |  |
| E-7 | Both | Endpoint: POST /api/control/source/register | MISSING | PARTIAL | tests/test_control_extended.py | tests/test_spec_gaps.py::test_registered_source_can_be_refreshed |
| E-8 | Both | Endpoint: POST /api/control/refresh-all | MISSING | DONE | tests/test_control_extended.py |  |
| E-9 | Both | Endpoint: POST /api/control/map-layer | DONE | DONE | tests/test_control_api.py |  |
| E-10 | Both | Endpoint: GET /api/control/map-state | DONE | PARTIAL | tests/test_control_api.py::test_map_state_marks_unconfigured_and_disabled_sources_unavailable | Hard-coded fallback rows in routers/control.py |
| E-11 | Both | Endpoint: GET /api/datasources/summary | DONE | PARTIAL | tests/test_sources_honesty.py | tests/test_spec_gaps.py::test_no_invented_source_status_when_database_is_down |
| E-12 | Both | Endpoint: GET /api/datasources?source= | PARTIAL | PARTIAL | Used by the drill-down | Geometry records only |
| E-13 | Both | Endpoint: GET /api/simulation/scenarios | MISSING | DONE | tests/test_simulation_api.py | Three scenarios are defined in code, not the database |
| E-14 | Both | Endpoint: POST /api/simulation/run | MISSING | PARTIAL | tests/test_simulation_api.py | tests/test_spec_gaps.py |
| E-15 | Both | Endpoint: POST /api/simulation/test | MISSING | DONE | tests/test_simulation_api.py; tests/e2e/test_control_room.py::test_run_test_simulation_leaves_official_result_unchanged |  |
| E-16 | Both | Endpoint: GET /api/simulation/result/{id} | MISSING | PARTIAL | tests/test_simulation_api.py | In memory only: tests/test_spec_gaps.py::test_simulation_results_are_persisted |
| E-17 | Both | Endpoint: GET /api/simulation/result/latest | MISSING | PARTIAL | tests/test_simulation_api.py | tests/test_spec_gaps.py::test_simulation_results_are_persisted |
| E-18 | Both | Endpoint: GET /api/risk/config | MISSING | DONE | tests/test_risk_api.py |  |
| E-19 | Both | Endpoint: POST /api/risk/config | MISSING | DONE | tests/test_risk_api.py |  |
| E-20 | Both | Endpoint: POST /api/risk/calculate | MISSING | DONE | tests/test_risk_api.py |  |
| E-21 | Both | Endpoint: GET /api/municipalities | PARTIAL | PARTIAL | tests/test_sources_honesty.py | Fabricated fallback populations when the DB is unreachable |
| E-22 | Both | Endpoint: GET /api/municipalities/{id} | PARTIAL | PARTIAL | tests/test_sources_honesty.py | Same fallback |
| E-23 | Both | Endpoint: Scenario CRUD | MISSING | MISSING |  | tests/test_spec_gaps.py::test_scenario_can_be_created |
| E-24 | Both | Endpoint: Config export/import | MISSING | DONE | tests/e2e/test_control_room.py::test_config_export_and_import_validation; tests/test_control_extended.py |  |
| E-25 | Both | Endpoint: Audit-log read | MISSING | PARTIAL | GET /api/system/audit works | Not admin-only: tests/test_spec_gaps.py::test_audit_log_requires_admin |
| E-26 | Both | Endpoint: System health (API/DB/Orion-LD/sim) | PARTIAL | PARTIAL | GET /api/system/health (admin) | No Orion-LD / simulation-engine checks |
| C-1 | Both | Conflict 1: duplicate Map Controls, use fuller | DONE | DONE | See rows B-8.x, A-5.2, E-12 and E-21 |  |
| C-2 | Both | Conflict 2: Main toggle session-only | PARTIAL | DONE | tests/e2e/test_main_dashboard.py::test_mode_toggle_is_a_session_view_and_does_not_change_saved_state |  |
| C-3 | Both | Conflict 3: mode accepts year + scenario_id | PARTIAL | PARTIAL | year is accepted | scenario_id is not |
| C-4 | Both | Conflict 4: extend state schema | PARTIAL | PARTIAL | layers, components, thresholds, version are in the state | Suggested 4-band lower-bound threshold shape not adopted |
| C-5 | Both | Conflict 5: one components object | DONE | DONE | See rows B-8.x, A-5.2, E-12 and E-21 |  |
| C-6 | Both | Conflict 6: sources keyed by registry id as objects | PARTIAL | PARTIAL | Keyed by registry id | Values are booleans, not objects |
| C-7 | Both | Conflict 7: datasources/municipalities still required | DONE | DONE | See rows B-8.x, A-5.2, E-12 and E-21 |  |
| X-1 | Both | No invented data when DB/connector unavailable | VIOLATES RULE | VIOLATES RULE | Backend still contains in-memory/fabricated fallbacks (app/control.py, app/sources.py, app/municipalities.py) | tests/test_spec_gaps.py::test_no_invented_source_status_when_database_is_down, ::test_apply_fails_when_database_is_down |
| X-2 | Both | Test coverage of section 9 | PARTIAL | PARTIAL | pytest: 91 passed + 11 documented xfail; 39 Playwright tests; tests/test_secret_scan.py | No automated test for stale state, XLSX, offline map tiles |
| X-3 | Both | Baseline uncommitted | PARTIAL | DONE | Baseline and each change committed (git log) |  |
| X-4 | Both | Infra hardening | PARTIAL | PARTIAL | Compose: DB ports bound to 127.0.0.1, Grafana anonymous opt-in, sanitising on, password from .env | Dockerfile runs as root; images use :latest |
| X-5 | A | Admin UI imitates Grafana branding, not Grafana | PARTIAL | DONE | Control Room (static/control.html) has no Grafana branding; /admin serves it | Old static/admin.html + admin.js still exist and are still reachable at /admin.html; delete them |
| X-6 | Both | Legacy cockpit/ingestor.py with creds; French strings | PARTIAL | PARTIAL | ingestor.py reads credentials from the environment | French strings in legacy telemetry endpoints; legacy cockpit page |

## 4. Counts

| Status | Phase 0 audit | Final |
|---|---|---|
| DONE | 14 | 134 |
| PARTIAL | 54 | 47 |
| MISSING | 74 | 2 |
| BROKEN | 18 | 1 |
| VIOLATES RULE | 25 | 1 |
| **Total** | **185** | **185** |

## 5. Acceptance checklist: Spec A

- [x] Every button has a defined action and backend/API behaviour: `test_all_nine_tabs_exist_and_render_their_own_content`, `test_global_buttons_live_simulation_reset_cancel_refresh`
- [x] Every tab has a defined purpose: nine tabs, one content each
- [x] Preview clearly shows what the Main Dashboard will look like: `test_layout_has_controls_left_and_preview_right`
- [x] Unsaved changes do not silently alter the live dashboard: `test_source_off_is_pending_in_preview_then_live_after_apply`
- [x] Save & Apply is the explicit commit action: same test; failures keep the draft (`test_failed_apply_keeps_draft_and_reports_the_error`)
- [x] Turning a source OFF does not delete stored historical data: `test_disabling_a_source_keeps_history`
- [ ] New sources can be registered without rewriting the dashboard: registration and UI are dynamic (`test_add_seventh_source_appears_everywhere_without_code_changes`) but the backend cannot fetch from a new source yet (`test_registered_source_can_be_refreshed`, xfail)
- [ ] Simulation is dependency-based, not the same % on every source: coefficients differ per source and SMHI is unchanged, but the year and driver-exclusion are ignored (`test_spec_gaps.py`)
- [x] Simulation outputs are clearly labelled as scenarios: SIMULATED tag, SIMULATION MODE banner, "not agency forecasts"
- [x] All 15 Dalarna municipalities are supported: `test_municipality_search_view_detail_and_back`
- [ ] Risk thresholds are configurable, not hard-coded in JavaScript: true for the UI (`test_main_dashboard_uses_backend_thresholds_and_components`); the engine still labels with its own config (`test_simulation_uses_saved_risk_thresholds`, xfail)
- [x] API secrets remain server-side: `tests/test_secret_scan.py` (working tree; git history still holds the old password)
- [x] Main Dashboard and Preview use the same backend state model: the Preview is the Main Dashboard itself (`?preview=1`)

## 6. Acceptance checklist: Spec B

- [x] Every visible button/control has an implemented action: both browser suites; no placeholder pages remain
- [x] Left navigation opens the correct workspace: `test_every_nav_route_opens_its_own_page` (hash routes)
- [x] Current and Simulation modes are clearly separated: `test_mode_toggle_is_a_session_view_and_does_not_change_saved_state`
- [x] Source cards show status and support drill-down: `test_source_card_drilldown`
- [x] Map zoom controls work: `test_layers_menu_and_zoom`
- [x] Map layer control works: same test
- [x] Risk selector changes map visualization: `test_risk_selector_recolours_the_map`
- [x] Simulation controls remain synchronized: `test_simulation_control_flow_pending_year_exclusion_and_run`
- [x] Run Simulation calls the backend and updates all dependent panels: same test
- [x] Reset does not delete data: same test
- [x] Simulation outputs are clearly labelled as simulated: SIMULATED tags in cards, tables, drawers, exports
- [ ] Impact-by-source values are traceable to configured dependencies: traceable through coefficients and the drawer, but the "current" values are hard-coded in the backend (`test_impact_current_values_are_not_hard_coded_literals`, xfail)
- [x] Municipality search/filter works across all 15 municipalities: `test_municipality_search_view_detail_and_back`
- [x] Municipality View opens detailed results: same test
- [x] Export exports the current/selected result: `test_exports_csv_json_and_messages` (XLSX needs internet, not tested)
- [ ] Loading, success, stale and error states are implemented: all implemented; the stale state has no automated test
- [x] Live data is never overwritten by simulation data: the engine is pure and writes nothing; LIVE view shows no simulated values
- [x] API credentials are never exposed in frontend code: `tests/test_secret_scan.py`, `test_no_console_errors_and_no_secrets_in_frontend`
- [x] Main Dashboard uses a consistent backend state: one result store feeds every panel (`test_simulation_control_flow_pending_year_exclusion_and_run`)

## 7. Still open (needs the backend owner or your decision)

1. **Simulation engine** (`simulation/engine.py`): ignore of `target_year` (A-7.3), saved thresholds, `scb` exclusion, +10% default for non-population scenarios, hard-coded municipality baselines and impact "current" values, results held in memory only. Tests: `tests/test_spec_gaps.py`.
2. **Silent fakes when the database is down** (`app/control.py`, `app/sources.py`, `app/municipalities.py`, `app/routers/control.py`).
3. **Missing endpoints:** scenario CRUD, source configure (edit connection details), generic connector for newly registered sources.
4. **Security:** `/api/system/audit` and `/api/system/export` are readable without login; `/api/simulation/run` is public and replaces the "official" latest result for everyone (the `PUBLIC_SIMULATION` setting is not enforced).
5. **Git history** still contains the old password. Rewriting history is destructive and needs your approval; rotate the password anywhere it was used.
6. **Duplicate legacy UI:** `static/admin.html`, `static/js/admin.js`, `static/js/main.js`, `static/js/map.js` and their CSS are no longer used by `/` or `/admin` but still exist (`/admin.html` is still reachable). Delete them once nobody edits them.
7. **Docs written by another editor** (`docs/CONTROL_STATE.md`, `docs/SIMULATION_MODEL.md` and an earlier `FINAL_REPORT.md`) described features that do not exist; they were replaced by accurate versions.
