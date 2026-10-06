// Control Room (admin). Admin changes backend configuration and state ONLY; it never touches the
// Main Dashboard DOM. Unsaved edits live in a draft (A.pending) that is only shown in the Preview
// iframe via postMessage. "Save & Apply" is the single commit (POST /api/control/apply).
import { get, post, api } from "./api.js";
import { esc, fmtNum, fmtDateTime, relTime, fmtInterval, toast, openModal, closeModal, openPopover, closePopover } from "./util.js";
import * as H from "./shared.js";

const LOGIN_URL = "/login?next=/control.html";
const STATE_KEYS = ["mode", "scope", "sources", "source_intervals", "layers", "components", "risk_thresholds", "active_scenario", "simulation_year"];
const YEARS = [2026, 2030, 2035, 2040];
const INTERVALS = [60, 300, 900, 1800, 3600, 21600, 43200, 86400, 604800];
const TABS = [
  ["overview", "Overview", "fa-house"],
  ["control", "Dashboard Control", "fa-table-columns"],
  ["sources", "Data Sources", "fa-database"],
  ["scenarios", "Scenarios", "fa-code-branch"],
  ["risk", "Risk Settings", "fa-shield-halved"],
  ["map", "Map & Regions", "fa-map"],
  ["appearance", "Appearance", "fa-palette"],
  ["users", "Users & Access", "fa-users"],
  ["system", "System", "fa-gear"],
];
const COMPONENTS = [
  ["source_cards", "Source cards", "One card per registered data source"],
  ["regional_risk", "Regional risk", "Gauge and key takeaway"],
  ["population", "Population", "Population result card"],
  ["food_risk", "Food / Supply risk", "Result card and table column"],
  ["snow_flood_risk", "Snow / Flood risk", "Result card and table column"],
  ["infrastructure_risk", "Infrastructure risk", "Result card and table column"],
  ["environment_risk", "Environment risk", "Result card and table column"],
  ["municipality_table", "Municipality table", "All 15 or the selected municipality"],
  ["simulation_control", "Simulation control", "The visitor-facing scenario editor"],
  ["simulation_results", "Simulation results", "Impact by source table"],
  ["map", "Map", "Dalarna map with risk colouring"],
];
const LAYERS = [
  ["boundaries", "Municipality boundaries"], ["population", "Population"], ["weather", "Weather (SMHI)"], ["roads", "Roads (Trafikverket)"],
  ["water", "Water / Geology (SGU)"], ["forest", "Forest (Skogsstyrelsen)"], ["land", "Land parcels (Lantmäteriet)"], ["simulation_risk", "Simulation risk"],
];
const LABEL = Object.fromEntries([...COMPONENTS.map(([k, l]) => [`components.${k}`, `Component: ${l}`]), ...LAYERS.map(([k, l]) => [`layers.${k}`, `Map layer: ${l}`])]);

const A = {
  saved: null, pending: null, summary: null, munis: null, scenarios: [], mapState: null, me: null,
  health: null, audit: null, tab: "overview", busy: {}, log: [], scn: { sel: null, draft: null, isNew: false, errors: {} },
  testScore: 0.45, lastResult: null, previewResult: null, previewView: null, previewReady: false,
};
const $ = (s) => document.querySelector(s);
const clone = H.deepClone;
const META = ["version", "applied_at", "applied_by", "changed", "unchanged"];
const stripMeta = (s) => Object.fromEntries(Object.entries(s || {}).filter(([k]) => !META.includes(k)));
const payload = (s) => Object.fromEntries(STATE_KEYS.filter((k) => s?.[k] !== undefined).map((k) => [k, clone(s[k])]));
const enabledFlag = (v) => (v && typeof v === "object" ? v.enabled : v);
const srcs = () => A.summary?.sources || [];
const dirty = () => (A.saved && A.pending ? H.diffPaths(payload(A.saved), payload(A.pending)) : []);
const isDirty = (path) => dirty().some((p) => p === path || p.startsWith(path + "."));
const srcOn = (s) => { const v = enabledFlag(A.pending?.sources?.[s.id]); return v === undefined ? s.enabled : v; };

// ------------------------------------------------------------------ plumbing
async function guarded(fn) {
  try { return await fn(); } catch (e) {
    if (e.status === 401) { toast("Your session ended. Please sign in again.", "error"); setTimeout(() => (location.href = LOGIN_URL), 900); }
    throw e;
  }
}
const busy = (k, v) => { if (v) A.busy[k] = true; else delete A.busy[k]; renderContent(); renderChrome(); };
const spin = (k, label, icon = "fa-play") => (A.busy[k] ? `<i class="fa-solid fa-spinner spin"></i> ${label}…` : `<i class="fa-solid ${icon}"></i> ${label}`);

function persistPending() {
  H.storeSet("session", "cr_pending", { base: A.saved?.version, state: A.pending });
}

function touch({ content = true } = {}) {
  persistPending();
  renderChrome();
  if (content) renderContent();
  pushPreview();
}

function setPath(path, value) {
  const keys = path.split(".");
  let o = A.pending;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

function logAction(kind, title, lines = []) {
  A.log.unshift({ t: new Date().toISOString(), kind, title, lines });
  A.log = A.log.slice(0, 15);
}

async function pull(path) { return guarded(() => get(path)); }

async function loadAll() {
  const [saved, summary, munis, scenarios, mapState, me] = await Promise.all([
    pull("/api/control/state").catch(() => null), pull("/api/datasources/summary").catch(() => null), pull("/api/municipalities").catch(() => null),
    pull("/api/simulation/scenarios").catch(() => null), pull("/api/control/map-state").catch(() => null), get("/api/auth/me").catch(() => null),
  ]);
  if (!saved) { toast("Unable to load the saved configuration.", "error"); return; }
  A.saved = saved; A.summary = summary || A.summary; A.munis = munis || A.munis; A.scenarios = scenarios?.scenarios || A.scenarios;
  A.mapState = mapState || A.mapState; A.me = me;
  if (!me?.user) { location.href = LOGIN_URL; return; } // the page shell is static; only administrators may use it
  if (!A.pending) {
    const stored = H.storeGet("session", "cr_pending");
    if (stored && stored.base === saved.version && stored.state) { A.pending = stored.state; toast("Restored your unsaved draft.", "info"); }
    else A.pending = clone(payload(saved));
  }
  render();
}

async function reloadSummary() {
  const [summary, mapState] = await Promise.all([pull("/api/datasources/summary").catch(() => null), pull("/api/control/map-state").catch(() => null)]);
  if (summary) A.summary = summary;
  if (mapState) A.mapState = mapState;
}

// ------------------------------------------------------------------ preview protocol
function pushPreview() {
  const f = $("#preview-frame");
  if (!f?.contentWindow || !A.previewReady || !A.pending) return;
  f.contentWindow.postMessage({ type: "preview-state", state: A.pending, saved: stripMeta(A.saved), result: A.previewResult || undefined, view: A.previewView || undefined }, location.origin);
}
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === "preview-ready") { A.previewReady = true; pushPreview(); }
});

