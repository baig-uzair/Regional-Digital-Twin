// Main Dashboard (stakeholder view). Every number comes from the backend; nothing is hard-coded
// except presentation (labels, icons, colours). Spec B: header, nav, source cards, map,
// ONE Simulation Control, ONE Simulation Results area, municipality results, exports, UI states.
import { get, post } from "./api.js";
import { DalarnaMap } from "./dtmap.js";
import { esc, fmtNum, fmtDateTime, relTime, toast, openDrawer, closeDrawer, openPopover, closePopover } from "./util.js";
import * as H from "./shared.js";

const PREVIEW = new URLSearchParams(location.search).get("preview") === "1";
const ROUTES = ["overview", "map", "simulation", "municipalities", "data-sources", "insights", "reports", "settings"];
const YEARS = [2026, 2030, 2035, 2040];
const POP_MIN = -20;
const POP_MAX = 30;
const LAYER_IDS = ["boundaries", "population", "weather", "roads", "water", "forest", "land", "simulation_risk"];
const LAYER_LABEL = { boundaries: "Municipality boundaries", population: "Population", weather: "Weather (SMHI)", roads: "Roads (Trafikverket)", water: "Water / Geology (SGU)", forest: "Forest (Skogsstyrelsen)", land: "Land parcels (Lantmäteriet)", simulation_risk: "Simulation risk" };
const LAYER_COLOR = { weather: "#facc15", roads: "#60a5fa", water: "#22d3ee", forest: "#4ade80", land: "#2dd4bf" };
// Which source drives which risk category in the model (used to show traceable contributors).
const CAT_SOURCES = { overall_risk: ["scb", "trafikverket", "sgu", "skogsstyrelsen", "lantmateriet"], food_risk: ["scb"], snow_flood_risk: ["sgu"], infrastructure_risk: ["trafikverket"], environment_risk: ["skogsstyrelsen"] };
const SOURCE_COEFF = { scb: "driver", trafikverket: "traffic_demand", lantmateriet: "land_development", skogsstyrelsen: "forest_reduction", sgu: "water_exposure", smhi: "weather_effect" };

const S = {
  control: null, saved: null, pending: null, summary: null, munis: null, mapState: null,
  scenarios: [], riskCfg: null, result: null, resultSig: null, me: null,
  errors: {}, loaded: false, running: false,
  view: { mode: "simulation", year: 2030 },
  form: { scenario: "", year: 2030, pop: 10, drivers: {}, scope: "dalarna", excluded: [] },
  invalid: {}, advancedOpen: false,
  filter: { search: "", level: "all" },
  riskView: "overall_risk",
  layers: {}, overlayCache: {}, map: null, mapEl: null,
  prefs: H.storeGet("local", "dt_prefs", {}) || {},
};

if (new URLSearchParams(location.search).has("e2e")) window.__dt = S; // test hook: lets browser tests inspect state

