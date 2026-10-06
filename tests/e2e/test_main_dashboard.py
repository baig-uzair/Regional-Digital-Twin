"""Spec B interactions (B-4 ... B-18) against the real app in a real browser."""
import json
import re

from playwright.sync_api import expect

from .conftest import BASE

URL = f"{BASE}/?e2e=1"
STATE_KEYS = ("mode", "scope", "sources", "source_intervals", "layers", "components", "risk_thresholds", "active_scenario", "simulation_year")


def open_main(page, sim=False):
    page.goto(URL)
    page.wait_for_selector(".kpi-card")
    page.wait_for_function("window.__dt && window.__dt.loaded")
    if sim:
        page.click('[data-act="mode"][data-mode="simulation"]')
        page.wait_for_selector("#sim-control")
    return page


def run_sim(page):
    page.click("#btn-run-sim")
    page.wait_for_selector(".results-meta")


def apply_state(api, **changes):
    state = api.get(f"{BASE}/api/control/state").json()
    body = {k: state[k] for k in STATE_KEYS}
    for key, value in changes.items():
        body[key] = {**body[key], **value} if isinstance(value, dict) else value
    r = api.post(f"{BASE}/api/control/apply", json={"base_version": state["version"], "state": body})
    assert r.status_code == 200, r.text


def test_cards_come_from_the_registry_not_hard_coded(page, api):
    open_main(page)
    summary = api.get(f"{BASE}/api/datasources/summary").json()
    names = [s["name"] for s in summary["sources"]]
    cards = page.locator(".kpi-card .kpi-name").all_inner_texts()
    assert cards == names and len(cards) == 6
    html = page.content()
    for fake in ("12,450", "~450,000 ha", "4,320 buildings"):
        assert fake not in html


def test_online_badge_is_read_only(page, api):
    open_main(page)
    badge = page.locator(".kpi-card").first.locator(".status-pill")
    assert badge.evaluate("e => e.tagName") == "SPAN"
    before = api.get(f"{BASE}/api/control/state").json()["sources"]
    badge.click()  # opens the drill-down (card click) but must not toggle anything
    page.keyboard.press("Escape")
    assert api.get(f"{BASE}/api/control/state").json()["sources"] == before


def test_header_chips_show_health_and_timestamps(page):
    open_main(page)
    page.click('[data-act="sys-health"]')
    expect(page.locator("#popover")).to_contain_text("System health")
    page.click('[data-act="last-update"]')
    expect(page.locator("#popover")).to_contain_text("Last update per source")
    page.click('[data-act="scope-info"]')
    expect(page.locator("#popover")).to_contain_text("Scope: Dalarna")
    page.click('[data-act="user-menu"]')
    expect(page.locator("#popover")).to_contain_text("Not signed in")


def test_mode_toggle_is_a_session_view_and_does_not_change_saved_state(page, api):
    open_main(page)
    expect(page.locator(".banner.live")).to_be_visible()
    page.click('[data-act="mode"][data-mode="simulation"]')
    expect(page.locator(".banner.sim")).to_contain_text("SIMULATION MODE")
    assert api.get(f"{BASE}/api/control/state").json()["mode"] == "live"  # global default untouched
    page.click('[data-act="mode"][data-mode="live"]')
    expect(page.locator(".banner.live")).to_be_visible()
    assert page.locator("#results-panel .sim-tag").count() == 0  # no simulated values in LIVE


def test_every_nav_route_opens_its_own_page(page):
    open_main(page)
    expected = {"map": "#map-slot", "simulation": "#sim-control", "municipalities": ".muni-card", "data-sources": "text=Read-only overview", "insights": "text=Insights", "reports": "text=Reports & exports", "settings": "text=Personal settings"}
    for route, marker in expected.items():
        page.click(f'#nav a[data-route="{route}"]')
        page.wait_for_selector(marker)
        assert page.evaluate("location.hash") == f"#/{route}"
        assert "Real-time telemetry" not in page.content()  # the old placeholder text is gone


def test_source_card_drilldown(page):
    open_main(page)
    for name in ("SMHI", "Trafikverket", "SCB", "SGU", "Skogsstyrelsen", "Lantmäteriet"):
        page.locator(".kpi-card", has_text=name).first.click()
        expect(page.locator("#drawer")).to_contain_text(name)
        page.wait_for_selector("#src-body dl")
        page.keyboard.press("Escape")