// ------------------------------------------------------------------ chrome (top bar, actions, tabs)
function renderChrome() {
  if (!A.saved) return;
  const d = dirty();
  $("#cr-saved").textContent = `Live: v${A.saved.version} · ${A.saved.applied_by || "system"} · ${fmtDateTime(A.saved.applied_at)}`;
  const chip = $("#cr-dirty");
  chip.classList.toggle("hidden", !d.length);
  chip.textContent = `${d.length} unsaved change${d.length === 1 ? "" : "s"}`;
  $("#cr-user span").textContent = A.me?.user ? `${A.me.user} · Sign out` : "Admin";
  const mode = A.pending?.mode;
  $("#cr-live").classList.toggle("active", mode === "live");
  $("#cr-sim").classList.toggle("active", mode === "simulation");
  const apply = $("#cr-apply");
  apply.disabled = !d.length || !!A.busy.apply;
  apply.innerHTML = A.busy.apply ? `<i class="fa-solid fa-spinner spin"></i> Applying…` : `<i class="fa-solid fa-floppy-disk"></i> Save &amp; Apply`;
  $("#cr-reset").disabled = !d.length;
  $("#cr-cancel").disabled = false;
  $("#cr-tabs").innerHTML = TABS.map(([id, label, icon]) => `<button class="cr-tab ${A.tab === id ? "active" : ""}" role="tab" aria-selected="${A.tab === id}" data-act="tab" data-tab="${id}"><i class="fa-solid ${icon}"></i> ${label}</button>`).join("");
}

