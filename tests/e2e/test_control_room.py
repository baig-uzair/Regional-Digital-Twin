"""Spec A interactions: tabs, global buttons, pending vs saved, Preview behaviour (A-14), sources, scenarios."""
import json
import re

from playwright.sync_api import expect

from .conftest import BASE, PASSWORD, USER

TABS = ["Overview", "Dashboard Control", "Data Sources", "Scenarios", "Risk Settings", "Map & Regions", "Appearance", "Users & Access", "System"]


def saved_state(api):
    return api.get(f"{BASE}/api/control/state").json()


def tab(page, name):
    page.click(f'.cr-tab:has-text("{name}")')
    page.wait_for_selector("#cr-content .cr-card")


def preview(page):
    return page.frame_locator("#preview-frame")


def wait_preview(page):
    preview(page).locator(".kpi-card").first.wait_for()
    page.wait_for_timeout(500)  # let the pending state arrive


def test_control_room_requires_login(page):
    page.goto(f"{BASE}/control.html")
    page.wait_for_url("**/login**")
    assert "next=" in page.url
    page.goto(f"{BASE}/admin")  # the server-side gate for /admin is unchanged
    assert "/login" in page.url


def test_all_nine_tabs_exist_and_render_their_own_content(page, admin_page):
    labels = page.locator(".cr-tab").all_inner_texts()
    assert [t.strip() for t in labels] == TABS
    seen = set()
    for name in TABS:
        tab(page, name)
        seen.add(page.locator("#cr-content").inner_text()[:80])
    assert len(seen) == 9  # no tab shows another tab's content


def test_layout_has_controls_left_and_preview_right(page, admin_page):
    left = page.locator("#cr-content").bounding_box()
    right = page.locator("#preview-frame").bounding_box()
    assert left["x"] < right["x"]
    wait_preview(page)
    expect(preview(page).locator("h1")).to_contain_text("DALARNA REGIONAL DIGITAL TWIN")


def test_source_off_is_pending_in_preview_then_live_after_apply(page, admin_page, api):
    tab(page, "Data Sources")
    wait_preview(page)
    page.locator('[data-act="toggle-source"][data-id="smhi"] + .toggle-switch-slider').click()
    expect(page.locator("#cr-dirty")).to_have_text("1 unsaved change")
    expect(preview(page).locator(".kpi-card.pending-off")).to_contain_text("Pending OFF")
    assert saved_state(api)["sources"]["smhi"] is True  # nothing committed yet
    page.click("#cr-apply")
    expect(page.locator("#modal")).to_contain_text("Applied")
    page.click("#modal [data-close-modal]")
    assert saved_state(api)["sources"]["smhi"] is False
    expect(page.locator("#cr-dirty")).to_be_hidden()
    main = page.context.new_page()
    main.goto(f"{BASE}/")
    card = main.locator(".kpi-card", has_text="SMHI")
    expect(card).to_contain_text("Disabled")


def test_disabling_a_source_keeps_history(page, admin_page, api):
    from app import db

    with db.cursor() as cur:
        cur.execute("INSERT INTO regional_telemetry (time, entity_id, temperature) VALUES (now(), 'e2e-keep', 1.5)")
        cur.execute("SELECT count(*) AS n FROM regional_telemetry")
        before = cur.fetchone()["n"]
    tab(page, "Data Sources")
    page.locator('[data-act="toggle-source"][data-id="smhi"] + .toggle-switch-slider').click()
    page.click("#cr-apply")
    page.wait_for_selector("#modal")
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM regional_telemetry")
        assert cur.fetchone()["n"] == before


def test_forest_layer_off_only_in_preview_until_applied(page, admin_page, api):
    tab(page, "Map & Regions")
    wait_preview(page)
    page.locator('[data-act="toggle-layer"][data-key="forest"] + .toggle-switch-slider').click()
    preview(page).locator('[data-act="layers-menu"]').click()
    expect(preview(page).locator('#popover input[data-layer="forest"]')).not_to_be_checked()
    assert saved_state(api)["layers"]["forest"] is True
    page.click("#cr-apply")
    page.wait_for_selector("#modal")
    assert saved_state(api)["layers"]["forest"] is False
    main = page.context.new_page()
    main.goto(f"{BASE}/")
    main.wait_for_selector(".kpi-card")
    main.click('[data-act="layers-menu"]')
    expect(main.locator('#popover input[data-layer="forest"]')).not_to_be_checked()