def test_simulation_control_flow_pending_year_exclusion_and_run(page):
    open_main(page, sim=True)
    # slider <-> numeric input stay in sync
    page.fill("#pop-number", "15")
    assert page.input_value("#pop-slider") == "15"
    page.evaluate("const s = document.querySelector('#pop-slider'); s.value = 4; s.dispatchEvent(new Event('input', {bubbles: true}))")
    assert page.input_value("#pop-number") == "4"
    # invalid value: highlighted, message shown, input kept
    page.fill("#pop-number", "99")
    page.click("#btn-run-sim")
    expect(page.locator("#toasts")).to_contain_text("Please correct the highlighted value(s).")
    assert page.input_value("#pop-number") == "99"
    expect(page.locator(".num-wrap.invalid")).to_be_visible()
    page.fill("#pop-number", "10")
    page.click('[data-act="year"][data-year="2030"]')
    run_sim(page)
    expect(page.locator("#toasts")).to_contain_text("Simulation completed successfully. Result ID: sim-")
    expect(page.locator(".results-meta")).to_contain_text("2030")
    assert page.locator(".impact-table tbody tr").count() == 6
    expect(page.locator('.impact-table tr:has-text("Weather") .risk-badge')).to_have_text("External")
    # changing the year makes the 2030 result pending: it must never be shown as 2035
    page.click('[data-act="year"][data-year="2035"]')
    expect(page.locator(".pending-card")).to_be_visible()
    assert page.locator(".results-meta").count() == 0 and page.locator(".impact-table").count() == 0
    # back to the same inputs: the result is valid again
    page.click('[data-act="year"][data-year="2030"]')
    expect(page.locator(".results-meta")).to_be_visible()
    # a slider/number change also marks the result pending
    page.fill("#pop-number", "12")
    expect(page.locator(".pending-card")).to_be_visible()
    # excluding a source marks its consequence 'excluded' but keeps the data available
    page.fill("#pop-number", "10")
    page.locator('.sim-toggle-row:has-text("Trafikverket") .toggle-switch-slider').click()
    run_sim(page)
    expect(page.locator('.impact-table tr:has-text("Traffic")')).to_have_class(re.compile("excluded"))
    expect(page.locator('.impact-table tr:has-text("Traffic") .risk-badge')).to_have_text("Excluded")
    # Reset restores the inputs of the last result and deletes nothing
    page.fill("#pop-number", "3")
    page.click('[data-act="reset"]')
    assert page.input_value("#pop-number") == "10"


def test_run_disables_button_and_shows_running_message(page):
    open_main(page, sim=True)

    def slow(route):
        page.wait_for_timeout(900)
        route.continue_()

    page.route("**/api/simulation/run", slow)
    page.click("#btn-run-sim")
    expect(page.locator("#btn-run-sim")).to_be_disabled()
    expect(page.locator("#run-status")).to_have_text("Running simulation... Please wait.")
    page.wait_for_selector(".results-meta")
    expect(page.locator("#btn-run-sim")).to_be_enabled()


def test_failed_run_keeps_previous_result_and_shows_error(page):
    open_main(page, sim=True)
    run_sim(page)
    run_id = page.locator(".results-meta b").inner_text()
    page.route("**/api/simulation/run", lambda route: route.fulfill(status=500, content_type="application/json", body=json.dumps({"error": {"code": "internal_error", "message": "Something went wrong on the server."}})))
    page.click("#btn-run-sim")
    expect(page.locator("#toasts")).to_contain_text("Something went wrong")
    assert page.locator(".results-meta b").inner_text() == run_id  # previous valid result kept


def test_risk_selector_recolours_the_map(page):
    open_main(page, sim=True)
    run_sim(page)
    page.wait_for_function("window.__dt.map && window.__dt.map.map && window.__dt.map.map.getLayer('muni-fill')")
    page.wait_for_timeout(500)

    def paint():
        return page.evaluate("JSON.stringify(window.__dt.map.map.getPaintProperty('muni-fill','fill-color'))")

    overall = paint()
    page.select_option("#map-risk-select", "infrastructure_risk")
    page.wait_for_function("document.querySelector('#map-title').textContent.includes('Infrastructure')")
    page.wait_for_timeout(400)
    assert paint() != overall


def test_layers_menu_and_zoom(page):
    open_main(page)
    page.wait_for_function("window.__dt.map && window.__dt.map.map && window.__dt.map.map.getLayer('muni-line')")
    z0 = page.evaluate("window.__dt.map.map.getZoom()")
    page.click('[data-act="zoom-in"]')
    page.wait_for_timeout(700)
    assert page.evaluate("window.__dt.map.map.getZoom()") > z0
    page.click('[data-act="zoom-out"]')
    page.click('[data-act="layers-menu"]')
    assert page.locator("#popover input[data-act=layer]").count() == 8
    page.uncheck('#popover input[data-layer="boundaries"]')
    page.wait_for_timeout(400)
    assert page.evaluate("window.__dt.map.map.getLayoutProperty('muni-line','visibility')") == "none"