// ------------------------------------------------------------------ small pieces
const toggle = (attrs, on, label, sub = "", extra = "") => `<label class="cr-toggle ${extra}"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" class="toggle-switch-input" ${attrs} ${on ? "checked" : ""}><span class="toggle-switch-slider"></span></label>`;
const sel = (id, opts, cur, attrs = "") => `<select id="${id}" ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const scopeOptions = () => [["dalarna", "All Dalarna (15 municipalities)"], ...(A.munis?.municipalities || []).map((m) => [m.code, m.name])];
const scenarioOptions = () => [["", "— none —"], ...A.scenarios.map((s) => [s.id, s.name])];
const yearOptions = (cur) => [...new Set([...YEARS, cur].filter(Boolean))].sort().map((y) => [y, String(y)]);

function pathLabel(p) {
  if (LABEL[p]) return LABEL[p];
  const [head, rest] = [p.split(".")[0], p.split(".").slice(1).join(".")];
  const name = (id) => srcs().find((s) => s.id === id)?.name || id;
  if (head === "sources") return `Source ${name(rest)} on/off`;
  if (head === "source_intervals") return `Update interval: ${name(rest)}`;
  if (head === "risk_thresholds") return "Risk thresholds (labels)";
  return { mode: "Dashboard mode", scope: "Scope", active_scenario: "Active scenario", simulation_year: "Target year" }[head] || p;
}

// ------------------------------------------------------------------ tabs
function tabOverview() {
  const d = dirty();
  const online = srcs().filter((s) => s.status === "online").length;
  const s = A.saved;
  return `
    <div class="panel cr-card"><div class="cr-card-head"><div><h2><i class="fa-solid fa-circle-check text-green"></i> Current configuration</h2><div class="cr-sub">What stakeholders see right now (saved version).</div></div></div>
      <dl class="cr-kv"><dt>Version</dt><dd>v${esc(s.version)} · ${esc(fmtDateTime(s.applied_at))} by ${esc(s.applied_by || "system")}</dd>
        <dt>Mode</dt><dd>${s.mode === "simulation" ? "SIMULATION" : "LIVE"}</dd>
        <dt>Active scenario</dt><dd>${esc(A.scenarios.find((x) => x.id === s.active_scenario)?.name || s.active_scenario || "none")}</dd>
        <dt>Target year</dt><dd>${esc(s.simulation_year || "—")}</dd><dt>Scope</dt><dd>${esc(A.munis?.municipalities?.find((m) => m.code === s.scope)?.name || "All Dalarna")}</dd></dl></div>
    <div class="panel cr-card"><div class="cr-card-head"><div><h2>System status</h2><div class="cr-sub">${online}/${srcs().length} sources online · last update ${esc(fmtDateTime(A.summary?.last_update))}</div></div>
      <button class="btn small" data-act="reload-summary"><i class="fa-solid fa-rotate"></i> Reload</button></div>
      <table class="cr-table"><thead><tr><th>Source</th><th>Status</th><th>Last update</th><th>Message</th></tr></thead><tbody>${srcs().map((x) => `<tr><td>${esc(x.name)}</td><td>${H.statusPill(x.status, x.status_label)}</td><td>${esc(x.last_success_at ? relTime(x.last_success_at) : "never")}</td><td class="muted">${esc(x.message)}</td></tr>`).join("")}</tbody></table></div>
    <div class="panel cr-card"><h2>Unsaved changes ${d.length ? `<span class="pending-badge">${d.length}</span>` : ""}</h2><div class="cr-sub">Visible only in Preview until you click Save &amp; Apply.</div>
      ${d.length ? `<ul class="diff-list">${d.map((p) => `<li>${esc(pathLabel(p))}</li>`).join("")}</ul>` : `<div class="muted">No unsaved changes. Preview matches the live dashboard.</div>`}</div>
    ${quickActions()}`;
}

function quickActions() {
  return `<div class="panel cr-card"><h2>Quick Actions</h2><div class="cr-sub">Common tasks.</div><div class="cr-qa">
    <button data-act="test-sim" ${A.busy.testSim ? "disabled" : ""}><i class="fa-solid ${A.busy.testSim ? "fa-spinner spin" : "fa-play"}"></i><div><b>Run Test Simulation</b><span>Safe: official result unchanged</span></div></button>
    <button data-act="refresh-all" ${A.busy.refreshAll ? "disabled" : ""}><i class="fa-solid ${A.busy.refreshAll ? "fa-spinner spin" : "fa-rotate"}"></i><div><b>Refresh All</b><span>Fetch every enabled source now</span></div></button>
    <button data-act="export-config"><i class="fa-solid fa-download"></i><div><b>Export Configuration</b><span>Download JSON</span></div></button>
    <button data-act="import-config"><i class="fa-solid fa-upload"></i><div><b>Import Configuration</b><span>Validate, review, then apply</span></div></button>
    <input type="file" id="import-file" accept="application/json,.json" class="hidden"></div>
    ${A.quickResult ? `<div class="cr-result ${A.quickResult.kind}"><h4>${esc(A.quickResult.title)}</h4>${A.quickResult.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>` : ""}</div>`;
}

function componentToggles() {
  return `<div class="cr-toggle-list">${COMPONENTS.map(([k, label, sub]) => toggle(`data-act="toggle-comp" data-key="${k}"`, A.pending.components?.[k] !== false, esc(label), esc(sub), isDirty(`components.${k}`) ? "changed" : "")).join("")}</div>`;
}

function tabControl() {
  const p = A.pending;
  return `
    <div class="panel cr-card"><h2>Dashboard Control</h2><div class="cr-sub">What appears on the Main Dashboard. Changes show in Preview first.</div>
      <div class="cr-grid2">
        <div class="cr-field"><label for="f-mode">Mode</label>${sel("f-mode", [["live", "Live (measured data)"], ["simulation", "Simulation (scenario)"]], p.mode)}</div>
        <div class="cr-field"><label for="f-scenario">Active scenario</label>${sel("f-scenario", scenarioOptions(), p.active_scenario || "")}</div>
        <div class="cr-field"><label for="f-year">Target year</label>${sel("f-year", yearOptions(p.simulation_year), p.simulation_year || YEARS[1])}</div>
        <div class="cr-field"><label for="f-scope">Scope</label>${sel("f-scope", scopeOptions(), p.scope)}</div></div></div>
    <div class="panel cr-card"><h2>Components</h2><div class="cr-sub">Switch off to hide a visual. Data is never deleted.</div>${componentToggles()}</div>`;
}

function intervalOptions(cur) {
  return [...new Set([...INTERVALS, cur])].sort((a, b) => a - b).map((v) => [v, fmtInterval(v)]);
}

function tabSources() {
  const rows = srcs().map((s) => {
    const v = H.sourceVisual(s), on = srcOn(s);
    const curInt = A.pending.source_intervals?.[s.id] ?? s.interval_seconds;
    const changedOn = isDirty(`sources.${s.id}`), changedInt = isDirty(`source_intervals.${s.id}`);
    return `<tr class="${changedOn || changedInt ? "changed" : ""}">
      <td><div class="cr-src"><i class="fa-solid ${v.icon} ${v.color}"></i><div><b>${esc(s.name)}</b><span>${esc(s.category)}</span></div></div></td>
      <td>${H.statusPill(s.status, s.status_label)}${changedOn ? `<span class="pending-badge">${on ? "will turn ON" : "will turn OFF"}</span>` : ""}</td>
      <td><label><input type="checkbox" class="toggle-switch-input" data-act="toggle-source" data-id="${esc(s.id)}" ${on ? "checked" : ""} aria-label="Enable ${esc(s.name)}"><span class="toggle-switch-slider"></span></label></td>
      <td><select data-act="interval" data-id="${esc(s.id)}" aria-label="Update interval ${esc(s.name)}">${intervalOptions(curInt).map(([v2, l]) => `<option value="${v2}" ${v2 === curInt ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${changedInt ? `<span class="pending-badge">pending</span>` : ""}</td>
      <td class="muted">${esc(s.last_success_at ? relTime(s.last_success_at) : "never")}</td>
      <td><div class="cr-acts">
        <button class="icon-btn" data-act="src-config" data-id="${esc(s.id)}" title="Configure ${esc(s.name)}" aria-label="Configure ${esc(s.name)}"><i class="fa-solid fa-gear"></i></button>
        <button class="icon-btn" data-act="src-test" data-id="${esc(s.id)}" ${A.busy["test:" + s.id] ? "disabled" : ""}>${spin("test:" + s.id, "Test", "fa-plug")}</button>
        <button class="icon-btn" data-act="src-refresh" data-id="${esc(s.id)}" ${A.busy["refresh:" + s.id] ? "disabled" : ""}>${spin("refresh:" + s.id, "Refresh", "fa-rotate")}</button>
        <button class="icon-btn" data-act="src-more" data-id="${esc(s.id)}" title="More" aria-label="More options for ${esc(s.name)}"><i class="fa-solid fa-ellipsis-vertical"></i></button></div></td></tr>`;
  }).join("");
  return `
    <div class="panel cr-card"><div class="cr-card-head"><div><h2><i class="fa-solid fa-database text-blue"></i> Data Sources</h2><div class="cr-sub">Switching a source OFF stops ingest and marks its layer unavailable. Stored history is kept.</div></div>
      <div class="cr-acts"><button class="btn small" data-act="refresh-all" ${A.busy.refreshAll ? "disabled" : ""}>${spin("refreshAll", "Refresh All", "fa-rotate")}</button><button class="btn small primary" data-act="add-source"><i class="fa-solid fa-plus"></i> Add Source</button></div></div>
      <div style="overflow:auto"><table class="cr-table"><thead><tr><th>Source</th><th>Status</th><th>Enabled</th><th>Update interval</th><th>Last update</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="muted">No sources loaded.</td></tr>`}</tbody></table></div></div>
    <div class="panel cr-card"><h2>Recent actions</h2><div class="cr-sub">Results of Test / Refresh actions (testing never changes stored data).</div>
      <div class="cr-log">${A.log.length ? A.log.map((l) => `<div class="cr-result ${l.kind}"><h4>${esc(l.title)} <span class="muted small">${esc(fmtDateTime(l.t))}</span></h4>${l.lines.map((x) => `<div>${esc(x)}</div>`).join("")}</div>`).join("") : `<div class="muted">Nothing yet.</div>`}</div></div>`;
}

function scnDraftFrom(s) {
  const { population_change, ...extra } = s.driver || {};
  return { id: s.id, name: s.name, driver_source: s.driver_source, target_year: s.target_year || 2030, scope: s.scope || "dalarna", pop: population_change != null ? Math.round(population_change * 10000) / 100 : 0, extra, affected: srcs().map((x) => x.id), description: s.description || "" };
}

function tabScenarios() {
  const d = A.scn.draft;
  const list = A.scenarios.map((s) => `<button class="scenario-item ${A.scn.sel === s.id && !A.scn.isNew ? "active" : ""}" data-act="scn-select" data-id="${esc(s.id)}"><b>${esc(s.name)}</b><small>${esc(s.driver_source)} · ${esc(s.target_year || "—")}</small></button>`).join("");
  const editor = d ? `
    <div class="cr-grid2">
      <div class="cr-field"><label for="s-name">Name</label><input id="s-name" value="${esc(d.name)}" class="${A.scn.errors.name ? "invalid" : ""}">${A.scn.errors.name ? `<span class="err">${esc(A.scn.errors.name)}</span>` : ""}</div>
      <div class="cr-field"><label for="s-driver">Driver source</label>${sel("s-driver", srcs().map((x) => [x.name, `${x.name} – ${x.category}`]), d.driver_source)}</div>
      <div class="cr-field"><label for="s-year">Target year</label>${sel("s-year", yearOptions(d.target_year), d.target_year)}</div>
      <div class="cr-field"><label for="s-scope">Scope</label>${sel("s-scope", scopeOptions(), d.scope)}</div>
      <div class="cr-field"><label for="s-pop">Driver value: population change (%)</label><input id="s-pop" type="number" step="1" min="-20" max="30" value="${esc(d.pop)}" class="${A.scn.errors.pop ? "invalid" : ""}">${A.scn.errors.pop ? `<span class="err">${esc(A.scn.errors.pop)}</span>` : `<span class="muted small">Population: future = current × (1 + rate)</span>`}</div>
      ${Object.entries(d.extra || {}).map(([k, v]) => `<div class="cr-field"><label for="s-x-${esc(k)}">${esc(k.replace(/_/g, " "))}</label><input id="s-x-${esc(k)}" data-extra="${esc(k)}" type="number" step="any" value="${esc(v)}"></div>`).join("")}</div>
    <h4 style="margin:14px 0 6px">Affected sources (configured dependencies)</h4>
    <div class="cr-toggle-list">${srcs().map((x) => { const ext = /weather|climate/i.test(x.category); return toggle(`data-act="scn-affected" data-id="${esc(x.id)}"`, d.affected.includes(x.id), esc(x.name), ext ? "External condition (context only)" : x.name === d.driver_source ? "Driver" : "Dependent", ""); }).join("")}</div>
    <div class="cr-actions-row">
      <button class="btn" data-act="scn-save" ${A.busy.scnSave ? "disabled" : ""}>${spin("scnSave", "Save Scenario", "fa-floppy-disk")}</button>
      <button class="btn" data-act="scn-test" ${A.busy.scnTest ? "disabled" : ""}>${spin("scnTest", "Run Test", "fa-flask")}</button>
      <button class="btn primary" data-act="scn-run" ${A.busy.scnRun ? "disabled" : ""}>${spin("scnRun", "Run Simulation", "fa-play")}</button>
      <button class="btn" data-act="scn-view"><i class="fa-regular fa-eye"></i> View Result</button></div>` : `<div class="muted">Select a scenario or create a new one.</div>`;
  return `
    <div class="panel cr-card"><div class="cr-card-head"><div><h2>Scenario Editor</h2><div class="cr-sub">Create, edit, test and run scenarios. “Run Test” never changes the official result.</div></div><button class="btn small primary" data-act="scn-new"><i class="fa-solid fa-plus"></i> Create Scenario</button></div>
      <div style="display:grid;grid-template-columns:minmax(150px,200px) 1fr;gap:16px"><div class="scenario-list">${list || `<div class="muted">No scenarios.</div>`}</div><div>${editor}</div></div></div>
    ${A.lastResult ? resultCard(A.lastResult) : ""}`;
}

function resultCard(r) {
  const th = A.pending?.risk_thresholds || A.saved?.risk_thresholds;
  const lvl = H.classify(r.summary?.regional_risk?.score, th);
  return `<div class="panel cr-card"><h2>${r.is_test ? "Test result" : "Simulation result"} <span class="sim-tag">SIMULATED</span></h2>
    ${r.is_test ? `<div class="cr-result ok"><h4>✓ Test completed; official result unchanged</h4></div>` : ""}
    <dl class="cr-kv" style="margin-top:10px"><dt>Run ID</dt><dd>${esc(r.run_id)}</dd><dt>Scenario</dt><dd>${esc(r.scenario)}</dd><dt>Target year / scope</dt><dd>${esc(r.target_year)} · ${esc(r.scope)}</dd>
      <dt>Regional risk</dt><dd>${H.LEVEL_LABEL[lvl] || "—"} (score ${r.summary?.regional_risk?.score?.toFixed?.(3)})</dd><dt>Population</dt><dd>${fmtNum(r.summary?.population_current)} → ${fmtNum(r.summary?.population_simulated)}</dd>
      <dt>Affected sources</dt><dd>${(r.impact_by_source || []).map((i) => `${esc(i.name)} (${esc(i.status)}, ${esc(i.change)})`).join("<br>")}</dd>
      <dt>Assumptions</dt><dd class="muted">${esc(JSON.stringify(r.assumptions?.driver || {}))} · model ${esc(r.model_version)}<br>${esc(r.assumptions?.note || "")}</dd><dt>Timestamp</dt><dd>${esc(fmtDateTime(r.timestamp))}</dd></dl>
    <div class="muted small">Scenario output, not an agency forecast.</div>
    <div style="overflow:auto;max-height:260px;margin-top:10px"><table class="cr-table"><thead><tr><th>Municipality</th><th>Population</th><th>Overall risk</th></tr></thead><tbody>${(r.municipalities || []).map((m) => `<tr><td>${esc(m.name)}</td><td>${fmtNum(m.current_population)} → ${fmtNum(m.simulated_population)}</td><td>${H.LEVEL_LABEL[H.classify(m.overall_risk.score, th)]} (${m.overall_risk.score.toFixed(2)})</td></tr>`).join("")}</tbody></table></div></div>`;
}

function tabRisk() {
  const raw = A.pending.risk_thresholds || {};
  const t = H.normalizeThresholds(raw);
  const errs = H.validateThresholds(t);
  const savedT = H.normalizeThresholds(A.saved.risk_thresholds);
  const b = H.bands(t);
  const lvl = H.classify(A.testScore, t), lvlSaved = H.classify(A.testScore, savedT);
  const inp = (k, label) => `<div class="cr-field"><label for="r-${k}">${label} — upper bound</label><input id="r-${k}" data-act="risk-input" data-key="${k}" type="number" step="0.01" min="0" max="1" value="${esc(t[k])}" class="${errs.length ? "invalid" : ""}"></div>`;
  return `
    <div class="panel cr-card"><h2>Risk Settings</h2><div class="cr-sub">Thresholds are stored on the server; the Main Dashboard only displays what these values produce. Score range 0–1.</div>
      <div class="cr-grid2">${inp("low", "LOW")}${inp("medium", "MEDIUM")}${inp("high", "HIGH")}<div class="cr-field"><label>CRITICAL</label><input value="${esc(t.high.toFixed(2))} – 1.00" disabled></div></div>
      ${errs.map((e) => `<div class="err" style="color:#f87171;margin-top:8px">${esc(e)}</div>`).join("")}
      <div style="margin-top:14px">${b.map((x) => `<div class="band-row"><b>${H.LEVEL_LABEL[x.level].toUpperCase()}</b><div class="band-bar" style="background:${H.LEVEL_COLOR[x.level]};width:${Math.max(4, (x.to - x.from) * 100)}%"></div><span class="muted">${x.from.toFixed(2)} – ${x.to.toFixed(2)}</span></div>`).join("")}</div>
      <div class="cr-actions-row"><button class="btn primary" data-act="risk-save" ${errs.length ? "disabled" : ""}><i class="fa-solid fa-floppy-disk"></i> Save Risk Settings</button><button class="btn" data-act="risk-reset" ${isDirty("risk_thresholds") ? "" : "disabled"}>Reset to saved</button></div>
      <div class="muted small" style="margin-top:6px">“Save Risk Settings” stores the values in your draft. The Main Dashboard uses them after Save &amp; Apply.</div></div>
    <div class="panel cr-card"><h2>Check a score</h2><div class="cr-sub">Labels recalculate live with your draft thresholds.</div>
      <div class="cr-grid2"><div class="cr-field"><label for="r-score">Score (0–1)</label><input id="r-score" data-act="risk-score" type="number" step="0.01" min="0" max="1" value="${esc(A.testScore)}"></div>
        <div class="cr-field"><label>Label with draft thresholds</label><div>${lvl ? `<span class="risk-badge ${lvl}">${H.LEVEL_LABEL[lvl]}</span>` : "—"} ${lvl !== lvlSaved ? `<span class="pending-badge">was ${H.LEVEL_LABEL[lvlSaved]} (live)</span>` : ""}</div></div></div></div>`;
}

function tabMap() {
  const layers = LAYERS.map(([k, label]) => {
    const ms = A.mapState?.layers?.[k];
    const feeder = ms?.source;
    const feederOn = feeder ? srcOn(srcs().find((s) => s.id === feeder) || { id: feeder, enabled: true }) : true;
    const unavailable = feeder && !feederOn;
    return toggle(`data-act="toggle-layer" data-key="${k}"`, A.pending.layers?.[k] !== false, esc(label), unavailable ? `Unavailable: ${esc(srcs().find((s) => s.id === feeder)?.name || feeder)} is OFF` : feeder ? `Fed by ${esc(srcs().find((s) => s.id === feeder)?.name || feeder)}` : "", `${isDirty(`layers.${k}`) ? "changed" : ""} ${unavailable ? "unavail" : ""}`);
  }).join("");
  return `
    <div class="panel cr-card"><h2>Map layers</h2><div class="cr-sub">Default layers on the Main Dashboard. Visitors can still toggle their own view.</div><div class="cr-toggle-list">${layers}</div></div>
    <div class="panel cr-card"><h2>Municipality scope</h2><div class="cr-sub">Focus the map and tables on one municipality or all of Dalarna.</div>
      <div class="cr-field" style="max-width:340px"><label for="f-scope">Scope</label>${sel("f-scope", scopeOptions(), A.pending.scope)}</div></div>`;
}

function tabAppearance() {
  return `<div class="panel cr-card"><h2>Appearance</h2><div class="cr-sub">Show or hide dashboard components. Presentation only: data collection and storage are never affected. These switches are the same ones as in Dashboard Control.</div>${componentToggles()}</div>`;
}

function tabUsers() {
  const events = (A.audit || []).filter((e) => String(e.action).startsWith("auth.")).slice(0, 15);
  return `<div class="panel cr-card"><h2>Users &amp; Access</h2><div class="cr-sub">Who can change the dashboard.</div>
    <dl class="cr-kv"><dt>Signed in as</dt><dd><b>${esc(A.me?.user || "—")}</b> · Administrator</dd><dt>Session</dt><dd>Expires after 8 hours; login attempts are rate-limited.</dd>
      <dt>Admin accounts</dt><dd>Configured on the server (ADMIN_USERNAME / ADMIN_PASSWORD in .env). Passwords and API keys are never shown here.</dd>
      <dt>Visitors</dt><dd>Read-only access to the Main Dashboard. Every configuration endpoint requires an administrator.</dd></dl>
    <button class="btn small" data-act="load-audit"><i class="fa-solid fa-rotate"></i> Load recent sign-in activity</button>
    ${A.audit ? `<table class="cr-table" style="margin-top:10px"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Result</th></tr></thead><tbody>${events.map((e) => `<tr><td>${esc(fmtDateTime(e.ts))}</td><td>${esc(e.username)}</td><td>${esc(e.action)}</td><td>${esc(e.result)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No sign-in events recorded.</td></tr>`}</tbody></table>` : ""}</div>`;
}

function tabSystem() {
  const h = A.health;
  return `<div class="panel cr-card"><div class="cr-card-head"><div><h2>System health</h2><div class="cr-sub">API, database, scheduler and sources.</div></div><button class="btn small" data-act="load-system"><i class="fa-solid fa-rotate"></i> Reload</button></div>
      ${h ? `<dl class="cr-kv"><dt>API</dt><dd>${H.statusPill("online", "Online")}</dd><dt>Database</dt><dd>${H.statusPill(h.database?.ok ? "online" : "error", h.database?.ok ? "Online" : "Unreachable")}</dd>
        <dt>Scheduler</dt><dd>${H.statusPill(h.scheduler?.alive ? "online" : "warn", h.scheduler?.alive ? "Running" : h.scheduler?.enabled ? "Not running" : "Disabled")}</dd>
        ${h.orion ? `<dt>Orion-LD</dt><dd>${H.statusPill(h.orion.ok ? "online" : "error", h.orion.ok ? "Online" : "Unreachable")}</dd>` : ""}${h.simulation ? `<dt>Simulation engine</dt><dd>${H.statusPill(h.simulation.ok ? "online" : "error", h.simulation.ok ? "Ready" : "Error")}</dd>` : ""}
        <dt>Checked</dt><dd>${esc(fmtDateTime(h.time))}</dd></dl>` : `<div class="muted">Loading…</div>`}</div>
    <div class="panel cr-card"><div class="cr-card-head"><div><h2>Audit log</h2><div class="cr-sub">Every configuration change: user, time, action, result.</div></div><button class="btn small" data-act="load-audit"><i class="fa-solid fa-rotate"></i> Reload</button></div>
      ${A.audit ? `<div style="overflow:auto;max-height:420px"><table class="cr-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Result</th></tr></thead><tbody>${A.audit.map((e) => `<tr><td>${esc(fmtDateTime(e.ts))}</td><td>${esc(e.username)}</td><td>${esc(e.action)}</td><td>${esc(e.result)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No events yet.</td></tr>`}</tbody></table></div>` : `<div class="muted">Loading…</div>`}</div>`;
}

function renderContent() {
  const el = $("#cr-content");
  if (!el || !A.pending) return;
  const active = document.activeElement;
  const keep = active && el.contains(active) && active.id ? { id: active.id, pos: active.selectionStart } : null;
  const fn = { overview: tabOverview, control: tabControl, sources: tabSources, scenarios: tabScenarios, risk: tabRisk, map: tabMap, appearance: tabAppearance, users: tabUsers, system: tabSystem }[A.tab];
  el.innerHTML = fn();
  if (keep) { const n = document.getElementById(keep.id); if (n) { n.focus(); try { n.setSelectionRange(keep.pos, keep.pos); } catch (_) { /* not a text input */ } } }
}

function render() { renderChrome(); renderContent(); pushPreview(); }

async function openTab(id) {
  A.tab = id;
  history.replaceState(null, "", `#${id}`);
  render();
  if (id === "system") { loadSystem(); }
  if (id === "users" && !A.audit) loadAudit();
  if (id === "scenarios" && !A.scn.draft && A.scenarios[0]) { A.scn.sel = A.scenarios[0].id; A.scn.draft = scnDraftFrom(A.scenarios[0]); renderContent(); }
}

async function loadSystem() {
  A.health = null; renderContent();
  try { A.health = await pull("/api/system/health"); } catch (e) { toast(e.message, "error"); A.health = { database: { ok: false }, scheduler: {}, time: new Date().toISOString() }; }
  await loadAudit(); renderContent();
}
async function loadAudit() {
  try { A.audit = (await pull("/api/system/audit?limit=100")).events || []; } catch (e) { toast(e.message, "error"); A.audit = []; }
  renderContent();
}

// ------------------------------------------------------------------ actions
async function applyChanges() {
  const d = dirty();
  if (!d.length || A.busy.apply) return;
  busy("apply", true);
  try {
    const res = await guarded(() => post("/api/control/apply", { base_version: A.saved.version, state: payload(A.pending), note: "Control Room Save & Apply" }));
    if (res.unchanged) { toast("Nothing to apply: the saved configuration already matches.", "info"); }
    else {
      A.saved = res; A.pending = clone(payload(res)); persistPending();
      await reloadSummary();
      const changed = (res.changed || d).map((p) => `<li>${esc(pathLabel(p))}</li>`).join("");
      openModal(`<h2><i class="fa-solid fa-circle-check text-green"></i> Applied</h2><p>Version <b>v${esc(res.version)}</b> is now live (${esc(fmtDateTime(res.applied_at))}, by ${esc(res.applied_by)}).</p><div class="adv-title">Affected components</div><ul class="diff-list">${changed}</ul><div class="modal-actions"><button class="btn primary" data-close-modal>Close</button></div>`);
      toast(`Applied version ${res.version}.`, "ok");
    }
  } catch (e) {
    if (e.status === 409) {
      openModal(`<h2>Configuration changed elsewhere</h2><p>Someone else saved a newer version (v${esc(e.extra?.current_version ?? "?")}). Your draft was kept.</p><div class="modal-actions"><button class="btn" data-close-modal>Close</button><button class="btn primary" data-act="rebase">Reload live version and keep my changes</button></div>`);
    } else if (e.status === 422) {
      const lines = (e.details || []).map((x) => `<li>${esc(x.field)}: ${esc(x.message)}</li>`).join("");
      openModal(`<h2>Please correct the highlighted value(s).</h2><ul class="diff-list">${lines || `<li>${esc(e.message)}</li>`}</ul><div class="modal-actions"><button class="btn primary" data-close-modal>Close</button></div>`);
    } else if (e.status !== 401) toast(`Could not apply: ${e.message}`, "error");
  } finally { busy("apply", false); render(); }
}

async function rebase() {
  closeModal();
  const mine = H.deepClone(A.pending), oldSaved = payload(A.saved);
  const fresh = await pull("/api/control/state");
  const changedByMe = H.diffPaths(oldSaved, mine);
  A.saved = fresh; A.pending = clone(payload(fresh));
  for (const p of changedByMe) { const v = p.split(".").reduce((o, k) => o?.[k], mine); setPath(p, v); }
  persistPending(); render(); toast("Reloaded the live version; your changes are still in the draft.", "ok");
}

function resetDraft() { A.pending = clone(payload(A.saved)); A.previewResult = null; A.previewView = null; persistPending(); render(); toast("Draft discarded. Preview shows the saved configuration.", "ok"); }

async function cancel() {
  const d = dirty();
  if (!d.length) { openTab("overview"); return; }
  openModal(`<h2>Discard unsaved changes?</h2><p>${d.length} change${d.length > 1 ? "s" : ""} will be discarded. Nothing has been saved.</p><div class="modal-actions"><button class="btn" data-close-modal>Keep editing</button><button class="btn danger" data-act="discard-confirm">Discard and close</button></div>`);
}

async function testSource(id) {
  const name = srcs().find((s) => s.id === id)?.name || id;
  busy("test:" + id, true);
  try {
    const r = await guarded(() => post("/api/control/source/test", { source: id }));
    logAction(r.status === "ok" ? "ok" : "bad", `Test connection: ${name} — ${r.status === "ok" ? "success" : r.status}`, [`Response time: ${r.response_time_ms ?? "—"} ms`, `Records seen: ${r.record_count ?? 0} (nothing was stored)`, r.message, `Tested at ${new Date().toLocaleTimeString("sv-SE")}`]);
    toast(`${name}: ${r.status === "ok" ? "connection OK" : r.message}`, r.status === "ok" ? "ok" : "error");
  } catch (e) { logAction("bad", `Test connection: ${name} — failed`, [e.message]); if (e.status !== 401) toast(e.message, "error"); }
  finally { busy("test:" + id, false); }
}

async function refreshSource(id, { silent = false } = {}) {
  const name = srcs().find((s) => s.id === id)?.name || id;
  busy("refresh:" + id, true);
  try {
    const r = await guarded(() => post("/api/control/source/refresh", { source: id }));
    const ok = ["ok", "fallback"].includes(r.status);
    logAction(ok ? "ok" : "bad", `Refresh: ${name} — ${r.status}`, [`Records received: ${r.records_received}`, `Stored: ${r.records_stored}`, r.message, `Finished ${new Date().toLocaleTimeString("sv-SE")}`]);
    if (!silent) toast(`${name}: ${ok ? `${r.records_received} records received, ${r.records_stored} stored` : r.message || r.status}`, ok ? "ok" : "error");
    await reloadSummary();
  } catch (e) { logAction("bad", `Refresh: ${name} — failed`, [e.message]); if (e.status !== 401) toast(e.message, "error"); }
  finally { busy("refresh:" + id, false); }
}

async function refreshAll() {
  busy("refreshAll", true);
  try {
    const r = await guarded(() => post("/api/control/refresh-all", {}));
    const entries = Object.entries(r.results || {});
    const okN = entries.filter(([, v]) => ["ok", "fallback"].includes(v.status)).length;
    const lines = entries.map(([id, v]) => `${srcs().find((s) => s.id === id)?.name || id}: ${v.status} (${v.records ?? 0} records, ${v.stored ?? 0} stored)`);
    lines.push(`Total: ${okN}/${entries.length} succeeded`);
    logAction(okN === entries.length ? "ok" : "bad", "Refresh All", lines);
    A.quickResult = { kind: okN === entries.length ? "ok" : "bad", title: `Refresh All: ${okN}/${entries.length} succeeded`, lines };
    toast(`Refresh All: ${okN}/${entries.length} sources succeeded.`, okN === entries.length ? "ok" : "error");
    await reloadSummary();
  } catch (e) { if (e.status !== 401) toast(e.message, "error"); }
  finally { busy("refreshAll", false); }
}

function scnBody(d) {
  const excluded = srcs().filter((s) => !d.affected.includes(s.id)).map((s) => s.id);
  return { scenario: d.id || slug(d.name), target_year: Number(d.target_year), scope: d.scope, driver: { ...Object.fromEntries(Object.entries(d.extra || {}).map(([k, v]) => [k, Number(v)])), population_change: Number(d.pop) / 100 }, excluded_sources: excluded };
}
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
function validateScn(d) {
  const e = {};
  if (!d.name || d.name.trim().length < 2) e.name = "Enter a name (at least 2 characters).";
  const p = Number(d.pop);
  if (d.pop === "" || Number.isNaN(p) || p < -20 || p > 30) e.pop = "Enter a value between -20 and 30.";
  A.scn.errors = e;
  return !Object.keys(e).length;
}

async function scnRun(test) {
  const d = A.scn.draft;
  if (!d || !validateScn(d)) { renderContent(); toast("Please correct the highlighted value(s).", "error"); return; }
  const key = test ? "scnTest" : "scnRun";
  busy(key, true);
  try {
    const r = await guarded(() => post(test ? "/api/simulation/test" : "/api/simulation/run", scnBody(d)));
    A.lastResult = r; A.previewResult = r; A.previewView = { mode: "simulation", year: r.target_year };
    toast(test ? "✓ Test completed; official result unchanged" : `Simulation completed successfully. Result ID: ${r.run_id}`, "ok");
    pushPreview();
  } catch (e) { if (e.status !== 401) toast(e.status === 404 ? "Simulation endpoint not available on this server." : e.message, "error"); }
  finally { busy(key, false); }
}

async function scnSave() {
  const d = A.scn.draft;
  if (!d || !validateScn(d)) { renderContent(); toast("Please correct the highlighted value(s).", "error"); return; }
  busy("scnSave", true);
  const body = { id: A.scn.isNew ? slug(d.name) : d.id, name: d.name.trim(), driver_source: d.driver_source, target_year: Number(d.target_year), scope: d.scope, driver: { ...Object.fromEntries(Object.entries(d.extra || {}).map(([k, v]) => [k, Number(v)])), population_change: Number(d.pop) / 100 }, affected_sources: d.affected, description: d.description };
  try {
    await guarded(() => api(A.scn.isNew ? "/api/simulation/scenarios" : `/api/simulation/scenarios/${encodeURIComponent(body.id)}`, { method: A.scn.isNew ? "POST" : "PUT", body }));
    const fresh = await pull("/api/simulation/scenarios"); A.scenarios = fresh.scenarios || [];
    A.scn.sel = body.id; A.scn.isNew = false; A.scn.draft = scnDraftFrom(A.scenarios.find((s) => s.id === body.id) || body);
    toast("Scenario saved.", "ok");
  } catch (e) {
    if (e.status === 404 || e.status === 405) toast("This server does not support saving scenarios yet (missing /api/simulation/scenarios write endpoint).", "error");
    else if (e.status !== 401) toast(e.message, "error");
  } finally { busy("scnSave", false); }
}

async function exportConfig() {
  try {
    const r = await guarded(() => get("/api/control/export-config"));
    H.downloadBlob(`dalarna_config_v${r.config?.version ?? "x"}.json`, new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
    toast("Configuration exported.", "ok");
  } catch (e) { if (e.status !== 401) toast(`Export failed: ${e.message}`, "error"); }
}

async function importConfig(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch (_) { toast("That file is not valid JSON. Nothing was imported.", "error"); return; }
  const cfg = stripMeta(parsed.config ?? parsed);
  try {
    const r = await guarded(() => post("/api/control/import-config/validate", { config: cfg }));
    if (!r.valid) {
      openModal(`<h2>Import rejected</h2><p>The configuration is not valid. Nothing was changed.</p><pre class="diff-list">${esc(r.error || "Unknown validation error")}</pre><div class="modal-actions"><button class="btn primary" data-close-modal>Close</button></div>`);
      return;
    }
    A.importPreview = r.preview_state;
    const rows = (r.changed_keys || []).map((p) => `<li>${esc(pathLabel(p))}</li>`).join("");
    openModal(`<h2>Review imported configuration</h2><p>${r.changes_count ? `${r.changes_count} difference${r.changes_count > 1 ? "s" : ""} from the live configuration:` : "No differences from the live configuration."}</p><ul class="diff-list">${rows}</ul><p class="muted small">“Apply to draft” loads these values into your draft so you can check the Preview. Nothing goes live until Save &amp; Apply.</p><div class="modal-actions"><button class="btn" data-close-modal>Cancel</button><button class="btn primary" data-act="import-apply" ${r.changes_count ? "" : "disabled"}>Apply to draft</button></div>`, { wide: true });
  } catch (e) { if (e.status !== 401) toast(`Import failed: ${e.message}`, "error"); }
}

function sourceForm(src) {
  const isNew = !src;
  const v = src || { id: "", name: "", category: "", description: "", interval_seconds: 900, freshness_seconds: 7200, map_layer: null };
  return `<h2>${isNew ? "Add data source" : `Configure ${esc(src.name)}`}</h2><div class="muted small">API keys and secrets are never entered here: only the <b>names</b> of server environment variables are stored.</div>
    <form id="src-form" class="form-grid" novalidate>
      <div class="field"><label for="sf-name">Name</label><input id="sf-name" value="${esc(v.name)}" ${isNew ? "" : "readonly"}><div class="hint err" data-err="name"></div></div>
      <div class="field"><label for="sf-id">ID (lower-case)</label><input id="sf-id" value="${esc(v.id)}" ${isNew ? "" : "readonly"} placeholder="e.g. energimyndigheten"><div class="hint err" data-err="id"></div></div>
      <div class="field"><label for="sf-cat">Category</label><input id="sf-cat" value="${esc(v.category)}" ${isNew ? "" : "readonly"} placeholder="e.g. Energy"><div class="hint err" data-err="category"></div></div>
      <div class="field"><label for="sf-url">API / base URL</label><input id="sf-url" value="${esc(v.base_url || "")}" ${isNew ? "" : "readonly"} placeholder="https://…"><div class="hint err" data-err="url"></div></div>
      <div class="field"><label for="sf-auth">Auth type</label><select id="sf-auth" ${isNew ? "" : "disabled"}><option value="none">None</option><option value="api_key">API key</option><option value="oauth_client_credentials">OAuth client credentials</option></select></div>
      <div class="field"><label for="sf-env">Secret env-var names (comma separated)</label><input id="sf-env" ${isNew ? "" : "disabled"} placeholder="MY_SOURCE_API_KEY"><div class="hint">Set the value in the server .env file.</div></div>
      <div class="field"><label for="sf-int">Update interval</label>${sel("sf-int", intervalOptions(A.pending.source_intervals?.[v.id] ?? v.interval_seconds), A.pending.source_intervals?.[v.id] ?? v.interval_seconds)}<div class="hint">Takes effect after Save &amp; Apply.</div></div>
      <div class="field"><label for="sf-fresh">Stale after (minutes)</label><input id="sf-fresh" type="number" min="1" value="${Math.round(v.freshness_seconds / 60)}" ${isNew ? "" : "disabled"}></div>
      <div class="field"><label for="sf-layer">Map layer</label>${sel("sf-layer", [["", "None"], ...LAYERS.filter(([k]) => !["boundaries", "simulation_risk"].includes(k)).map(([k, l]) => [k, l])], v.map_layer || "", isNew ? "" : "disabled")}</div>
      <div class="field"><label for="sf-desc">Description / data to ingest</label><input id="sf-desc" value="${esc(v.description || "")}" ${isNew ? "" : "readonly"}></div>
      <div class="field full"><div class="muted small">Storage policy: records are appended and kept; switching a source off never deletes stored history.</div></div>
    </form>
    <div class="modal-actions">${isNew ? "" : `<button class="btn" data-act="form-test" data-id="${esc(v.id)}"><i class="fa-solid fa-plug"></i> Test Connection</button><button class="btn" data-act="form-refresh" data-id="${esc(v.id)}"><i class="fa-solid fa-rotate"></i> Refresh Now</button>`}<button class="btn" data-close-modal>Cancel</button><button class="btn primary" data-act="${isNew ? "register-source" : "form-save"}" ${isNew ? "" : `data-id="${esc(v.id)}"`}>${isNew ? "Register source" : "Save"}</button></div>`;
}

async function registerSource() {
  const g = (id) => document.getElementById(id)?.value?.trim() ?? "";
  const errs = {};
  const id = g("sf-id").toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(id)) errs.id = "Use 2–64 lower-case letters, digits, - or _.";
  else if (srcs().some((s) => s.id === id)) errs.id = "A source with this ID already exists.";
  if (g("sf-name").length < 2) errs.name = "Enter a name.";
  if (g("sf-cat").length < 2) errs.category = "Enter a category.";
  if (g("sf-url") && !/^https?:\/\/\S+$/i.test(g("sf-url"))) errs.url = "Enter a full http(s) URL.";
  document.querySelectorAll("#src-form [data-err]").forEach((n) => (n.textContent = errs[n.dataset.err] || ""));
  if (Object.keys(errs).length) { toast("Please correct the highlighted value(s).", "error"); return; }
  const body = { id, name: g("sf-name"), category: g("sf-cat"), description: g("sf-desc"), base_url: g("sf-url") || null, auth_type: g("sf-auth"), auth_env_vars: g("sf-env").split(",").map((x) => x.trim()).filter(Boolean), interval_seconds: Number(g("sf-int")), freshness_seconds: Math.max(60, Number(g("sf-fresh")) * 60), map_layer: g("sf-layer") || null };
  try {
    await guarded(() => post("/api/control/source/register", body));
    closeModal();
    const mine = clone(A.pending), oldSaved = payload(A.saved);
    const [fresh] = await Promise.all([pull("/api/control/state"), reloadSummary()]);
    const changedByMe = H.diffPaths(oldSaved, mine);
    A.saved = fresh; A.pending = clone(payload(fresh));
    for (const p of changedByMe) setPath(p, p.split(".").reduce((o, k) => o?.[k], mine));
    persistPending(); render();
    toast(`Source “${body.name}” registered. It now appears everywhere without code changes.`, "ok");
  } catch (e) { if (e.status !== 401) toast(e.status === 422 ? "Please correct the highlighted value(s)." : e.message, "error"); }
}

function sourceMore(id, anchor) {
  const s = srcs().find((x) => x.id === id);
  if (!s) return;
  openPopover(anchor, `<div class="pop-title">${esc(s.name)}</div><button class="pop-link" data-act="src-meta" data-id="${esc(id)}">View metadata</button><button class="pop-link" data-act="src-log" data-id="${esc(id)}">View last run details</button><button class="pop-link" data-act="copy-id" data-id="${esc(id)}">Copy source ID</button>`);
}

// ------------------------------------------------------------------ events
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || t.tagName === "INPUT" || t.tagName === "SELECT") return;
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case "tab": openTab(t.dataset.tab); break;
    case "set-mode": A.pending.mode = t.dataset.mode; A.previewView = null; touch(); break;
    case "refresh-preview": { A.previewReady = false; const f = $("#preview-frame"); f.src = f.src; toast("Preview reloaded from your draft.", "ok", 1800); break; }
    case "reset": resetDraft(); break;
    case "cancel": cancel(); break;
    case "discard-confirm": closeModal(); resetDraft(); openTab("overview"); break;
    case "apply": applyChanges(); break;
    case "rebase": rebase(); break;
    case "show-diff": openPopover(t, `<div class="pop-title">Unsaved changes</div><ul class="diff-list">${dirty().map((p) => `<li>${esc(pathLabel(p))}</li>`).join("")}</ul>`); break;
    case "logout": await post("/api/auth/logout", {}).catch(() => null); location.href = LOGIN_URL; break;
    case "reload-summary": await reloadSummary(); render(); toast("Reloaded.", "ok", 1500); break;
    case "src-test": testSource(id); break;
    case "src-refresh": refreshSource(id); break;
    case "refresh-all": refreshAll(); break;
    case "add-source": openModal(sourceForm(null), { wide: true }); break;
    case "register-source": registerSource(); break;
    case "src-config": openModal(sourceForm(srcs().find((s) => s.id === id)), { wide: true }); break;
    case "form-test": testSource(id); break;
    case "form-refresh": refreshSource(id); break;
    case "form-save": {
      const v = Number(document.getElementById("sf-int").value);
      setPath(`source_intervals.${id}`, v); closeModal(); touch(); toast("Interval staged. It applies after Save & Apply.", "ok"); break;
    }
    case "src-more": sourceMore(id, t); break;
    case "src-meta": { closePopover(); const s = srcs().find((x) => x.id === id); openModal(`<h2>${esc(s.name)} metadata</h2><dl class="cr-kv"><dt>ID</dt><dd>${esc(s.id)}</dd><dt>Category</dt><dd>${esc(s.category)}</dd><dt>Description</dt><dd>${esc(s.description)}</dd><dt>Update interval</dt><dd>${esc(fmtInterval(s.interval_seconds))}</dd><dt>Stale after</dt><dd>${esc(fmtInterval(s.freshness_seconds))}</dd><dt>Map layer</dt><dd>${esc(s.map_layer || "none")}</dd><dt>Missing config</dt><dd>${esc((s.missing_config || []).join(", ") || "none")}</dd></dl><div class="modal-actions"><button class="btn primary" data-close-modal>Close</button></div>`); break; }
    case "src-log": { closePopover(); const s = srcs().find((x) => x.id === id); openModal(`<h2>${esc(s.name)} last run</h2><dl class="cr-kv"><dt>Status</dt><dd>${H.statusPill(s.status, s.status_label)}</dd><dt>Message</dt><dd>${esc(s.message)}</dd><dt>Last attempt</dt><dd>${esc(fmtDateTime(s.last_attempt_at))}</dd><dt>Last success</dt><dd>${esc(fmtDateTime(s.last_success_at))}</dd><dt>Last error</dt><dd>${esc(s.last_error || "none")}</dd><dt>Data origin</dt><dd>${esc(s.data_origin || "—")}</dd></dl><div class="modal-actions"><button class="btn primary" data-close-modal>Close</button></div>`); break; }
    case "copy-id": closePopover(); navigator.clipboard?.writeText(id).then(() => toast("Source ID copied.", "ok", 1500)).catch(() => toast(`ID: ${id}`, "info")); break;
    case "scn-select": A.scn = { sel: id, draft: scnDraftFrom(A.scenarios.find((s) => s.id === id)), isNew: false, errors: {} }; renderContent(); break;
    case "scn-new": A.scn = { sel: null, isNew: true, errors: {}, draft: { id: "", name: "", driver_source: srcs().find((s) => /population|statistic/i.test(s.category))?.name || srcs()[0]?.name || "", target_year: 2030, scope: "dalarna", pop: 10, extra: {}, affected: srcs().map((s) => s.id), description: "" } }; renderContent(); break;
    case "scn-save": scnSave(); break;
    case "scn-test": scnRun(true); break;
    case "scn-run": openModal(`<h2>Run official simulation?</h2><p>This replaces the latest official result that Main Dashboard visitors see. Use “Run Test” to try values safely.</p><div class="modal-actions"><button class="btn" data-close-modal>Cancel</button><button class="btn primary" data-act="scn-run-confirm">Run simulation</button></div>`); break;
    case "scn-run-confirm": closeModal(); scnRun(false); break;
    case "scn-view": {
      try { const r = A.lastResult || (await pull("/api/simulation/result/latest")); if (!r) { toast("No result yet. Run a test or a simulation first.", "info"); break; } A.lastResult = r; A.previewResult = r; A.previewView = { mode: "simulation", year: r.target_year }; render(); toast("Result shown in the Preview.", "ok", 1800); } catch (er) { toast(er.message, "error"); }
      break;
    }
    case "test-sim": {
      const sc = A.scenarios.find((s) => s.id === A.pending.active_scenario) || A.scenarios[0];
      if (!sc) { toast("No scenario available to test.", "error"); break; }
      busy("testSim", true);
      try {
        const d = scnDraftFrom(sc); d.target_year = A.pending.simulation_year || d.target_year; d.scope = A.pending.scope || d.scope;
        const r = await guarded(() => post("/api/simulation/test", scnBody(d)));
        A.lastResult = r; A.previewResult = r; A.previewView = { mode: "simulation", year: r.target_year };
        A.quickResult = { kind: "ok", title: "✓ Test completed; official result unchanged", lines: [`Run ${r.run_id} · ${sc.name} · ${r.target_year} · regional risk ${r.summary?.regional_risk?.score?.toFixed?.(2)}`] };
        toast("✓ Test completed; official result unchanged", "ok");
      } catch (er) { A.quickResult = { kind: "bad", title: "Test simulation failed", lines: [er.message] }; if (er.status !== 401) toast(er.message, "error"); }
      finally { busy("testSim", false); pushPreview(); }
      break;
    }
    case "export-config": exportConfig(); break;
    case "import-config": $("#import-file")?.click(); break;
    case "import-apply": A.pending = clone(payload(A.importPreview)); closeModal(); touch(); toast("Imported values loaded into your draft. Review the Preview, then Save & Apply.", "ok"); break;
    case "risk-save": toast("Saved to your draft. Click Save & Apply to publish to the Main Dashboard.", "ok"); break;
    case "risk-reset": A.pending.risk_thresholds = clone(A.saved.risk_thresholds); touch(); break;
    case "load-audit": loadAudit(); break;
    case "load-system": loadSystem(); break;
    default: break;
  }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "import-file" && t.files?.[0]) { importConfig(t.files[0]); t.value = ""; return; }
  const act = t.dataset?.act;
  if (act === "toggle-source") { setPath(`sources.${t.dataset.id}`, t.checked); touch(); }
  else if (act === "interval") { setPath(`source_intervals.${t.dataset.id}`, Number(t.value)); touch(); }
  else if (act === "toggle-comp") { setPath(`components.${t.dataset.key}`, t.checked); touch(); }
  else if (act === "toggle-layer") { setPath(`layers.${t.dataset.key}`, t.checked); touch(); }
  else if (act === "scn-affected") { const d = A.scn.draft; d.affected = t.checked ? [...new Set([...d.affected, t.dataset.id])] : d.affected.filter((x) => x !== t.dataset.id); }
  else if (t.id === "f-mode") { A.pending.mode = t.value; A.previewView = null; touch(); }
  else if (t.id === "f-scenario") { A.pending.active_scenario = t.value || null; touch(); }
  else if (t.id === "f-year") { A.pending.simulation_year = Number(t.value); touch(); }
  else if (t.id === "f-scope") { A.pending.scope = t.value; touch(); }
  else if (t.id === "s-driver") A.scn.draft.driver_source = t.value;
  else if (t.id === "s-year") A.scn.draft.target_year = Number(t.value);
  else if (t.id === "s-scope") A.scn.draft.scope = t.value;
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset?.act === "risk-input") {
    const cur = H.normalizeThresholds(A.pending.risk_thresholds);
    cur[t.dataset.key] = t.value === "" ? NaN : Number(t.value);
    const saved = A.saved.risk_thresholds || {};
    // keep the saved key layout (upper-bound or lower-bound) so the backend accepts it
    A.pending.risk_thresholds = saved.low === 0 && typeof saved.critical === "number" && saved.critical < 1
      ? { low: 0, medium: cur.low, high: cur.medium, critical: cur.high }
      : { ...saved, low: cur.low, medium: cur.medium, high: cur.high };
    touch();
  } else if (t.dataset?.act === "risk-score") { A.testScore = Number(t.value); renderContent(); }
  else if (t.id === "s-name") { A.scn.draft.name = t.value; delete A.scn.errors.name; }
  else if (t.id === "s-pop") { A.scn.draft.pop = t.value === "" ? "" : Number(t.value); delete A.scn.errors.pop; }
  else if (t.dataset?.extra) A.scn.draft.extra[t.dataset.extra] = t.value === "" ? "" : Number(t.value);
});

window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (h !== A.tab && TABS.some(([id]) => id === h) && A.pending) openTab(h); });
window.addEventListener("beforeunload", (e) => { if (dirty().length) { e.preventDefault(); e.returnValue = ""; } });

(function boot() {
  const h = location.hash.replace("#", "");
  if (TABS.some(([id]) => id === h)) A.tab = h;
  renderChrome();
  loadAll().then(() => { if (A.tab === "system") loadSystem(); if (A.tab === "scenarios" && A.scenarios[0] && !A.scn.draft) { A.scn.sel = A.scenarios[0].id; A.scn.draft = scnDraftFrom(A.scenarios[0]); renderContent(); } });
})();