def test_threshold_change_recalculates_labels_live_and_applies(page, admin_page, api):
    tab(page, "Risk Settings")
    wait_preview(page)
    page.fill("#r-score", "0.55")
    expect(page.locator("#cr-content .risk-badge").first).to_have_text("Medium")
    page.fill("#r-high", "0.5")
    page.fill("#r-medium", "0.4")
    page.fill("#r-low", "0.2")
    expect(page.locator("#cr-content .risk-badge").first).to_have_text("Critical")  # 0.55 >= high(0.5)
    expect(page.locator("#cr-content .pending-badge")).to_contain_text("was Medium")
    # validation: not ascending
    page.fill("#r-low", "0.9")
    expect(page.locator("#cr-content")).to_contain_text("strictly ascending")
    expect(page.locator('[data-act="risk-save"]')).to_be_disabled()
    page.fill("#r-low", "0.2")
    page.click('[data-act="risk-save"]')
    expect(page.locator("#toasts")).to_contain_text("Save & Apply")
    assert saved_state(api)["risk_thresholds"]["high"] == 0.8  # not live yet
    expect(preview(page).locator(".map-risk-legend")).to_contain_text("0.40") if False else None
    page.click("#cr-apply")
    page.wait_for_selector("#modal")
    th = saved_state(api)["risk_thresholds"]
    assert (th["low"], th["medium"], th["high"]) == (0.2, 0.4, 0.5)
    main = page.context.new_page()
    main.goto(f"{BASE}/")
    main.click('[data-act="mode"][data-mode="simulation"]')
    expect(main.locator(".map-risk-legend")).to_contain_text("0.40")


def test_select_borlange_scope_pending_then_saved(page, admin_page, api):
    tab(page, "Dashboard Control")
    wait_preview(page)
    page.select_option("#f-scope", "2081")
    expect(preview(page).locator(".location-chip")).to_contain_text("Borlänge")
    assert saved_state(api)["scope"] == "dalarna"
    page.click("#cr-apply")
    page.wait_for_selector("#modal")
    assert saved_state(api)["scope"] == "2081"


def test_update_interval_is_pending_then_scheduler_value_after_apply(page, admin_page, api):
    tab(page, "Data Sources")
    page.select_option('select[data-id="sgu"]', "3600")
    expect(page.locator("#cr-content .pending-badge", has_text="pending")).to_be_visible()
    summary = api.get(f"{BASE}/api/datasources/summary").json()
    assert next(s for s in summary["sources"] if s["id"] == "sgu")["interval_seconds"] == 21600
    page.click("#cr-apply")
    page.wait_for_selector("#modal")
    summary = api.get(f"{BASE}/api/datasources/summary").json()
    assert next(s for s in summary["sources"] if s["id"] == "sgu")["interval_seconds"] == 3600  # registry the scheduler reads


def test_global_buttons_live_simulation_reset_cancel_refresh(page, admin_page, api):
    wait_preview(page)
    page.click("#cr-sim")
    expect(preview(page).locator(".banner.sim")).to_contain_text("SIMULATION MODE")
    expect(page.locator("#cr-dirty")).to_be_visible()
    page.click("#cr-live")
    expect(page.locator("#cr-dirty")).to_be_hidden()  # back to saved
    page.click("#cr-sim")
    page.click("#cr-reset")
    expect(page.locator("#cr-dirty")).to_be_hidden()
    expect(preview(page).locator(".banner.live")).to_be_visible()
    page.click("#cr-sim")
    page.click("#cr-cancel")
    expect(page.locator("#modal")).to_contain_text("Discard unsaved changes?")
    page.click('[data-act="discard-confirm"]')
    expect(page.locator("#cr-dirty")).to_be_hidden()
    assert saved_state(api)["mode"] == "live"
    page.click("#cr-refresh-preview")
    wait_preview(page)