def test_municipality_search_view_detail_and_back(page):
    open_main(page, sim=True)
    run_sim(page)
    assert page.locator(".muni-full-table tbody tr").count() == 15
    page.fill("#muni-search", "borlange")  # diacritic-insensitive
    assert page.locator(".muni-full-table tbody tr").count() == 1
    expect(page.locator(".muni-full-table tbody")).to_contain_text("Borlänge")
    page.fill("#muni-search", "zzz")
    expect(page.locator(".muni-full-table tbody")).to_contain_text("No municipality found.")
    page.fill("#muni-search", "Borl")
    page.locator(".btn-icon-view").first.click()
    drawer = page.locator("#drawer")
    for text in ("Borlänge", "Current population", "Simulated (2030)", "Food", "Snow", "Infrastructure", "Environment", "Overall", "Contributing sources", "Trend", "Assumptions", "Location"):
        expect(drawer).to_contain_text(text)
    page.click('[data-act="back-regional"]')
    assert page.locator("#drawer").count() == 0
    # row click and risk badge click
    page.fill("#muni-search", "")
    page.locator(".muni-full-table tbody tr").first.locator("td").nth(1).click()
    expect(page.locator("#drawer")).to_be_visible()
    page.keyboard.press("Escape")
    page.locator(".muni-full-table tbody .risk-badge.clickable").first.click()
    expect(page.locator("#drawer")).to_contain_text("Score")


def test_result_cards_impact_rows_and_gauge_open_details(page):
    open_main(page, sim=True)
    run_sim(page)
    page.locator('[data-act="open-cat"][data-cat="infrastructure_risk"]').click()
    expect(page.locator("#drawer")).to_contain_text("Contributing factors")
    page.keyboard.press("Escape")
    page.locator('.impact-table tr:has-text("Traffic")').click()
    expect(page.locator("#drawer")).to_contain_text("Coefficient")
    page.keyboard.press("Escape")
    page.locator('.impact-table tr:has-text("Weather")').click()
    expect(page.locator("#drawer")).to_contain_text("External condition")
    page.keyboard.press("Escape")
    page.click('[data-act="gauge"]')
    expect(page.locator("#drawer")).to_contain_text("Category contributions")
    page.keyboard.press("Escape")
    page.click('[data-act="methodology"]')
    expect(page.locator("#drawer")).to_contain_text("not agency forecasts")


def test_current_simulated_change_columns_and_legend_are_not_buttons(page):
    open_main(page, sim=True)
    run_sim(page)
    assert page.locator(".impact-table td.ro button").count() == 0
    assert page.locator(".map-risk-legend button, .map-scale-bar button").count() == 0


def test_exports_csv_json_and_messages(page):
    open_main(page, sim=True)
    run_sim(page)
    page.fill("#muni-search", "Falun")  # export honours the filtered view
    page.click('[data-act="export-menu"]')
    with page.expect_download() as d:
        page.click('[data-act="export"][data-fmt="csv"]')
    csv = open(d.value.path(), encoding="utf-8-sig").read()
    assert "Falun" in csv and "Borlänge" not in csv and "SIMULATED" in csv
    expect(page.locator("#toasts")).to_contain_text("Export created successfully.")
    page.click('[data-act="export-menu"]')
    with page.expect_download() as d2:
        page.click('[data-act="export"][data-fmt="json"]')
    payload = json.load(open(d2.value.path(), encoding="utf-8"))
    assert payload["run_id"].startswith("sim-") and payload["assumptions"] and len(payload["municipalities"]) == 1


def test_main_dashboard_uses_backend_thresholds_and_components(page, api):
    apply_state(api, risk_thresholds={"low": 0.2, "medium": 0.4, "high": 0.5}, components={"municipality_table": False})
    open_main(page, sim=True)
    expect(page.locator(".map-risk-legend")).to_contain_text("0.40")
    assert page.locator(".muni-card").count() == 0  # component hidden by admin; data untouched


def test_disabled_source_is_shown_as_disabled_on_main(page, api):
    apply_state(api, sources={"smhi": False})
    open_main(page)
    card = page.locator(".kpi-card", has_text="SMHI")
    expect(card).to_contain_text("Disabled")
    expect(card).to_contain_text("Unavailable")
    page.click('[data-act="layers-menu"]')
    expect(page.locator('#popover .layer-row:has-text("Weather")')).to_contain_text("turned off")


def test_no_console_errors_and_no_secrets_in_frontend(page, server):
    import requests

    open_main(page, sim=True)
    run_sim(page)
    assert page.errors == []
    for path in ("/js/dashboard.js", "/js/control-room.js", "/js/shared.js", "/js/dtmap.js", "/js/util.js", "/js/api.js", "/admin.html", "/index.html"):
        text = requests.get(BASE + path).text
        assert not re.search(r"(api[_-]?key|client[_-]?secret|password)\s*[:=]\s*['\"][^'\"]{6,}", text, re.I), path