const $ = (s) => document.querySelector(s);
const route = () => {
  const r = (location.hash.replace(/^#\/?/, "") || "overview").split("?")[0];
  return PREVIEW ? "overview" : ROUTES.includes(r) ? r : "overview";
};

// ------------------------------------------------------------------ state helpers
const ctl = () => S.pending || S.control || {};
const enabledFlag = (v) => (v && typeof v === "object" ? v.enabled : v);
const comp = (name) => ctl().components?.[name] !== false;
const thresholds = () => ctl().risk_thresholds || S.riskCfg?.thresholds || null;
const scopeName = (scope) => (!scope || scope === "dalarna" ? "Dalarna" : S.munis?.municipalities?.find((m) => m.code === scope)?.name || scope);
const isSim = () => S.view.mode === "simulation";
const srcList = () => S.summary?.sources || [];
const srcById = (id) => srcList().find((s) => s.id === id);
const lvlOf = (entry) => (entry ? H.classify(entry.score, thresholds()) || H.lc(entry.level) : null);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stripMeta = (s) => { const { version, applied_at, applied_by, changed, unchanged, ...rest } = s || {}; return rest; };

function sigOfForm(f) {
  return JSON.stringify({ s: f.scenario, y: f.year, sc: f.scope, p: Math.round(Number(f.pop) * 100) / 100, d: f.drivers, x: [...f.excluded].sort() });
}
function sigOfResult(r) {
  const excluded = (r.impact_by_source || []).filter((i) => i.status === "excluded").map((i) => i.id).sort();
  const { population_change, ...rest } = r.assumptions?.driver || {};
  return JSON.stringify({ s: r.scenario, y: r.target_year, sc: r.scope, p: Math.round((population_change ?? 0) * 10000) / 100, d: rest, x: excluded });
}
const isPending = () => !!S.result && sigOfForm(S.form) !== S.resultSig;

function syncFormFromResult(r) {
  const { population_change, ...rest } = r.assumptions?.driver || {};
  S.form = {
    scenario: r.scenario, year: r.target_year, scope: r.scope || "dalarna",
    pop: Math.round((population_change ?? 0) * 10000) / 100, drivers: rest,
    excluded: (r.impact_by_source || []).filter((i) => i.status === "excluded").map((i) => i.id),
  };
  S.resultSig = sigOfResult(r);
}

function applyScenarioDefaults(id) {
  const sc = S.scenarios.find((s) => s.id === id);
  if (!sc) return;
  const { population_change, ...rest } = sc.driver || {};
  S.form.scenario = id;
  if (sc.target_year) S.form.year = sc.target_year;
  S.form.pop = population_change != null ? Math.round(population_change * 10000) / 100 : 0;
  S.form.drivers = rest;
  if (sc.scope) S.form.scope = sc.scope;
}

function initView() {
  if (PREVIEW) {
    S.view = { mode: ctl().mode || "live", year: ctl().simulation_year || S.form.year };
    return;
  }
  const stored = H.storeGet("session", "dt_view");
  if (stored) { S.view = stored; return; }
  S.view = { mode: S.prefs.defaultMode || ctl().mode || "live", year: ctl().simulation_year || S.form.year || 2030 };
}

// ------------------------------------------------------------------ data loading
async function pull(key, path, assign, message) {
  try {
    assign(await get(path));
    delete S.errors[key];
  } catch (e) {
    if (!S.errors[key]) toast(message || e.message, "error");
    S.errors[key] = e.message; // previous valid data stays in S
  }
}

async function loadAll({ quiet = false } = {}) {
  await Promise.all([
    PREVIEW ? null : pull("control", "/api/control/state", (d) => (S.control = d)),
    pull("summary", "/api/datasources/summary", (d) => (S.summary = d), "Unable to retrieve this source. Showing last available data."),
    pull("munis", "/api/municipalities", (d) => (S.munis = d)),
    pull("mapState", "/api/control/map-state", (d) => (S.mapState = d)),
    pull("risk", "/api/risk/config", (d) => (S.riskCfg = d)),
    pull("scenarios", "/api/simulation/scenarios", (d) => (S.scenarios = d.scenarios || [])),
    pull("result", "/api/simulation/result/latest", (d) => { if (d && !S.running && (!S.result || S.result.run_id !== d.run_id) && !isPending()) { S.result = d; syncFormFromResult(d); } }),
    S.me ? null : get("/api/auth/me").then((d) => (S.me = d)).catch(() => null),
  ]);
  if (!S.loaded) {
    if (S.result) syncFormFromResult(S.result);
    else if (S.scenarios[0]) applyScenarioDefaults(S.scenarios[0].id);
    initView();
    S.layers = { ...H.deepClone(ctl().layers || {}) };
  }
  S.loaded = true;
  if (!quiet) render();
}

// ------------------------------------------------------------------ small renderers
const levelBadge = (level, text) => (level ? `<span class="risk-badge ${level}">${esc(text || H.LEVEL_LABEL[level])}</span>` : `<span class="risk-badge none">—</span>`);
const levelButton = (level, attrs, text) => `<button class="risk-badge ${level || "none"} clickable" ${attrs} title="Show score and contributors">${esc(text || H.LEVEL_LABEL[level] || "—")}</button>`;
const simTag = `<span class="sim-tag" title="Model-based scenario, not a measurement or an agency forecast">SIMULATED</span>`;

function headlineOf(s) {
  const h = s.headline;
  if (!h) return { value: "—", sub: s.message || "No data yet" };
  if (h.temperature_c != null) return { value: `${h.temperature_c} °C`, sub: `Observed ${relTime(h.observed_at)}` };
  if (h.population_total != null) return { value: fmtNum(h.population_total), sub: `${h.municipalities} municipalities · ${h.period || "—"}${h.origin === "fallback" ? " · fallback" : ""}` };
  if (h.stations != null) return { value: `${fmtNum(h.stations)} stations`, sub: `Fetched ${relTime(h.latest_fetch)}` };
  if (h.records != null) return { value: `${fmtNum(h.records)} records`, sub: `Fetched ${relTime(h.latest_fetch)}` };
  return { value: "—", sub: s.message || "" };
}

function cardState(s) {
  const pend = S.pending ? enabledFlag(S.pending.sources?.[s.id]) : undefined;
  const saved = S.saved ? enabledFlag(S.saved.sources?.[s.id]) : s.enabled;
  if (PREVIEW && pend === false && saved !== false) return { cls: "pending-off", pill: `<span class="status-pill warn">Pending OFF</span>`, off: true };
  if (PREVIEW && pend === true && saved === false) return { cls: "pending-on", pill: `<span class="status-pill warn">Pending ON</span>`, off: false };
  if (s.status === "disabled" || pend === false) return { cls: "disabled", pill: `<span class="status-pill disabled">Disabled</span>`, off: true };
  return { cls: s.status, pill: H.statusPill(s.status, s.status_label), off: false };
}

function renderKpiCards() {
  if (!comp("source_cards")) return "";
  const cards = srcList().filter((s) => {
    const isExplicitlyOff = ctl()?.sources?.[s.id] === false;
    const isSavedOff = S.control?.sources?.[s.id] === false;
    return !isExplicitlyOff && !isSavedOff && s.enabled !== false && s.status !== "disabled";
  }).map((s) => {
    const v = H.sourceVisual(s);
    const st = cardState(s);
    const h = headlineOf(s);
    return `
      <div class="kpi-card ${st.cls}" role="button" tabindex="0" data-act="open-source" data-id="${esc(s.id)}" title="Open ${esc(s.name)} details">
        <div class="kpi-top">
          <div class="kpi-title-box"><i class="fa-solid ${v.icon} kpi-icon ${v.color}"></i>
            <div class="kpi-name-col"><span class="kpi-name">${esc(s.name)}</span><span class="kpi-category">${esc(s.category)}</span></div></div>
          ${st.pill}
        </div>
        <div class="kpi-value">${esc(h.value)}</div>
        <div class="kpi-sub">${esc(h.sub)}</div>
        <div class="kpi-foot">Last update: ${esc(s.last_success_at ? relTime(s.last_success_at) : "never")}</div>
      </div>`;
  });
  if (!cards.length) return `<section class="kpi-row"><div class="panel empty-state">${S.errors.summary ? "Unable to retrieve this source. Showing last available data." : "No active data sources enabled."}</div></section>`;
  return `<section class="kpi-row" aria-label="Data sources">${cards.join("")}</section>`;
}

// ------------------------------------------------------------------ header + banner
function renderHeader() {
  const el = $("#header");
  if (!el) return;
  const sum = S.summary;
  const total = sum?.total ?? 0, online = sum?.online_count ?? 0;
  const health = !sum ? "unknown" : online === total && total > 0 ? "ok" : online === 0 ? "bad" : "warn";
  const healthTitle = { ok: "System Online", bad: "System Offline", unknown: "Connecting…", warn: "System Degraded" }[health];
  const dataYear = S.munis?.data_year;
  el.innerHTML = `
    <div class="hdr-brand"><h1>DALARNA REGIONAL DIGITAL TWIN</h1>
      <div class="hdr-subtitle">Real-time data · Multi-source simulation · Cross-sector impact · Decision support</div></div>
    <div class="hdr-right">
      <button class="hdr-chip system-chip ${health}" data-act="sys-health" title="Show system health"><span class="dot-live ${health}"></span>
        <div class="chip-text"><b>${healthTitle}</b><span>${sum ? `${online}/${total} data sources` : "—"}</span></div></button>
      <button class="hdr-chip" data-act="last-update" title="Show last update per source"><i class="fa-regular fa-clock text-blue"></i>
        <div class="chip-text"><span class="chip-label">Last update</span><b>${esc(fmtDateTime(sum?.last_update))}</b></div></button>
      <button class="hdr-chip location-chip" data-act="scope-info" title="Scope information"><i class="fa-solid fa-location-dot"></i><span>${esc(scopeName(S.form.scope))}, Sweden</span></button>
      <div class="seg-mode" role="group" aria-label="Mode selection">
        <button class="seg-btn ${!isSim() ? "active" : ""}" data-act="mode" data-mode="live" ${PREVIEW ? "disabled" : ""}>Current${dataYear ? ` (${dataYear})` : ""}</button>
        <button class="seg-btn ${isSim() ? "active" : ""}" data-act="mode" data-mode="simulation" ${PREVIEW ? "disabled" : ""}>Simulation (${S.view.year})</button>
      </div>
      <button class="hdr-icon" data-act="user-menu" title="Account" aria-label="Account menu"><i class="fa-regular fa-user"></i></button>
    </div>`;
}

function renderBanner() {
  const el = $("#banner");
  if (!el) return;
  const parts = [];
  if (PREVIEW) {
    const n = S.pending && S.saved ? H.diffPaths(stripMeta(S.saved), stripMeta(S.pending)).length : 0;
    parts.push(`<div class="banner preview"><b>PREVIEW</b> · ${n ? `${n} unsaved change${n > 1 ? "s" : ""} (not live until Save &amp; Apply)` : "matches the saved configuration"}${S.saved?.version ? ` · saved v${esc(S.saved.version)}` : ""}</div>`);
  }
  if (isSim()) {
    const sc = S.scenarios.find((x) => x.id === S.form.scenario)?.name || S.form.scenario || "scenario";
    parts.push(`<div class="banner sim"><b>SIMULATION MODE</b> · ${esc(sc)} · target year ${esc(S.view.year)} · ${esc(scopeName(S.form.scope))} <span class="banner-note">Scenario results are model-based what-if estimates, not agency forecasts.</span></div>`);
  } else {
    parts.push(`<div class="banner live"><b>LIVE</b> · measured data from connected sources. No simulated values are shown.</div>`);
  }
  const stale = srcList().filter((s) => ["stale", "error"].includes(s.status));
  if (stale.length) {
    const msgs = stale.map((s) => (s.status === "error" ? `${esc(s.name)}: Unable to retrieve this source. Showing last available data.` : `${esc(s.name)}: Data may be outdated. Last update: ${esc(fmtDateTime(s.last_success_at))}`));
    parts.push(`<div class="banner warn">${msgs.join("<br>")} <button class="btn small" data-act="refresh">Refresh</button></div>`);
  }
  el.innerHTML = parts.join("");
}

// ------------------------------------------------------------------ map panel
function mapColors() {
  if (isSim() && S.result && !isPending() && S.layers.simulation_risk !== false && comp("map")) {
    const out = {};
    for (const m of S.result.municipalities || []) {
      const lvl = lvlOf(m[S.riskView]);
      if (lvl) out[m.code] = H.LEVEL_COLOR[lvl];
    }
    return out;
  }
  if (S.layers.population !== false && S.munis) {
    const vals = S.munis.municipalities.filter((m) => m.population).map((m) => m.population.value);
    if (!vals.length) return {};
    const max = Math.max(...vals), min = Math.min(...vals);
    const ramp = ["#1e3a5f", "#1d4f8f", "#2563eb", "#3b82f6", "#60a5fa"];
    const out = {};
    for (const m of S.munis.municipalities) {
      if (!m.population) continue;
      const t = max === min ? 0.5 : (m.population.value - min) / (max - min);
      out[m.code] = ramp[Math.min(ramp.length - 1, Math.floor(Math.sqrt(t) * ramp.length))];
    }
    return out;
  }
  return {};
}

function mapTitle() {
  const cat = H.RISK_CATS.find((c) => c.key === S.riskView)?.label || "Risk";
  if (!isSim()) return `${scopeName(S.form.scope)} – Population (${S.munis?.data_year || "latest"})`;
  if (!S.result) return `${scopeName(S.form.scope)} – ${cat} (no simulation yet)`;
  if (isPending()) return `${scopeName(S.form.scope)} – ${cat} (pending – run simulation)`;
  return `${scopeName(S.form.scope)} – ${cat} (Simulated ${S.result.target_year})`;
}

function layerAvail(l) {
  if (l === "boundaries" || l === "population") return { ok: true };
  if (l === "simulation_risk") return { ok: isSim(), reason: isSim() ? null : "Only available in simulation mode" };
  const ms = S.mapState?.layers?.[l];
  let ok = !!ms?.available, reason = ms?.reason || (ms ? null : "Layer state unavailable");
  const feeder = ms?.source;
  if (feeder && S.pending) {
    const en = enabledFlag(S.pending.sources?.[feeder]);
    if (en === false) { ok = false; reason = "Source is turned off (pending)"; }
    else if (en === true && reason === "Source is turned off") { ok = true; reason = null; }
  }
  return { ok, reason };
}

function mapPanelHtml(big = false) {
  const riskMode = isSim();
  const levelsLegend = H.bands(thresholds()).map((b) => `<div class="legend-item"><span class="legend-dot" style="background:${H.LEVEL_COLOR[b.level]}"></span> ${H.LEVEL_LABEL[b.level]} <span class="legend-range">${b.from.toFixed(2)}–${b.to.toFixed(2)}</span></div>`).join("");
  return `
    <div class="panel map-card ${big ? "big" : ""}">
      <div class="card-head"><div class="card-title" id="map-title">${esc(mapTitle())}</div>
        ${riskMode ? `<select class="select-pill" id="map-risk-select" aria-label="Risk category">${H.RISK_CATS.map((c) => `<option value="${c.key}" ${S.riskView === c.key ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>` : `<span class="muted small">Population by municipality</span>`}</div>
      <div class="map-container-wrap" id="map-slot" style="${big ? "height:72vh" : ""}">
        <div class="map-tools-topleft">
          <button class="map-tool-btn" data-act="zoom-in" title="Zoom in" aria-label="Zoom in"><i class="fa-solid fa-plus"></i></button>
          <button class="map-tool-btn" data-act="zoom-out" title="Zoom out" aria-label="Zoom out"><i class="fa-solid fa-minus"></i></button>
          <button class="map-tool-btn" data-act="layers-menu" title="Layers" aria-label="Map layers"><i class="fa-solid fa-layer-group"></i></button>
        </div>
        <div class="map-risk-legend" aria-label="Risk legend (read-only)">
          <div class="legend-title">${riskMode ? "Risk level" : "Population"}</div>
          ${riskMode ? levelsLegend : `<div class="legend-item"><span class="legend-dot" style="background:#1e3a5f"></span> Fewer</div><div class="legend-item"><span class="legend-dot" style="background:#60a5fa"></span> More</div>`}
        </div>
        <div class="map-scale-bar" id="map-scale" aria-label="Scale (read-only)"><div class="scale-line" style="width:60px"></div><span>—</span></div>
        <div class="map-note" id="map-note"></div>
        <div id="map-host"></div>
      </div>
    </div>`;
}

function mountMap() {
  const slot = $("#map-slot");
  if (!slot) return;
  if (!comp("map")) { slot.innerHTML = `<div class="empty-state">Map is hidden by the administrator.</div>`; return; }
  if (!S.map) {
    const host = document.createElement("div");
    host.id = "map-host";
    S.mapEl = host;
    try {
      S.map = new DalarnaMap(host, {
        onMunicipalityClick: quickDetail,
        onMove: (info) => {
          const el = $("#map-scale");
          if (el && info) el.innerHTML = `<div class="scale-line" style="width:${info.widthPx}px"></div><span>${esc(info.label)}</span>`;
        },
      });
      S.map.ready.catch((e) => { const n = $("#map-note"); if (n) n.textContent = `Map could not be loaded: ${e.message}`; });
    } catch (e) {
      const n = $("#map-note"); if (n) n.textContent = `Map could not be loaded: ${e.message}`;
      return;
    }
  }
  slot.querySelector("#map-host")?.replaceWith(S.mapEl);
  S.map.ready.then(() => { S.map.resize(); refreshMap(); }).catch(() => {});
}

async function refreshMap() {
  if (!S.map || !comp("map")) return;
  try { await S.map.ready; } catch (_) { return; }
  S.map.resize();
  await S.map.setFill(mapColors());
  await S.map.setBoundariesVisible(S.layers.boundaries !== false);
  S.map.setFocus(S.form.scope === "dalarna" ? "" : S.form.scope);
  const notes = [];
  for (const l of ["weather", "roads", "water", "forest", "land"]) {
    const a = layerAvail(l);
    if (S.layers[l] === false) { S.map.setOverlay(l, null); continue; }
    if (!a.ok) { S.map.setOverlay(l, null); notes.push(`${LAYER_LABEL[l]} unavailable: ${a.reason || "no data"}`); continue; }
    const feeder = S.mapState?.layers?.[l]?.source;
    if (!feeder) continue;
    try {
      if (!S.overlayCache[feeder]) S.overlayCache[feeder] = await get(`/api/datasources?source=${encodeURIComponent(feeder)}`);
      const n = await S.map.setOverlay(l, S.overlayCache[feeder], LAYER_COLOR[l]);
      if (!n) notes.push(`${LAYER_LABEL[l]}: no mappable records yet`);
    } catch (e) {
      notes.push(`${LAYER_LABEL[l]}: Unable to retrieve this source. Showing last available data.`);
    }
  }
  const note = $("#map-note");
  if (note) note.innerHTML = notes.map((n) => `<div>${esc(n)}</div>`).join("");
  const title = $("#map-title");
  if (title) title.textContent = mapTitle();
}

async function quickDetail(code, lngLat) {
  const m = S.munis?.municipalities?.find((x) => x.code === code);
  const r = S.result && !isPending() && isSim() ? S.result.municipalities?.find((x) => x.code === code) : null;
  const pop = r ? `${fmtNum(r.current_population)} → <b>${fmtNum(r.simulated_population)}</b> ${simTag}` : m?.population ? fmtNum(m.population.value) : "no data";
  const risks = r ? H.RISK_CATS.map((c) => `<div class="qd-row"><span>${esc(c.short)}</span>${levelBadge(lvlOf(r[c.key]))}</div>`).join("") : "";
  const el = await S.map.popup(lngLat, `<div class="qd"><b>${esc(m?.name || code)}</b><div class="muted small">Population: ${pop}</div>${risks}<button class="btn small" data-act="open-muni" data-code="${esc(code)}">View details</button></div>`);
  void el;
}

// ------------------------------------------------------------------ simulation control (ONE editor)
function isExternal(s) {
  const imp = S.result?.impact_by_source?.find((i) => i.id === s.id);
  return imp ? imp.status === "external" : /weather|climate/i.test(s.category || "");
}

function renderControl() {
  if (!comp("simulation_control")) return "";
  const f = S.form;
  const sc = S.scenarios;
  const bad = (k) => (S.invalid[k] ? "invalid" : "");
  const desc = sc.find((s) => s.id === f.scenario)?.description;
  return `
    <div class="panel sim-ctrl-card" id="sim-control">
      <div class="card-head"><div class="card-title"><i class="fa-solid fa-gear text-blue"></i> Simulation Control</div></div>
      <div class="sim-form-group"><label class="sim-label" for="sim-scenario">Scenario</label>
        <select class="sim-select" id="sim-scenario" ${S.running ? "disabled" : ""}>${sc.length ? sc.map((s) => `<option value="${esc(s.id)}" ${s.id === f.scenario ? "selected" : ""}>${esc(s.name)}</option>`).join("") : `<option>${S.errors.scenarios ? "Scenarios unavailable" : "Loading…"}</option>`}</select>
        ${desc ? `<div class="muted small">${esc(desc)}</div>` : ""}</div>
      <div class="sim-form-group"><span class="sim-label">Target year</span>
        <div class="year-pills" id="sim-year-pills" role="group" aria-label="Target year">${YEARS.map((y) => `<button class="year-pill ${f.year === y ? "active" : ""}" data-act="year" data-year="${y}" ${S.running ? "disabled" : ""}>${y}</button>`).join("")}</div></div>
      <div class="sim-form-group"><div class="slider-header"><label class="sim-label" for="pop-number">Population change</label>
          <span class="num-wrap ${bad("pop")}"><input type="number" id="pop-number" min="${POP_MIN}" max="${POP_MAX}" step="1" value="${esc(f.pop)}" aria-invalid="${!!S.invalid.pop}" ${S.running ? "disabled" : ""}><span>%</span></span></div>
        <input type="range" class="sim-range" id="pop-slider" min="${POP_MIN}" max="${POP_MAX}" value="${Math.max(POP_MIN, Math.min(POP_MAX, Number(f.pop) || 0))}" step="1" aria-label="Population change slider" ${S.running ? "disabled" : ""}>
        ${S.invalid.pop ? `<div class="field-error">${esc(S.invalid.pop)}</div>` : `<div class="muted small">Range ${POP_MIN}% to +${POP_MAX}%</div>`}</div>
      ${Object.entries(f.drivers || {}).map(([k, v]) => `<div class="sim-form-group"><label class="sim-label" for="drv-${esc(k)}">${esc(k.replace(/_/g, " "))}</label><input type="number" step="any" id="drv-${esc(k)}" data-driver="${esc(k)}" value="${esc(v)}" class="drv-input ${bad("d_" + k)}"></div>`).join("")}
      <div class="sim-form-group"><label class="sim-label" for="sim-scope">Scope</label>
        <select class="sim-select" id="sim-scope" ${S.running ? "disabled" : ""}><option value="dalarna" ${f.scope === "dalarna" ? "selected" : ""}>All Dalarna (${S.munis?.municipalities?.length || 15} municipalities)</option>
          ${(S.munis?.municipalities || []).map((m) => `<option value="${esc(m.code)}" ${f.scope === m.code ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
      <div class="toggles-header">Source dependencies</div>
      <div class="sim-toggles-list">${srcList().filter((s) => {
        const isOff = ctl()?.sources?.[s.id] === false || S.control?.sources?.[s.id] === false || s.enabled === false || s.status === "disabled";
        return !isOff;
      }).map((s) => {
        const v = H.sourceVisual(s);
        return `<label class="sim-toggle-row"><span class="toggle-name"><i class="fa-solid ${v.icon} ${v.color}"></i> ${esc(s.name)} – ${esc(s.category)}${isExternal(s) ? ` <em class="muted">(external context only)</em>` : ""}</span>
          <input type="checkbox" class="toggle-switch-input" data-act="dep" data-id="${esc(s.id)}" ${f.excluded.includes(s.id) ? "" : "checked"} ${S.running ? "disabled" : ""}><span class="toggle-switch-slider"></span></label>`;
      }).join("")}</div>
      <div class="muted small dep-note">Switching a source off marks its consequence as “excluded”; its data stays available.</div>
      <button class="btn-run-sim" id="btn-run-sim" data-act="run" ${S.running ? "disabled" : ""}>${S.running ? `<i class="fa-solid fa-spinner fa-spin"></i> Running…` : `<i class="fa-solid fa-play"></i> Run Simulation`}</button>
      <div class="run-status" id="run-status" role="status">${S.running ? "Running simulation... Please wait." : ""}</div>
      <button class="btn-reset-sim" data-act="reset" ${S.running ? "disabled" : ""}>Reset</button>
      <button class="advanced-opt-link" data-act="advanced" aria-expanded="${S.advancedOpen}">Advanced options ${S.advancedOpen ? "▴" : "▾"}</button>
      ${S.advancedOpen ? advancedHtml() : ""}
    </div>`;
}

function advancedHtml() {
  const a = S.result?.assumptions;
  return `<div class="advanced">
    <div class="adv-row"><span>Model version</span><b>${esc(S.result?.model_version || "run a simulation to see")}</b></div>
    <div class="adv-title">Coefficients</div>
    ${a?.coefficients ? Object.entries(a.coefficients).map(([k, v]) => `<div class="adv-row"><span>${esc(k.replace(/_/g, " "))}</span><b>${esc(v)}</b></div>`).join("") : `<div class="muted small">Shown after the first run.</div>`}
    <div class="adv-title">Risk thresholds (set by the administrator)</div>
    ${H.bands(thresholds()).map((b) => `<div class="adv-row"><span>${H.LEVEL_LABEL[b.level]}</span><b>${b.from.toFixed(2)} – ${b.to.toFixed(2)}</b></div>`).join("")}
    <div class="adv-title">Assumptions</div>
    <div class="muted small">${esc(a?.formula || "Population change is applied to each municipality, then propagated through the configured source dependencies.")}</div>
    <div class="muted small">${esc(a?.note || "SMHI weather is an external condition and is not changed by population growth.")}</div>
  </div>`;
}

function validateForm() {
  const errs = {};
  const p = Number(S.form.pop);
  if (S.form.pop === "" || Number.isNaN(p) || p < POP_MIN || p > POP_MAX) errs.pop = `Enter a value between ${POP_MIN} and ${POP_MAX}.`;
  for (const [k, v] of Object.entries(S.form.drivers || {})) if (v === "" || Number.isNaN(Number(v))) errs["d_" + k] = "Enter a number.";
  if (!S.form.scenario) errs.scenario = "Choose a scenario.";
  return errs;
}

async function runSimulation() {
  if (S.running) return;
  S.invalid = validateForm();
  if (Object.keys(S.invalid).length) {
    toast("Please correct the highlighted value(s).", "error"); // user input is kept
    rerenderControl();
    return;
  }
  S.running = true;
  rerenderControl();
  renderResultsSlot();
  const payload = {
    scenario: S.form.scenario,
    target_year: S.form.year,
    scope: S.form.scope,
    driver: { ...Object.fromEntries(Object.entries(S.form.drivers).map(([k, v]) => [k, Number(v)])), population_change: Number(S.form.pop) / 100 },
    excluded_sources: S.form.excluded,
  };
  try {
    const res = await post("/api/simulation/run", payload);
    S.result = res;
    S.resultSig = sigOfForm(S.form);
    S.view = { mode: "simulation", year: res.target_year };
    H.storeSet("session", "dt_view", S.view);
    toast(`Simulation completed successfully. Result ID: ${res.run_id}`, "ok");
  } catch (e) {
    toast(e.status === 401 ? "Sign in is required to run simulations." : e.message, "error"); // previous result stays
  } finally {
    S.running = false;
    renderHeader(); renderBanner(); rerenderControl(); renderResultsSlot(); renderMuniSlot(); refreshMap();
  }
}

function markPending() {
  renderResultsSlot();
  renderMuniSlot();
  refreshMap();
  renderBanner();
}

function rerenderControl() {
  const slot = $("#control-slot");
  if (slot) slot.innerHTML = renderControl();
}

// ------------------------------------------------------------------ simulation results (ONE area)
function categoryAverages() {
  const ms = S.result?.municipalities || [];
  const out = {};
  for (const c of H.RISK_CATS) {
    const scores = ms.map((m) => m[c.key]?.score).filter((x) => typeof x === "number");
    const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    out[c.key] = { score, level: score == null ? null : H.classify(score, thresholds()) };
  }
  const rr = S.result?.summary?.regional_risk;
  if (rr) out.overall_risk = { score: rr.score, level: H.classify(rr.score, thresholds()) };
  return out;
}

function gaugeSvg(score) {
  const cx = 50, cy = 50, r = 35;
  const pt = (f, rad = r) => [cx + rad * Math.cos(Math.PI * (1 - f)), cy - rad * Math.sin(Math.PI * (1 - f))];
  const arcs = H.bands(thresholds()).map((b) => {
    const [x1, y1] = pt(b.from), [x2, y2] = pt(b.to);
    return `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${H.LEVEL_COLOR[b.level]}" stroke-width="8" opacity=".9"/>`;
  }).join("");
  const [nx, ny] = pt(Math.max(0, Math.min(1, score)), 27);
  return `<svg viewBox="0 0 100 56" class="radial-gauge-svg">${arcs}<line x1="50" y1="50" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="50" cy="50" r="3.5" fill="#fff"/></svg>`;
}

function resultsInner() {
  const r = S.result;
  if (S.running && !r) return `<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Running simulation... Please wait.</div>`;
  if (!r) return `<div class="empty-state"><b>No simulation has been run yet.</b><br>Choose the scenario, year and driver value, then click <i>Run Simulation</i>.${S.errors.result ? `<br><span class="text-red small">${esc(S.errors.result)}</span>` : ""}</div>`;
  if (isPending()) {
    return `<div class="pending-card"><i class="fa-solid fa-hourglass-half"></i><div><b>Pending – inputs changed</b>
      <div class="muted">The previous result (${esc(r.target_year)}, ${esc(r.run_id)}) is hidden so it cannot be mistaken for the new inputs.</div>
      <button class="btn small primary" data-act="run" ${S.running ? "disabled" : ""}>${S.running ? "Running simulation... Please wait." : "Run Simulation"}</button></div></div>`;
  }
  const avgs = categoryAverages();
  const total = r.summary || {};
  const cards = [
    comp("population") && `<button class="m5-item" data-act="open-cat" data-cat="population"><i class="fa-solid fa-users m5-icon text-purple"></i><span class="m5-title">Population</span><div class="m5-val-row"><span class="m5-val-text">${fmtNum(total.population_simulated)}</span></div><span class="m5-sub">${simTag} ${H.fmtPct(total.population_change_pct, 0)}</span></button>`,
    ...H.RISK_CATS.filter((c) => c.key !== "overall_risk" && comp(c.component)).map((c) => `<button class="m5-item" data-act="open-cat" data-cat="${c.key}"><i class="fa-solid ${c.icon} m5-icon"></i><span class="m5-title">${esc(c.short)} risk</span><div class="m5-val-row">${levelBadge(avgs[c.key].level)}</div><span class="m5-sub">${simTag} score ${avgs[c.key].score == null ? "—" : avgs[c.key].score.toFixed(2)}</span></button>`),
  ].filter(Boolean);
  const impact = (r.impact_by_source || []).map((i) => {
    const v = H.sourceVisual(srcById(i.id) || { name: i.name });
    const ex = i.status === "excluded", ext = i.status === "external";
    const cls = ext ? "external" : i.impact === "Driver" ? "none" : H.lc(i.impact);
    const badge = ex ? `<span class="risk-badge none">Excluded</span>` : `<button class="risk-badge ${cls} clickable" data-act="open-impact" data-id="${esc(i.id)}" title="Show score, threshold and contributors">${esc(i.impact)}</button>`;
    return `<tr class="${ex ? "excluded" : ""} clickable-row" data-act="open-impact" data-id="${esc(i.id)}"><td><i class="fa-solid ${v.icon} ${v.color}"></i> ${esc(i.name)}</td><td class="ro">${esc(i.current)}</td><td class="ro">${esc(i.simulated)} ${ex ? "" : simTag}</td><td class="ro ${String(i.change).startsWith("-") ? "text-red" : "text-green"}">${esc(i.change)}</td><td>${badge}</td></tr>`;
  }).join("");
  const regional = total.regional_risk;
  const regLvl = H.classify(regional?.score, thresholds());
  return `
    <div class="results-meta muted small">Run <b>${esc(r.run_id)}</b> · ${esc(r.scenario)} · ${esc(r.target_year)} · ${esc(scopeName(r.scope))} · model ${esc(r.model_version)} · ${esc(fmtDateTime(r.timestamp))}${r.is_test ? " · TEST RUN" : ""}</div>
    ${cards.length ? `<div class="metrics-5-box">${cards.join("")}</div>` : ""}
    ${comp("simulation_results") ? `<div class="impact-table-wrap"><div class="impact-title">Impact by source (${esc(scopeName(r.scope))} total)</div>
      <table class="impact-table"><thead><tr><th>Source</th><th>Current</th><th>Simulated (${esc(r.target_year)})</th><th>Change</th><th>Impact</th></tr></thead><tbody>${impact}</tbody></table></div>` : ""}
    ${comp("regional_risk") ? `<div class="res-split-bottom">
      <div class="gauge-box"><div class="gauge-title">Overall Regional Risk</div>
        <button class="gauge-btn" data-act="gauge" aria-label="Show risk breakdown">${gaugeSvg(regional?.score ?? 0)}</button>
        <button class="gauge-label ${regLvl || ""}" data-act="gauge-label" title="Score, categories and threshold">${esc((H.LEVEL_LABEL[regLvl] || "—").toUpperCase())}</button>
        <div class="muted small">score ${regional?.score?.toFixed?.(2) ?? "—"}</div></div>
      <div class="takeaway-box"><div class="takeaway-head"><i class="fa-regular fa-lightbulb"></i> Key Takeaway</div><div class="takeaway-text">${esc(total.key_takeaway || "")}</div>
        <button class="link-btn" data-act="methodology">Methodology &amp; assumptions →</button></div></div>` : ""}`;
}

function renderResults() {
  if (!comp("simulation_results") && !comp("regional_risk") && !comp("population")) return "";
  if (!isSim()) {
    return `<div class="panel sim-res-card"><div class="card-head"><div class="card-title">Current data – ${esc(scopeName(S.form.scope))}</div></div>
      <div class="empty-state">You are viewing <b>measured data</b>. Simulated values are never shown here.<br><button class="btn small primary" data-act="mode" data-mode="simulation">Switch to Simulation</button></div></div>`;
  }
  const show = S.result && !isPending();
  return `<div class="panel sim-res-card ${isPending() ? "is-pending" : ""}" id="results-panel">
    <div class="card-head"><div class="card-title">Simulation Results – ${esc(scopeName(show ? S.result.scope : S.form.scope))} (${esc(show ? S.result.target_year : S.form.year)}) ${show ? simTag : ""}</div>
      ${show ? `<span class="muted small">${esc(S.scenarios.find((x) => x.id === S.result.scenario)?.name || S.result.scenario)}</span>` : ""}</div>
    <div id="results-inner">${resultsInner()}</div></div>`;
}

function renderResultsSlot() {
  const slot = $("#results-slot");
  if (slot) slot.innerHTML = renderResults();
}

// ------------------------------------------------------------------ municipality table
function muniRows() {
  const live = !isSim() || !S.result || isPending();
  let rows;
  if (!live) {
    rows = (S.result.municipalities || []).map((m) => ({ code: m.code, name: m.name, cur: m.current_population, sim: m.simulated_population, pct: m.population_change_pct, cats: Object.fromEntries(H.RISK_CATS.map((c) => [c.key, { ...m[c.key], level: lvlOf(m[c.key]) }])) }));
    rows.sort((a, b) => b.cats.overall_risk.score - a.cats.overall_risk.score);
  } else {
    rows = (S.munis?.municipalities || []).map((m) => ({ code: m.code, name: m.name, cur: m.population?.value ?? null, period: m.population?.period, origin: m.population?.origin }));
    rows.sort((a, b) => (b.cur ?? -1) - (a.cur ?? -1));
  }
  if (S.form.scope !== "dalarna" && isSim()) rows = rows.filter((r) => r.code === S.form.scope);
  const q = norm(S.filter.search);
  if (q) rows = rows.filter((r) => norm(r.name).includes(q));
  if (S.filter.level !== "all" && !live) rows = rows.filter((r) => r.cats.overall_risk.level === S.filter.level);
  return { rows, live };
}

function trendSvg(r) {
  if (r.sim == null) return "";
  const lo = Math.min(r.cur, r.sim), hi = Math.max(r.cur, r.sim) || 1;
  const y = (v) => 16 - (hi === lo ? 8 : ((v - lo) / (hi - lo)) * 12);
  const tip = `${S.munis?.data_year || "now"}: ${fmtNum(r.cur)} → ${S.result.target_year}: ${fmtNum(r.sim)}`;
  return `<button class="trend-btn" data-act="open-muni" data-code="${esc(r.code)}" title="${esc(tip)}"><svg class="sparkline-trend-svg" viewBox="0 0 80 20"><title>${esc(tip)}</title><path d="M4,${y(r.cur)} L76,${y(r.sim)}" stroke="${r.sim >= r.cur ? "#f59e0b" : "#22c55e"}"/><circle cx="4" cy="${y(r.cur)}" r="2" fill="#94a3b8"/><circle cx="76" cy="${y(r.sim)}" r="2" fill="#f59e0b"/></svg></button>`;
}

function renderMuni() {
  if (!comp("municipality_table")) return "";
  const { rows, live } = muniRows();
  const total = rows.reduce((a, r) => ({ cur: a.cur + (r.cur || 0), sim: a.sim + (r.sim || 0) }), { cur: 0, sim: 0 });
  const viewBtn = (r) => `<button class="btn-icon-view" data-act="open-muni" data-code="${esc(r.code)}" title="View detailed results" aria-label="View ${esc(r.name)}"><i class="fa-solid fa-chart-simple"></i></button>`;
  const body = rows.length ? rows.map((r, i) => live
    ? `<tr class="clickable-row" data-act="open-muni" data-code="${esc(r.code)}"><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="num">${r.cur == null ? "no data" : fmtNum(r.cur)}</td><td class="ro">${esc(r.period || "—")}${r.origin === "fallback" ? " · fallback" : ""}</td><td class="center">${viewBtn(r)}</td></tr>`
    : `<tr class="clickable-row" data-act="open-muni" data-code="${esc(r.code)}"><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="num">${fmtNum(r.cur)}</td><td class="num">${fmtNum(r.sim)} ${simTag}</td><td class="num ${r.pct < 0 ? "text-red" : "text-green"}">${H.fmtPct(r.pct, 0)}</td>${H.RISK_CATS.map((c) => `<td class="center">${levelButton(r.cats[c.key].level, `data-act="open-risk" data-code="${esc(r.code)}" data-cat="${c.key}"`)}</td>`).join("")}<td class="center">${trendSvg(r)}</td><td class="center">${viewBtn(r)}</td></tr>`).join("")
    : `<tr><td colspan="${live ? 5 : 12}" class="empty-row">No municipality found.</td></tr>`;
  const head = live
    ? `<tr><th>#</th><th>Municipality</th><th class="num">Population</th><th>Data period</th><th class="center">View</th></tr>`
    : `<tr><th>#</th><th>Municipality</th><th class="num">Current</th><th class="num">Simulated</th><th class="num">Δ%</th>${H.RISK_CATS.map((c) => `<th class="center"><i class="fa-solid ${c.icon}"></i> ${esc(c.short)}</th>`).join("")}<th class="center">Trend</th><th class="center">View</th></tr>`;
  const foot = !rows.length ? "" : live
    ? `<tfoot><tr><td></td><td>${esc(scopeName(S.form.scope))} (Total)</td><td class="num">${fmtNum(total.cur)}</td><td colspan="2"></td></tr></tfoot>`
    : `<tfoot><tr><td></td><td>${esc(scopeName(S.form.scope))} (Total)</td><td class="num">${fmtNum(total.cur)}</td><td class="num">${fmtNum(total.sim)}</td><td class="num">${H.fmtPct(total.cur ? ((total.sim - total.cur) / total.cur) * 100 : 0, 1)}</td><td colspan="7"></td></tr></tfoot>`;
  const pend = isSim() && S.result && isPending();
  return `<section class="panel muni-card">
    <div class="muni-sim-header"><div class="muni-sim-title"><i class="fa-solid fa-city text-blue"></i> Municipalities – ${live ? (pend ? "current data (simulation pending)" : "current data") : `Simulation Results (${esc(S.result.target_year)}) ${simTag}`}</div>
      <div class="muni-sim-controls">
        <div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="muni-search" placeholder="Search municipality..." value="${esc(S.filter.search)}" aria-label="Search municipality"></div>
        <select class="sim-select" id="muni-filter" aria-label="Filter by overall risk" ${live ? `disabled title="Risk filter applies to simulation results"` : ""}>
          <option value="all">All municipalities</option>${H.LEVELS.map((l) => `<option value="${l}" ${S.filter.level === l ? "selected" : ""}>${H.LEVEL_LABEL[l]} risk</option>`).join("")}</select>
        <button class="btn-export" data-act="export-menu"><i class="fa-solid fa-download"></i> Export</button></div></div>
    <div class="muni-table-scroll"><table class="muni-full-table"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div></section>`;
}

function renderMuniSlot() {
  const slot = $("#muni-slot");
  if (slot) slot.innerHTML = renderMuni();
}

// ------------------------------------------------------------------ drawers
function muniLocationSvg(code) {
  const f = S.map?.geo?.features?.find((x) => x.properties.code === code);
  if (!f) return "";
  const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const pts = rings.flatMap((p) => p[0]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const k = Math.min(160 / (maxx - minx), 120 / (maxy - miny));
  const path = rings.map((p) => "M" + p[0].map(([x, y]) => `${((x - minx) * k + 6).toFixed(1)},${((maxy - y) * k + 6).toFixed(1)}`).join("L") + "Z").join("");
  return `<svg class="loc-svg" viewBox="0 0 ${((maxx - minx) * k + 12).toFixed(0)} ${((maxy - miny) * k + 12).toFixed(0)}"><path d="${path}" fill="#1d68e8" fill-opacity=".45" stroke="#7dd3fc" stroke-width="1.5"/></svg>`;
}

function contributorsHtml(catKey) {
  const imps = S.result?.impact_by_source || [];
  const coeffs = S.result?.assumptions?.coefficients || {};
  return (CAT_SOURCES[catKey] || []).map((id) => {
    const i = imps.find((x) => x.id === id);
    if (!i) return "";
    const c = coeffs[SOURCE_COEFF[id]];
    return `<div class="adv-row"><span>${esc(i.name)} <em class="muted">(${esc(i.role)})</em></span><b>${i.status === "excluded" ? "excluded" : `${esc(i.change)}${c != null ? ` · coefficient ${esc(c)}` : ""}`}</b></div>`;
  }).join("");
}

function openMunicipality(code) {
  closePopover();
  const m = S.munis?.municipalities?.find((x) => x.code === code);
  const r = S.result && isSim() && !isPending() ? S.result.municipalities?.find((x) => x.code === code) : null;
  let body = `<h2>${esc(r?.name || m?.name || code)}</h2><div class="muted small">Municipality code ${esc(code)} · Dalarna County</div>`;
  if (r) {
    body += `<div class="drawer-badges">${levelBadge(lvlOf(r.overall_risk), `Overall: ${H.LEVEL_LABEL[lvlOf(r.overall_risk)]}`)} ${simTag}</div>
      <dl class="drawer-dl"><dt>Current population</dt><dd><b>${fmtNum(r.current_population)}</b></dd>
      <dt>Simulated (${esc(S.result.target_year)})</dt><dd><b class="text-green">${fmtNum(r.simulated_population)}</b> (${H.fmtPct(r.population_change_pct, 0)}) ${simTag}</dd>
      ${H.RISK_CATS.map((c) => `<dt>${esc(c.label)}</dt><dd>${levelButton(lvlOf(r[c.key]), `data-act="open-risk" data-code="${esc(code)}" data-cat="${c.key}"`)} <span class="muted">score ${r[c.key].score.toFixed(2)}</span></dd>`).join("")}</dl>
      <div class="adv-title">Contributing sources</div>${contributorsHtml("overall_risk")}
      <div class="adv-title">Trend</div><div class="trend-box">${trendSvg({ code, cur: r.current_population, sim: r.simulated_population })}<span class="muted small">${esc(S.munis?.data_year || "now")}: ${fmtNum(r.current_population)} → ${esc(S.result.target_year)}: ${fmtNum(r.simulated_population)} ${simTag}</span></div>
      <div class="adv-title">Assumptions</div><div class="muted small">Driver: ${esc(JSON.stringify(S.result.assumptions?.driver || {}))} · model ${esc(S.result.model_version)} · run ${esc(S.result.run_id)}</div>`;
  } else {
    body += `<dl class="drawer-dl"><dt>Population</dt><dd><b>${m?.population ? fmtNum(m.population.value) : "no data"}</b> ${m?.population ? `(SCB ${esc(m.population.period || "")}${m.population.origin === "fallback" ? ", fallback" : ""})` : ""}</dd></dl>
      <div class="muted small">Risk results appear in Simulation mode after a simulation has been run.</div>`;
  }
  body += `<div class="adv-title">Location</div>${muniLocationSvg(code)}
    <div class="drawer-actions"><button class="btn primary" data-act="back-regional">Back to Regional View</button></div>`;
  openDrawer(body);
}

function openRiskDetail(code, catKey) {
  const r = S.result?.municipalities?.find((x) => x.code === code);
  if (!r) return;
  const e = r[catKey], lvl = lvlOf(e);
  const cat = H.RISK_CATS.find((c) => c.key === catKey);
  const band = H.bands(thresholds()).find((b) => b.level === lvl);
  openDrawer(`<h2>${esc(r.name)} – ${esc(cat.label)}</h2><div class="drawer-badges">${levelBadge(lvl)} ${simTag}</div>
    <dl class="drawer-dl"><dt>Score</dt><dd><b>${e.score.toFixed(2)}</b> (0–1)</dd><dt>Threshold band</dt><dd>${band ? `${band.from.toFixed(2)} – ${band.to.toFixed(2)}` : "—"} (${H.LEVEL_LABEL[lvl]})</dd></dl>
    <div class="adv-title">Main contributors</div>${contributorsHtml(catKey)}
    <div class="muted small">Thresholds are configured by the administrator, not by this page.</div>`);
}

function openCategory(catKey) {
  if (catKey === "population") {
    const t = S.result.summary;
    return openDrawer(`<h2>Population</h2><div class="drawer-badges">${simTag}</div><dl class="drawer-dl"><dt>Current</dt><dd>${fmtNum(t.population_current)}</dd><dt>Simulated (${esc(S.result.target_year)})</dt><dd><b>${fmtNum(t.population_simulated)}</b> (${H.fmtPct(t.population_change_pct, 0)})</dd></dl>
      <div class="adv-title">Driver</div><div class="muted small">${esc(JSON.stringify(S.result.assumptions?.driver || {}))}. Formula: ${esc(S.result.assumptions?.formula || "")}</div>`);
  }
  const cat = H.RISK_CATS.find((c) => c.key === catKey);
  const top = [...(S.result.municipalities || [])].sort((a, b) => b[catKey].score - a[catKey].score).slice(0, 5);
  const avg = categoryAverages()[catKey];
  openDrawer(`<h2>${esc(cat.label)}</h2><div class="drawer-badges">${levelBadge(avg.level)} ${simTag}</div>
    <dl class="drawer-dl"><dt>Regional average score</dt><dd><b>${avg.score?.toFixed(2)}</b></dd></dl>
    <div class="adv-title">Contributing factors</div>${contributorsHtml(catKey)}
    <div class="adv-title">Highest municipalities</div>${top.map((m) => `<div class="adv-row"><span>${esc(m.name)}</span>${levelButton(lvlOf(m[catKey]), `data-act="open-risk" data-code="${esc(m.code)}" data-cat="${catKey}"`, `${H.LEVEL_LABEL[lvlOf(m[catKey])]} · ${m[catKey].score.toFixed(2)}`)}</div>`).join("")}`);
}

function openImpact(id) {
  const i = S.result?.impact_by_source?.find((x) => x.id === id);
  if (!i) return;
  const c = S.result.assumptions?.coefficients?.[SOURCE_COEFF[id]];
  const kind = i.status === "external" ? "External condition: this source is context only and is not changed by the scenario." : i.status === "excluded" ? "Excluded by the Source dependency toggles. Its data stays available; only the consequence is left out." : i.impact === "Driver" ? "Driver: the scenario input that starts the dependency chain." : "Causal: changed through the configured dependency chain.";
  const feeds = Object.entries(CAT_SOURCES).filter(([k, ids]) => k !== "overall_risk" && ids.includes(id)).map(([k]) => `<div class="adv-row"><span>${esc(H.RISK_CATS.find((c2) => c2.key === k).label)}</span></div>`).join("");
  openDrawer(`<h2>${esc(i.name)}</h2><div class="drawer-badges"><span class="risk-badge ${i.status === "external" ? "external" : H.lc(i.impact) || "none"}">${esc(i.status === "excluded" ? "Excluded" : i.impact)}</span> ${simTag}</div>
    <p class="muted">${esc(kind)}</p>
    <dl class="drawer-dl"><dt>Role</dt><dd>${esc(i.role)}</dd><dt>Current</dt><dd>${esc(i.current)}</dd><dt>Simulated</dt><dd>${esc(i.simulated)}</dd><dt>Change</dt><dd>${esc(i.change)}</dd>${c != null ? `<dt>Coefficient</dt><dd>${esc(SOURCE_COEFF[id])} = ${esc(c)}</dd>` : ""}</dl>
    <div class="adv-title">Risk thresholds in use</div>${H.bands(thresholds()).map((b) => `<div class="adv-row"><span>${H.LEVEL_LABEL[b.level]}</span><b>${b.from.toFixed(2)} – ${b.to.toFixed(2)}</b></div>`).join("")}
    <div class="adv-title">Feeds categories</div>${feeds || `<div class="muted small">None (context only).</div>`}`);
}

function openGauge() {
  const avgs = categoryAverages();
  const rr = S.result.summary.regional_risk;
  const lvl = H.classify(rr.score, thresholds());
  const th = H.bands(thresholds());
  const band = th.find((b) => b.level === lvl);
  openDrawer(`<h2>Overall Regional Risk</h2><div class="drawer-badges">${levelBadge(lvl)} ${simTag}</div>
    <dl class="drawer-dl"><dt>Score</dt><dd><b>${rr.score.toFixed(3)}</b></dd><dt>Band</dt><dd>${band ? `${band.from.toFixed(2)} – ${band.to.toFixed(2)}` : "—"}</dd></dl>
    <div class="adv-title">Category contributions</div>${H.RISK_CATS.filter((c) => c.key !== "overall_risk").map((c) => `<div class="adv-row"><span>${esc(c.label)}</span><b>${avgs[c.key].score?.toFixed(2)} · ${H.LEVEL_LABEL[avgs[c.key].level]}</b></div>`).join("")}
    <div class="adv-title">Thresholds</div>${th.map((b) => `<div class="adv-row"><span>${H.LEVEL_LABEL[b.level]}</span><b>${b.from.toFixed(2)} – ${b.to.toFixed(2)}</b></div>`).join("")}
    <div class="drawer-actions"><button class="btn" data-act="methodology">Methodology</button></div>`);
}

function openMethodology() {
  const r = S.result;
  openDrawer(`<h2>Methodology &amp; assumptions</h2><p class="muted">Scenario results are produced by the Dalarna dependency model: population → traffic demand → infrastructure pressure → land development → environmental pressure → water/supply exposure → overall risk. They are what-if estimates, not agency forecasts.</p>
    <dl class="drawer-dl"><dt>Model version</dt><dd>${esc(r?.model_version || "—")}</dd><dt>Formula</dt><dd>${esc(r?.assumptions?.formula || "—")}</dd><dt>Driver</dt><dd>${esc(JSON.stringify(r?.assumptions?.driver || {}))}</dd></dl>
    <div class="adv-title">Coefficients</div>${Object.entries(r?.assumptions?.coefficients || {}).map(([k, v]) => `<div class="adv-row"><span>${esc(k.replace(/_/g, " "))}</span><b>${esc(v)}</b></div>`).join("")}
    <p class="muted small">${esc(r?.assumptions?.note || "SMHI weather is an external condition; population growth does not change it.")}</p>`);
}

async function openSource(id) {
  const s = srcById(id);
  if (!s) return;
  const v = H.sourceVisual(s);
  openDrawer(`<h2><i class="fa-solid ${v.icon} ${v.color}"></i> ${esc(s.name)}</h2><div class="muted small">${esc(s.category)}</div><div id="src-body"><div class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div></div>`);
  let fc = null, failed = false;
  try { fc = await get(`/api/datasources?source=${encodeURIComponent(id)}`); } catch (e) { failed = true; }
  const el = document.getElementById("src-body");
  if (!el) return;
  const h = headlineOf(s);
  const feats = fc?.features || [];
  const attrRows = feats.slice(0, 8).map((f) => `<tr><td>${esc(f.properties.feature_id || f.properties.dataset_id || "—")}</td><td>${esc(f.properties.observed_at ? fmtDateTime(f.properties.observed_at) : "—")}</td><td class="ro">${esc(JSON.stringify(f.properties.attributes || {}).slice(0, 90))}</td></tr>`).join("");
  let extra = "";
  if (s.headline?.population_total != null && S.munis) {
    const sim = S.result && isSim() && !isPending() ? new Map(S.result.municipalities.map((m) => [m.code, m.simulated_population])) : null;
    extra = `<div class="adv-title">Population by municipality${sim ? ` (current vs simulated ${simTag})` : ""}</div><table class="mini-table"><thead><tr><th>Municipality</th><th class="num">Current</th>${sim ? `<th class="num">Simulated</th>` : ""}</tr></thead><tbody>${S.munis.municipalities.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${m.population ? fmtNum(m.population.value) : "no data"}</td>${sim ? `<td class="num">${fmtNum(sim.get(m.code))}</td>` : ""}</tr>`).join("")}</tbody></table>`;
  }
  el.innerHTML = `
    ${failed || s.status === "error" ? `<div class="banner warn">Unable to retrieve this source. Showing last available data.</div>` : ""}
    ${s.status === "stale" ? `<div class="banner warn">Data may be outdated. Last update: ${esc(fmtDateTime(s.last_success_at))}</div>` : ""}
    <div class="drawer-badges">${H.statusPill(s.status, s.status_label)}</div>
    <dl class="drawer-dl"><dt>Latest</dt><dd><b>${esc(h.value)}</b> <span class="muted">${esc(h.sub)}</span></dd>
      <dt>Last success</dt><dd>${esc(fmtDateTime(s.last_success_at))}</dd><dt>Last attempt</dt><dd>${esc(fmtDateTime(s.last_attempt_at))}</dd>
      <dt>Update interval</dt><dd>${esc(Math.round(s.interval_seconds / 60))} min (stale after ${esc(Math.round(s.freshness_seconds / 60))} min)</dd><dt>Status</dt><dd>${esc(s.message)}</dd>
      ${s.map_layer ? `<dt>Map layer</dt><dd>${esc(s.map_layer)}</dd>` : ""}</dl>
    ${extra}
    <div class="adv-title">Stored records (${feats.length} with geometry)</div>
    ${attrRows ? `<table class="mini-table"><thead><tr><th>Feature</th><th>Observed</th><th>Attributes</th></tr></thead><tbody>${attrRows}</tbody></table>` : `<div class="muted small">No mappable records stored yet.</div>`}
    <div class="drawer-actions"><button class="btn" data-act="refresh">Refresh</button></div>`;
}

// ------------------------------------------------------------------ popovers
function openSysHealth(anchor) {
  const rows = srcList().map((s) => `<div class="pop-row"><span>${esc(s.name)}</span>${H.statusPill(s.status, s.status_label)}</div><div class="muted small pop-msg">${esc(s.message)}</div>`).join("");
  openPopover(anchor, `<div class="pop-title">System health</div>${rows || `<div class="muted">No sources reported.</div>`}<div class="pop-foot"><button class="btn small" data-act="refresh">Refresh</button></div>`);
}
function openLastUpdate(anchor) {
  const rows = srcList().map((s) => `<div class="pop-row"><span>${esc(s.name)}</span><b>${esc(s.last_success_at ? fmtDateTime(s.last_success_at) : "never")}</b></div>`).join("");
  openPopover(anchor, `<div class="pop-title">Last update per source</div>${rows}<div class="pop-foot muted small">Overall: ${esc(fmtDateTime(S.summary?.last_update))}</div>`);
}
function openScopeInfo(anchor) {
  openPopover(anchor, `<div class="pop-title">Scope: ${esc(scopeName(S.form.scope))}</div><div class="muted small">${S.form.scope === "dalarna" ? "All 15 municipalities of Dalarna County, Sweden." : `Municipality ${esc(S.form.scope)} within Dalarna County.`} Information only; change the scope in Simulation Control.</div>`, { align: "left" });
}
function openUserMenu(anchor) {
  const u = S.me?.user;
  openPopover(anchor, `<div class="pop-title">${u ? `Signed in as ${esc(u)}` : "Not signed in"}</div>
    ${u ? `<a class="pop-link" href="/admin">Admin Control Room</a><button class="pop-link" data-act="logout">Sign out</button>` : `<a class="pop-link" href="/login?next=/">Sign in</a>`}
    <a class="pop-link" href="#/settings">Personal settings</a>`);
}
function openLayerMenu(anchor) {
  const rows = LAYER_IDS.map((l) => {
    const a = layerAvail(l);
    return `<label class="layer-row ${a.ok ? "" : "off"}"><input type="checkbox" data-act="layer" data-layer="${l}" ${S.layers[l] !== false ? "checked" : ""} ${a.ok ? "" : "disabled"}><span>${esc(LAYER_LABEL[l])}</span>${a.ok ? "" : `<em class="muted small">${esc(a.reason || "unavailable")}</em>`}</label>`;
  }).join("");
  openPopover(anchor, `<div class="pop-title">Map layers</div>${rows}<div class="pop-foot muted small">Your own view only. The administrator controls the default.</div>`, { align: "left" });
}
function openExportMenu(anchor) {
  openPopover(anchor, `<div class="pop-title">Export current view</div><button class="pop-link" data-act="export" data-fmt="csv">CSV</button><button class="pop-link" data-act="export" data-fmt="xlsx">Excel (XLSX)</button><button class="pop-link" data-act="export" data-fmt="json">JSON (with run ID &amp; assumptions)</button><button class="pop-link" data-act="export" data-fmt="print">Print / Save as PDF</button>`);
}

// ------------------------------------------------------------------ export
async function doExport(fmt) {
  closePopover();
  try {
    if (fmt === "print") { window.print(); return; }
    const { rows, live } = muniRows();
    const r = S.result;
    const stamp = new Date().toISOString().slice(0, 10);
    if (!rows.length) throw new Error("nothing to export");
    const header = live ? ["Municipality", "Code", "Population", "Period", "Origin"] : ["Municipality", "Code", "Current population", "Simulated population", "Change %", ...H.RISK_CATS.flatMap((c) => [`${c.short} score`, `${c.short} level`]), "Run ID", "Scenario", "Target year", "Data type"];
    const data = rows.map((x) => live ? [x.name, x.code, x.cur ?? "", x.period ?? "", x.origin ?? ""] : [x.name, x.code, x.cur, x.sim, x.pct, ...H.RISK_CATS.flatMap((c) => [x.cats[c.key].score, H.LEVEL_LABEL[x.cats[c.key].level]]), r.run_id, r.scenario, r.target_year, "SIMULATED"]);
    const base = `dalarna_${live ? "current" : "simulation"}_${stamp}`;
    if (fmt === "csv") H.downloadBlob(`${base}.csv`, new Blob([H.toCsv([header, ...data])], { type: "text/csv;charset=utf-8" }));
    else if (fmt === "xlsx") {
      const X = await H.loadXlsx();
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([header, ...data]), "Municipalities");
      X.writeFile(wb, `${base}.xlsx`);
    } else if (fmt === "json") {
      const payload = live
        ? { type: "current", exported_at: new Date().toISOString(), municipalities: rows.map(({ code, name, cur, period, origin }) => ({ code, name, population: cur, period, origin })) }
        : { type: "simulation", simulated: true, run_id: r.run_id, scenario: r.scenario, target_year: r.target_year, scope: r.scope, model_version: r.model_version, timestamp: r.timestamp, assumptions: r.assumptions, municipalities: (r.municipalities || []).filter((m) => rows.some((x) => x.code === m.code)) };
      H.downloadBlob(`${live ? base : r.run_id}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    }
    toast("Export created successfully.", "ok");
  } catch (e) {
    toast("Export could not be created. Please try again.", "error");
  }
}

// ------------------------------------------------------------------ pages
function layoutOverview() {
  const showCtl = isSim() && comp("simulation_control");
  const showRes = comp("simulation_results") || comp("regional_risk") || comp("population");
  const cols = [comp("map"), showCtl, showRes].filter(Boolean).length;
  return `
    <div id="kpi-slot">${renderKpiCards()}</div>
    <section class="mid-row-grid cols-${cols}">
      ${comp("map") ? mapPanelHtml() : ""}
      ${showCtl ? `<div id="control-slot">${renderControl()}</div>` : ""}
      ${showRes ? `<div id="results-slot">${renderResults()}</div>` : ""}
    </section>
    <div id="muni-slot">${renderMuni()}</div>`;
}

function pageDataSources() {
  const rows = srcList().map((s) => {
    const v = H.sourceVisual(s);
    return `<tr class="clickable-row" data-act="open-source" data-id="${esc(s.id)}"><td><i class="fa-solid ${v.icon} ${v.color}"></i> <b>${esc(s.name)}</b></td><td>${esc(s.category)}</td><td>${H.statusPill(s.status, s.status_label)}</td><td>${esc(headlineOf(s).value)}</td><td>${esc(s.last_success_at ? fmtDateTime(s.last_success_at) : "never")}</td><td>${esc(Math.round(s.interval_seconds / 60))} min</td><td class="center"><button class="btn small" data-act="open-source" data-id="${esc(s.id)}">Details</button></td></tr>`;
  }).join("");
  return `<section class="panel"><div class="card-head"><div class="card-title">Data Sources</div><button class="btn small" data-act="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button></div>
    <div class="muted small" style="margin-bottom:8px">Read-only overview. Sources are switched on or off by the administrator in the Control Room.</div>
    <div class="muni-table-scroll"><table class="muni-full-table"><thead><tr><th>Source</th><th>Category</th><th>Status</th><th>Latest</th><th>Last update</th><th>Interval</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="empty-row">${S.errors.summary ? "Unable to retrieve this source. Showing last available data." : "Loading…"}</td></tr>`}</tbody></table></div></section>${renderKpiCards()}`;
}

function pageInsights() {
  if (!S.result || !isSim()) return `<section class="panel"><div class="card-head"><div class="card-title">Insights</div></div><div class="empty-state">Insights summarise a simulation result.<br>${isSim() ? "Run a simulation first." : `<button class="btn small primary" data-act="mode" data-mode="simulation">Switch to Simulation</button>`}</div></section>`;
  if (isPending()) return `<section class="panel"><div class="card-head"><div class="card-title">Insights</div></div>${resultsInner()}</section>`;
  const top = [...S.result.municipalities].sort((a, b) => b.overall_risk.score - a.overall_risk.score).slice(0, 5);
  const avgs = categoryAverages();
  const movers = (S.result.impact_by_source || []).filter((i) => i.status === "included" && i.id !== "scb");
  return `<section class="panel"><div class="card-head"><div class="card-title">Insights ${simTag}</div></div>
    <p class="takeaway-text">${esc(S.result.summary.key_takeaway)}</p>
    <div class="insight-grid"><div><div class="adv-title">Highest overall risk</div>${top.map((m) => `<div class="adv-row"><span>${esc(m.name)}</span>${levelButton(lvlOf(m.overall_risk), `data-act="open-risk" data-code="${esc(m.code)}" data-cat="overall_risk"`, `${H.LEVEL_LABEL[lvlOf(m.overall_risk)]} · ${m.overall_risk.score.toFixed(2)}`)}</div>`).join("")}</div>
    <div><div class="adv-title">Regional category risk</div>${H.RISK_CATS.map((c) => `<div class="adv-row"><span>${esc(c.label)}</span>${levelBadge(avgs[c.key].level)}</div>`).join("")}</div>
    <div><div class="adv-title">Largest cross-source effects</div>${movers.map((i) => `<div class="adv-row"><span>${esc(i.name)}</span><b>${esc(i.change)}</b></div>`).join("")}</div></div></section>`;
}

function pageReports() {
  const r = S.result;
  return `<section class="panel"><div class="card-head"><div class="card-title">Reports &amp; exports</div></div>
    <dl class="drawer-dl"><dt>Latest simulation</dt><dd>${r ? `<b>${esc(r.run_id)}</b> · ${esc(r.scenario)} · ${esc(r.target_year)} · ${esc(fmtDateTime(r.timestamp))} ${simTag}` : "none yet"}</dd><dt>Current data year</dt><dd>${esc(S.munis?.data_year || "—")}</dd></dl>
    <div class="report-actions">${[["csv", "Export CSV"], ["xlsx", "Export Excel"], ["json", "Export JSON"], ["print", "Print / PDF"]].map(([f, l]) => `<button class="btn" data-act="export" data-fmt="${f}">${l}</button>`).join("")}</div>
    <div class="muted small">Exports use the view you have selected (mode and scope).</div></section>`;
}

function pageSettings() {
  const p = S.prefs;
  return `<section class="panel"><div class="card-head"><div class="card-title">Personal settings</div></div>
    <div class="muted small" style="margin-bottom:10px">These are personal and stored only in this browser. They never change data or the shared configuration. Administrators change dashboard configuration in the Control Room.</div>
    <label class="set-row"><span>Open in</span><select class="sim-select" id="pref-mode"><option value="" ${!p.defaultMode ? "selected" : ""}>Administrator default</option><option value="live" ${p.defaultMode === "live" ? "selected" : ""}>Current (live data)</option><option value="simulation" ${p.defaultMode === "simulation" ? "selected" : ""}>Simulation</option></select></label>
    <label class="set-row"><span>Compact tables</span><input type="checkbox" id="pref-compact" ${p.compact ? "checked" : ""}></label>
    <div class="set-actions"><button class="btn" data-act="reset-prefs">Reset my settings</button> <a class="btn" href="/admin">Open Control Room</a></div></section>`;
}

function render() {
  renderHeader();
  renderBanner();
  const view = $("#view");
  if (!view) return;
  document.body.classList.toggle("is-preview", PREVIEW);
  document.body.classList.toggle("compact", !!S.prefs.compact);
  $("#app")?.classList.toggle("preview", PREVIEW);
  const r = route();
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === r));
  const w = $("#nav-widget-sub");
  if (w) w.textContent = `${S.munis?.municipalities?.length || 15} municipalities${S.summary ? ` · ${S.summary.online_count}/${S.summary.total} sources online` : ""}`;
  closePopover();
  if (r === "overview") view.innerHTML = layoutOverview();
  else if (r === "map") view.innerHTML = mapPanelHtml(true);
  else if (r === "simulation") view.innerHTML = `<section class="mid-row-grid cols-2"><div id="control-slot">${renderControl()}</div><div id="results-slot">${renderResults()}</div></section><div id="muni-slot">${renderMuni()}</div>`;
  else if (r === "municipalities") view.innerHTML = `<div id="muni-slot">${renderMuni()}</div>`;
  else if (r === "data-sources") view.innerHTML = pageDataSources();
  else if (r === "insights") view.innerHTML = pageInsights();
  else if (r === "reports") view.innerHTML = pageReports();
  else if (r === "settings") view.innerHTML = pageSettings();
  if ($("#map-slot")) mountMap();
}

// ------------------------------------------------------------------ events (delegated)
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || t.tagName === "INPUT" || t.tagName === "LABEL") return;
  const a = t.dataset.act;
  if (a === "open-source") openSource(t.dataset.id);
  else if (a === "sys-health") openSysHealth(t);
  else if (a === "last-update") openLastUpdate(t);
  else if (a === "scope-info") openScopeInfo(t);
  else if (a === "user-menu") openUserMenu(t);
  else if (a === "layers-menu") openLayerMenu(t);
  else if (a === "export-menu") openExportMenu(t);
  else if (a === "export") doExport(t.dataset.fmt);
  else if (a === "zoom-in") S.map?.zoomIn();
  else if (a === "zoom-out") S.map?.zoomOut();
  else if (a === "mode") {
    if (PREVIEW) return;
    S.view = { mode: t.dataset.mode, year: S.form.year };
    H.storeSet("session", "dt_view", S.view); // per-viewer only; the global default is set by Admin Save & Apply
    render();
  } else if (a === "year") {
    S.form.year = Number(t.dataset.year);
    S.view.year = S.form.year;
    document.querySelectorAll("#sim-year-pills .year-pill").forEach((b) => b.classList.toggle("active", b === t));
    markPending(); renderHeader();
  } else if (a === "run") runSimulation();
  else if (a === "reset") {
    if (S.result) syncFormFromResult(S.result); else if (S.scenarios[0]) applyScenarioDefaults(S.scenarios[0].id);
    S.invalid = {};
    rerenderControl(); markPending(); renderHeader();
    toast("Simulation inputs reset. No data was deleted.", "ok");
  } else if (a === "advanced") { S.advancedOpen = !S.advancedOpen; rerenderControl(); }
  else if (a === "open-muni") { e.stopPropagation(); openMunicipality(t.dataset.code); }
  else if (a === "open-risk") { e.stopPropagation(); openRiskDetail(t.dataset.code, t.dataset.cat); }
  else if (a === "open-cat") openCategory(t.dataset.cat);
  else if (a === "open-impact") { e.stopPropagation(); openImpact(t.dataset.id); }
  else if (a === "gauge" || a === "gauge-label") openGauge();
  else if (a === "methodology") openMethodology();
  else if (a === "back-regional") {
    closeDrawer();
    S.filter = { search: "", level: "all" };
    if (S.form.scope !== "dalarna") { S.form.scope = "dalarna"; S.map?.setScope("dalarna"); rerenderControl(); markPending(); } else renderMuniSlot();
  } else if (a === "refresh") { closePopover(); toast("Refreshing…", "info", 1500); S.overlayCache = {}; await loadAll(); }
  else if (a === "logout") { await post("/api/auth/logout", {}).catch(() => null); S.me = { user: null }; closePopover(); toast("Signed out.", "ok"); }
  else if (a === "reset-prefs") { S.prefs = {}; H.storeSet("local", "dt_prefs", {}); render(); toast("Personal settings reset.", "ok"); }
});

document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('.kpi-card[role="button"]')) { e.preventDefault(); openSource(e.target.dataset.id); }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("#sim-scenario")) {
    applyScenarioDefaults(t.value); S.invalid = {}; S.view.year = S.form.year;
    rerenderControl(); markPending(); renderHeader();
  } else if (t.matches("#sim-scope")) {
    S.form.scope = t.value; S.map?.setScope(t.value); markPending(); renderHeader();
  } else if (t.matches('[data-act="dep"]')) {
    const id = t.dataset.id;
    S.form.excluded = t.checked ? S.form.excluded.filter((x) => x !== id) : [...new Set([...S.form.excluded, id])];
    markPending();
  } else if (t.matches('[data-act="layer"]')) {
    S.layers[t.dataset.layer] = t.checked;
    refreshMap();
  } else if (t.matches("#map-risk-select")) {
    S.riskView = t.value; refreshMap();
  } else if (t.matches("#muni-filter")) { S.filter.level = t.value; renderMuniSlot(); }
  else if (t.matches("#pref-mode")) { S.prefs.defaultMode = t.value || undefined; H.storeSet("local", "dt_prefs", S.prefs); toast("Personal setting saved.", "ok"); }
  else if (t.matches("#pref-compact")) { S.prefs.compact = t.checked; H.storeSet("local", "dt_prefs", S.prefs); document.body.classList.toggle("compact", t.checked); }
});

function clearInvalid(k) {
  if (!S.invalid[k]) return;
  delete S.invalid[k];
  $(".num-wrap")?.classList.remove("invalid");
  document.querySelector(".field-error")?.remove();
}

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches("#pop-slider")) {
    S.form.pop = Number(t.value);
    const n = $("#pop-number"); if (n) n.value = t.value;
    clearInvalid("pop"); markPending();
  } else if (t.matches("#pop-number")) {
    S.form.pop = t.value === "" ? "" : Number(t.value);
    const ok = t.value !== "" && Number(t.value) >= POP_MIN && Number(t.value) <= POP_MAX;
    const sl = $("#pop-slider"); if (sl && ok) sl.value = t.value;
    if (ok) clearInvalid("pop");
    markPending();
  } else if (t.matches(".drv-input")) {
    S.form.drivers[t.dataset.driver] = t.value === "" ? "" : Number(t.value);
    markPending();
  } else if (t.matches("#muni-search")) {
    S.filter.search = t.value;
    const pos = t.selectionStart;
    renderMuniSlot();
    const n = $("#muni-search"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  }
});

window.addEventListener("hashchange", render);

// ------------------------------------------------------------------ Admin Preview protocol
window.addEventListener("message", (e) => {
  if (!PREVIEW || e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type !== "preview-state") return;
  S.pending = d.state || null;
  S.saved = d.saved || null;
  if (d.result) { S.result = d.result; syncFormFromResult(d.result); }
  if (S.pending) {
    S.layers = { ...H.deepClone(S.pending.layers || {}) };
    if (S.pending.scope) S.form.scope = S.pending.scope;
    if (!d.result && S.pending.active_scenario && S.scenarios.some((s) => s.id === S.pending.active_scenario)) applyScenarioDefaults(S.pending.active_scenario);
    if (!d.result && S.pending.simulation_year) S.form.year = S.pending.simulation_year;
  }
  S.view = d.view || { mode: S.pending?.mode || "live", year: S.pending?.simulation_year || S.form.year };
  S.overlayCache = {};
  render();
});

// ------------------------------------------------------------------ boot
(async function boot() {
  render();
  await loadAll();
  if (PREVIEW) window.parent?.postMessage({ type: "preview-ready" }, location.origin);
  if (!PREVIEW) setInterval(() => { if (!S.running && !document.getElementById("drawer")) loadAll(); }, 60000);
})();