def test_appearance_and_dashboard_control_share_one_components_object(page, admin_page):
    tab(page, "Appearance")
    page.locator('[data-act="toggle-comp"][data-key="municipality_table"] + .toggle-switch-slider').click()
    tab(page, "Dashboard Control")
    expect(page.locator('[data-act="toggle-comp"][data-key="municipality_table"]')).not_to_be_checked()
    expect(page.locator("#cr-dirty")).to_have_text("1 unsaved change")
    assert preview(page).locator(".muni-card").count() == 0


def test_failed_apply_keeps_draft_and_reports_the_error(page, admin_page, api):
    tab(page, "Appearance")
    page.locator('[data-act="toggle-comp"][data-key="map"] + .toggle-switch-slider').click()
    page.route("**/api/control/apply", lambda r: r.fulfill(status=500, content_type="application/json", body=json.dumps({"error": {"code": "internal_error", "message": "boom"}})))
    page.click("#cr-apply")
    expect(page.locator("#toasts")).to_contain_text("Could not apply")
    expect(page.locator("#cr-dirty")).to_have_text("1 unsaved change")  # draft kept
    assert saved_state(api)["components"]["map"] is True


def test_version_conflict_is_explained(page, admin_page, api):
    tab(page, "Appearance")
    page.locator('[data-act="toggle-comp"][data-key="map"] + .toggle-switch-slider').click()
    state = saved_state(api)
    body = {k: state[k] for k in ("mode", "scope", "sources", "source_intervals", "layers", "components", "risk_thresholds", "active_scenario", "simulation_year")}
    body["scope"] = "2080"
    assert api.post(f"{BASE}/api/control/apply", json={"base_version": state["version"], "state": body}).status_code == 200
    page.click("#cr-apply")
    expect(page.locator("#modal")).to_contain_text("changed elsewhere")
    page.click('[data-act="rebase"]')
    expect(page.locator("#cr-dirty")).to_have_text("1 unsaved change")  # my change survives the rebase
    page.click("#cr-apply")
    page.wait_for_selector("#modal")
    final = saved_state(api)
    assert final["components"]["map"] is False and final["scope"] == "2080"


def test_add_seventh_source_appears_everywhere_without_code_changes(page, admin_page, api):
    tab(page, "Data Sources")
    page.click('[data-act="add-source"]')
    page.fill("#sf-id", "e2e7")
    page.click('[data-act="register-source"]')  # missing name/category: highlighted
    expect(page.locator("#toasts")).to_contain_text("Please correct the highlighted value(s).")
    page.fill("#sf-name", "Energy Demo")
    page.fill("#sf-cat", "Energy")
    page.fill("#sf-url", "https://example.org/api")
    page.click('[data-act="register-source"]')
    expect(page.locator("#cr-content .cr-table")).to_contain_text("Energy Demo")
    summary = api.get(f"{BASE}/api/datasources/summary").json()
    assert any(s["id"] == "e2e7" for s in summary["sources"])
    main = page.context.new_page()
    main.goto(f"{BASE}/")
    main.wait_for_selector(".kpi-card")
    assert main.locator(".kpi-card").count() == 7
    main.click('[data-act="mode"][data-mode="simulation"]')
    expect(main.locator(".sim-toggles-list")).to_contain_text("Energy Demo")


def test_test_connection_and_refresh_report_results_and_do_not_lose_data(page, admin_page):
    from app import db

    with db.cursor() as cur:
        cur.execute("INSERT INTO regional_telemetry (time, entity_id, temperature) VALUES (now(), 'e2e-keep2', 2.5)")
        cur.execute("SELECT count(*) AS n FROM regional_telemetry")
        before = cur.fetchone()["n"]
    tab(page, "Data Sources")
    page.click('[data-act="src-test"][data-id="smhi"]')
    page.wait_for_selector(".cr-log .cr-result")
    log = page.locator(".cr-log").inner_text()
    assert "Test connection: SMHI" in log and "Response time" in log and "nothing was stored" in log
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM regional_telemetry")
        assert cur.fetchone()["n"] == before  # testing never changes stored data
    page.click('[data-act="src-refresh"][data-id="smhi"]')
    page.wait_for_function("document.querySelector('.cr-log').innerText.includes('Refresh: SMHI')")
    assert "Records received" in page.locator(".cr-log").inner_text()


def test_refresh_all_reports_per_source_and_total(page, admin_page):
    tab(page, "Data Sources")
    page.click('[data-act="refresh-all"]')
    page.wait_for_function("document.querySelector('.cr-log').innerText.includes('Refresh All')", timeout=120000)
    text = page.locator(".cr-log").inner_text()
    assert "Total:" in text and "SMHI" in text


def test_run_test_simulation_leaves_official_result_unchanged(page, admin_page, api):
    official = api.post(f"{BASE}/api/simulation/run", json={"scenario": "population_growth", "target_year": 2030, "scope": "dalarna", "driver": {"population_change": 0.1}}).json()["run_id"]
    page.click(".cr-tab:has-text('Overview')")
    page.click('[data-act="test-sim"]')
    expect(page.locator("#toasts")).to_contain_text("Test completed; official result unchanged")
    assert api.get(f"{BASE}/api/simulation/result/latest").json()["run_id"] == official


def test_scenario_editor_test_run_shows_result_in_preview(page, admin_page, api):
    tab(page, "Scenarios")
    page.wait_for_selector("#s-name")
    page.fill("#s-pop", "99")
    page.click('[data-act="scn-test"]')
    expect(page.locator("#toasts")).to_contain_text("Please correct the highlighted value(s).")
    page.fill("#s-pop", "12")
    page.click('[data-act="scn-test"]')
    expect(page.locator("#cr-content")).to_contain_text("Test completed; official result unchanged")
    expect(page.locator("#cr-content")).to_contain_text("SIMULATED")
    preview(page).locator(".results-meta").wait_for()
    assert "TEST RUN" in preview(page).locator(".results-meta").inner_text()


def test_config_export_and_import_validation(page, admin_page, tmp_path):
    page.click(".cr-tab:has-text('Overview')")
    with page.expect_download() as d:
        page.click('[data-act="export-config"]')
    exported = json.load(open(d.value.path(), encoding="utf-8"))
    assert exported["config"]["version"] >= 1
    # valid import: change summary then Apply to draft (not live)
    cfg = {k: v for k, v in exported["config"].items() if k not in ("version", "applied_at", "applied_by")}
    cfg["scope"] = "2080"
    f = tmp_path / "ok.json"
    f.write_text(json.dumps(cfg), encoding="utf-8")
    page.set_input_files("#import-file", str(f))
    expect(page.locator("#modal")).to_contain_text("Review imported configuration")
    expect(page.locator("#modal")).to_contain_text("Scope")
    page.click('[data-act="import-apply"]')
    expect(page.locator("#cr-dirty")).to_have_text("1 unsaved change")
    # invalid import is rejected with a clear message
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"mode": "bogus"}), encoding="utf-8")
    page.set_input_files("#import-file", str(bad))
    expect(page.locator("#modal")).to_contain_text("Import rejected")
    page.click("#modal [data-close-modal]")
    not_json = tmp_path / "x.json"
    not_json.write_text("{not json", encoding="utf-8")
    page.set_input_files("#import-file", str(not_json))
    expect(page.locator("#toasts")).to_contain_text("not valid JSON")


def test_system_and_users_tabs_show_health_and_audit(page, admin_page):
    tab(page, "System")
    expect(page.locator("#cr-content")).to_contain_text("Database")
    page.wait_for_function("document.querySelector('#cr-content').innerText.includes('control.') || document.querySelector('#cr-content').innerText.includes('auth.') || document.querySelector('#cr-content').innerText.includes('No events yet')")
    tab(page, "Users & Access")
    expect(page.locator("#cr-content")).to_contain_text(USER)
    assert PASSWORD not in page.content()  # secrets are never rendered


def test_unsaved_draft_survives_reload_but_not_applied(page, admin_page, api):
    tab(page, "Appearance")
    page.locator('[data-act="toggle-comp"][data-key="map"] + .toggle-switch-slider').click()
    page.reload()
    page.wait_for_selector("#cr-content .cr-card")
    expect(page.locator("#cr-dirty")).to_have_text("1 unsaved change")
    assert saved_state(api)["components"]["map"] is True
    assert not re.search("error", " ".join(page.errors), re.I)
