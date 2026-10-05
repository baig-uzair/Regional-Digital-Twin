// Main Interface (stakeholder view). Renders ONLY backend state; also renders as the admin Preview (?preview=1)
// by taking its control state from the parent window via postMessage instead of the server.
import { get } from "./api.js";
import { DalarnaMap } from "./map.js";
import { esc, fmtDateTime, fmtInterval, fmtNum, openDrawer, relTime, statusBadge, toast } from "./util.js";

const PREVIEW = new URLSearchParams(location.search).get("preview") === "1";
const POLL_MS = 15000;
const ROUTES = ["overview", "map", "simulation", "municipalities", "data-sources", "insights", "reports", "settings"];
const LAYER_LABELS = { boundaries: "Municipality boundaries", population: "Population", weather: "Weather", roads: "Roads", water: "Water / geology", forest: "Forest", land: "Land parcels", simulation_risk: "Simulation risk" };

const S = {
  control: null, // last applied state from the server
  override: null, // pending state pushed by the admin Preview
  summary: null,
  munis: null,
  mapState: null,
  me: null,
  viewMode: null, // per-viewer Current/Simulation choice; reset whenever the admin applies a new version
  layerView: {}, // per-viewer layer toggles; same reset rule
  search: "",
  map: null,
  mapEl: null,
  mapPanel: null,
  loadedOnce: false,
};

const $ = (sel) => document.querySelector(sel);
const ctl = () => S.override || S.control;
const route = () => {
  const r = (location.hash.replace(/^#\/?/, "") || "overview").split("?")[0];
  return ROUTES.includes(r) ? r : "overview";
};
const compVisible = (name) => ctl()?.components?.[name] !== false;

// ---------------------------------------------------------------- data loading
async function loadAll() {
  try {
    const [control, summary, munis, mapState] = await Promise.all([
      PREVIEW ? Promise.resolve(S.control) : get("/api/control/state"),
      get("/api/datasources/summary"),
      get("/api/municipalities"),
      get("/api/control/map-state"),
    ]);
    const versionChanged = S.control && control && control.version !== S.control.version;
    if (versionChanged) {
      S.viewMode = null;
      S.layerView = {};
    }
    // Re-render only when something visible changed, so polling never steals focus or closes menus.
    const sig = JSON.stringify([
      control?.version,
      summary.sources.map((x) => [x.id, x.status, x.enabled, x.last_success_at, x.last_attempt_at, x.headline]),
      munis.municipalities.map((m) => m.population),
      mapState.layers,
      S.override,
    ]);
    const changed = sig !== S.sig;
    S.sig = sig;
    if (control) S.control = control;
    S.summary = summary;
    S.munis = munis;
    S.mapState = mapState;
    S.loadedOnce = true;
    if (changed) render();
  } catch (e) {
    toast(S.loadedOnce ? "Unable to retrieve the latest data. Showing last available data." : `Unable to load the dashboard: ${e.message}`, "error");
    if (!S.loadedOnce) $("#view").innerHTML = `<div class="panel empty">The dashboard could not be loaded. ${esc(e.message)}</div>`;
  }
}

async function pollState() {
  if (PREVIEW || document.hidden || localStorage.getItem("dt.autorefresh") === "off") return;
  loadAll();
}

// ---------------------------------------------------------------- derived values
function effectiveSources() {
  const flags = ctl()?.sources || {};
  return (S.summary?.sources || []).map((s) => {
    const enabled = flags[s.id] ?? s.enabled;
    if (enabled === s.enabled) return s;
    // Preview of an unsaved change: show it as pending, never as if it were already applied.
    return enabled
      ? { ...s, enabled, pending: true, status: s.status === "disabled" ? "pending" : s.status, status_label: s.status === "disabled" ? "Pending ON" : s.status_label }
      : { ...s, enabled, pending: true, status: "disabled", status_label: "Disabled (pending)", message: "Will be turned off after Save & Apply." };
  });
}

function effectiveMode() {
  return S.viewMode || ctl()?.mode || "live";
}

function currentYear() {
  return S.munis?.data_year ?? null;
}

function layerState(id) {
  const base = S.mapState?.layers?.[id];
  const visible = S.layerView[id] ?? ctl()?.layers?.[id] ?? false;
  if (!base) return { visible, available: false, source: null, reason: "" };
  let available = base.available;
  if (id !== "boundaries" && id !== "simulation_risk" && S.override && base.source) {
    available = !!ctl().sources[base.source] && base.reason !== "Source is not configured";
  }
  if (id === "simulation_risk") available = false; // no simulation result exists yet in this build
  return { visible, available, source: base.source, reason: base.reason };
}

function scopeLabel() {
  const sc = ctl()?.scope;
  if (!sc || sc === "dalarna") return "Dalarna, Sweden";
  return `${S.munis?.municipalities?.find((m) => m.code === sc)?.name || sc}, Dalarna`;
}

// ---------------------------------------------------------------- header + banner
function renderHeader() {
  const sum = S.summary;
  const online = sum?.online_count ?? 0;
  const total = sum?.total ?? 0;
  const dot = !sum ? "" : online === total ? "ok" : online === 0 ? "bad" : "warn";
  const title = !sum ? "Loading…" : online === total ? "System Online" : online === 0 ? "No source online" : "Partially online";
  const mode = effectiveMode();
  const yr = currentYear();
  const simYear = ctl()?.simulation_year;
  $("#header").innerHTML = `
    <div><h1>DALARNA REGIONAL DIGITAL TWIN</h1><div class="muted small">Multi-source data and scenario simulation · decision support</div></div>
    <div class="hdr-right">
      <button class="hdr-chip" data-action="health" aria-label="Open source health summary"><span class="dot ${dot}"></span><span><b>${esc(title)}</b><br><span class="small muted">${online}/${total} data sources online</span></span></button>
      <button class="hdr-chip" data-action="updates" aria-label="Open update details"><span><span class="small muted">Last update</span><br><b>${esc(fmtDateTime(sum?.last_update))}</b></span></button>
      <div class="hdr-chip"><span>${esc(scopeLabel())}</span></div>
      <div class="seg" role="group" aria-label="Data mode">
        <button data-action="mode" data-mode="live" class="${mode === "live" ? "on" : ""}" aria-pressed="${mode === "live"}">Current${yr ? ` (${yr})` : ""}</button>
        <button data-action="mode" data-mode="simulation" class="${mode === "simulation" ? "on" : ""}" aria-pressed="${mode === "simulation"}">Simulation${simYear ? ` (${simYear})` : ""}</button>
      </div>
      <div class="menu"><button class="hdr-chip" data-action="user" aria-haspopup="true" aria-label="User menu">${esc(S.me?.user ? S.me.user : "Guest")} ▾</button><div class="menu-pop hidden" id="user-pop"></div></div>
    </div>`;
}

function renderBanner() {
  const el = $("#banner");
  if (effectiveMode() !== "simulation") {
    el.innerHTML = "";
    return;
  }
  const y = ctl()?.simulation_year;
  el.innerHTML = `<div class="sim-banner" role="status">SIMULATION MODE${y ? ` · target year ${esc(y)}` : ""} — scenario output, not measured data. No simulation result is available yet in this build; the figures below remain current (live) data.</div>`;
}

// ---------------------------------------------------------------- source cards
function headlineHtml(s) {
  const h = s.headline;
  if (s.status === "not_configured") return `<div class="sub">Not configured — credentials missing</div>`;
  if (s.status === "disabled") return `<div class="sub">Disabled · stored data kept</div>`;
  if (!h) return `<div class="sub">No data yet</div>`;
  const origin = s.data_origin === "fallback" || h.origin === "fallback" ? ' <span class="tag fallback">fallback data</span>' : "";
  if (s.id === "smhi") return `<div class="big">${esc(Number(h.temperature_c).toFixed(1))} °C</div><div class="sub">observed ${esc(relTime(h.observed_at))}</div>`;
  if (s.id === "scb") return `<div class="big">${esc(fmtNum(h.population_total))}</div><div class="sub">${esc(h.municipalities)} municipalities · ${esc(h.period || "")}${origin}</div>`;
  if (s.id === "trafikverket") return `<div class="big">${esc(fmtNum(h.stations))}</div><div class="sub">road weather stations</div>`;
  return `<div class="big">${esc(fmtNum(h.records))}</div><div class="sub">stored features${origin}</div>`;
}

function renderCards() {
  if (!compVisible("source_cards")) return "";
  const cards = effectiveSources()
    .map(
      (s) => `<button class="src-card ${s.enabled ? "" : "disabled"}" data-action="source" data-id="${esc(s.id)}" aria-label="Open ${esc(s.name)} details">
        <div><span class="name">${esc(s.name)}</span> <span class="cat">${esc(s.category)}</span></div>
        <div>${statusBadge(s.status, s.status_label)}</div>
        ${headlineHtml(s)}
        <div class="sub">${s.last_success_at ? "Updated " + esc(relTime(s.last_success_at)) : ""}</div>
      </button>`
    )
    .join("");
  return `<section aria-label="Data sources" class="cards">${cards || '<div class="panel empty">No sources registered.</div>'}</section>`;
}

// ---------------------------------------------------------------- map panel
function ensureMap() {
  if (S.map) return;
  S.mapEl = document.createElement("div");
  S.mapEl.id = "map-host";
  S.map = new DalarnaMap(S.mapEl, {
    onMunicipalityClick: (code, lngLat) => {
      const m = S.munis?.municipalities?.find((x) => x.code === code);
      if (!m) return;
      const p = m.population;
      const pop = p ? `${esc(fmtNum(p.value))} (${esc(p.period || "?")})${p.origin === "fallback" ? ' <i>fallback data</i>' : ""}` : "no data";
      S.map.showMunicipalityPopup(lngLat, `<b>${esc(m.name)}</b><div>Population: ${pop}</div><div class="small muted">Risk values appear after a simulation is run.</div>`);
    },
  });
  S.map.ready.catch((e) => toast(`Map unavailable: ${e.message}`, "error"));
}

function mapPanelHtml(tall) {
  if (!compVisible("map")) return "";
  const rows = Object.keys(LAYER_LABELS)
    .map((id) => {
      const st = layerState(id);
      const note = !st.available && id !== "boundaries" ? ` <span class="small muted">(${esc(id === "simulation_risk" ? "no simulation result yet" : st.reason || "unavailable")})</span>` : "";
      return `<label class="layer-row ${st.available ? "" : "na"}"><input type="checkbox" data-layer="${id}" ${st.visible ? "checked" : ""} ${st.available ? "" : "disabled"}> ${esc(LAYER_LABELS[id])}${note}</label>`;
    })
    .join("");
  return `<section class="panel map-panel" aria-label="Map">
    <div class="map-head"><h2>Dalarna — ${esc(layerState("population").visible ? "Population" : "Municipalities")}</h2><span class="small muted">Click a municipality for details</span></div>
    <div class="map-slot ${tall ? "tall" : ""}" id="map-slot">
      <div class="layer-menu menu"><button class="btn small" data-action="layers" aria-haspopup="true">Layers</button><div class="menu-pop hidden" id="layer-pop">${rows}</div></div>
    </div></section>`;
}

function mountMap() {
  const slot = $("#map-slot");
  if (!slot) return;
  ensureMap();
  slot.prepend(S.mapEl);
  S.map.ready
    .then(async () => {
      S.map.resize();
      await S.map.setMunicipalityData(S.munis?.municipalities || []);
      S.map.setPopulationVisible(layerState("population").visible && layerState("population").available);
      S.map.setBoundariesVisible(layerState("boundaries").visible);
      const overlays = {};
      for (const id of ["weather", "roads", "water", "forest", "land"]) overlays[id] = layerState(id);
      await S.map.setOverlays(overlays);
      await S.map.setScope(ctl()?.scope || "dalarna");
    })
    .catch(() => {});
}

// ---------------------------------------------------------------- municipalities
function populationTotal() {
  const list = S.munis?.municipalities || [];
  const vals = list.map((m) => m.population?.value);
  if (!list.length || vals.some((v) => typeof v !== "number")) return null;
  return vals.reduce((a, b) => a + b, 0);
}

function populationWidget() {
  if (!compVisible("population")) return "";
  const total = populationTotal();
  const fb = (S.munis?.municipalities || []).some((m) => m.population?.origin === "fallback");
  const yr = currentYear();
  return `<section class="panel" aria-label="Population"><h2>Population — Dalarna${yr ? ` (${yr})` : ""}</h2>
    <div class="stat-big">${total == null ? "No data" : esc(fmtNum(total))}</div>
    <div class="small muted">Current population from SCB${fb ? ' <span class="tag fallback">fallback data</span>' : ' <span class="tag live">live</span>'}</div>
    ${fb ? '<div class="small muted" style="margin-top:6px">SCB could not be reached; these are static reference values, not fetched live.</div>' : ""}</section>`;
}

function filteredMunis() {
  let list = S.munis?.municipalities || [];
  const scope = ctl()?.scope;
  if (scope && scope !== "dalarna") list = list.filter((m) => m.code === scope);
  const q = S.search.trim().toLowerCase();
  if (q) list = list.filter((m) => m.name.toLowerCase().includes(q));
  return [...list].sort((a, b) => (b.population?.value ?? -1) - (a.population?.value ?? -1));
}

function muniRows() {
  const list = filteredMunis();
  if (!list.length) return `<tr><td colspan="5" class="empty">No municipality found.</td></tr>`;
  return list
    .map(
      (m, i) => `<tr data-action="muni-row" data-code="${esc(m.code)}">
      <td>${i + 1}</td><td>${esc(m.name)}</td>
      <td class="num">${m.population ? esc(fmtNum(m.population.value)) : '<span class="muted">no data</span>'}</td>
      <td>${m.population ? `${esc(m.population.period || "")} ${m.population.origin === "fallback" ? '<span class="tag fallback">fallback</span>' : '<span class="tag live">live</span>'}` : ""}</td>
      <td><button class="btn small" data-action="muni-view" data-code="${esc(m.code)}" aria-label="View ${esc(m.name)}">View</button></td></tr>`
    )
    .join("");
}

function muniTable() {
  if (!compVisible("municipality_table")) return "";
  const yr = currentYear();
  return `<section class="panel" aria-label="Municipalities"><div class="tbl-head"><h2>Municipalities — current population${yr ? ` (${yr})` : ""}</h2>
    <input type="search" id="muni-search" placeholder="Search municipality…" value="${esc(S.search)}" aria-label="Search municipality"></div>
    <div style="overflow:auto"><table><thead><tr><th>#</th><th>Municipality</th><th class="num">Population</th><th>Period / source data</th><th>Details</th></tr></thead>
    <tbody id="muni-body">${muniRows()}</tbody></table></div></section>`;
}

function openMunicipality(code) {
  const m = S.munis?.municipalities?.find((x) => x.code === code);
  if (!m) return;
  const p = m.population;
  openDrawer(`<h2>${esc(m.name)}</h2><div class="muted small">Municipality code ${esc(m.code)}</div>
    <dl class="kv" style="margin-top:14px">
      <dt>Population (current)</dt><dd>${p ? `${esc(fmtNum(p.value))} · ${esc(p.period || "")}` : "no data"}</dd>
      <dt>Data origin</dt><dd>${p ? (p.origin === "fallback" ? '<span class="tag fallback">fallback data — not fetched live</span>' : '<span class="tag live">live</span>') : "—"}</dd>
      <dt>Simulated population</dt><dd><span class="muted">No simulation result yet</span></dd>
      <dt>Risk values</dt><dd><span class="muted">Calculated after a simulation is run (not available yet)</span></dd>
      <dt>Contributing sources</dt><dd>SCB (population)</dd>
      <dt>Map location</dt><dd>${esc(m.centroid[1].toFixed(3))}° N, ${esc(m.centroid[0].toFixed(3))}° E</dd>
    </dl>`);
}

// ---------------------------------------------------------------- source drawer
function openSource(id) {
  const s = effectiveSources().find((x) => x.id === id);
  if (!s) return;
  const h = s.headline || {};
  const headRows = Object.entries(h)
    .map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(/_at$|latest_fetch/.test(k) ? fmtDateTime(v) : typeof v === "number" ? fmtNum(v) : v)}</dd>`)
    .join("");
  const missing = s.missing_config?.length ? `<dt>Missing configuration</dt><dd>${s.missing_config.map(esc).join(", ")}</dd>` : "";
  let extra = "";
  if (id === "scb") {
    extra = `<h3 style="margin-top:12px">Population by municipality</h3><table><tbody>${(S.munis?.municipalities || [])
      .map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${m.population ? esc(fmtNum(m.population.value)) : "no data"}</td></tr>`)
      .join("")}</tbody></table>`;
  }
  openDrawer(`<h2>${esc(s.name)}</h2><div class="muted small">${esc(s.category)}</div>
    <p>${esc(s.description)}</p><div>${statusBadge(s.status, s.status_label)}</div><p class="small">${esc(s.message)}</p>
    <dl class="kv"><dt>Last successful update</dt><dd>${esc(fmtDateTime(s.last_success_at))}</dd>
      <dt>Last attempt</dt><dd>${esc(fmtDateTime(s.last_attempt_at))}</dd>
      <dt>Update interval</dt><dd>${esc(fmtInterval(s.interval_seconds))}</dd>
      <dt>Stale after</dt><dd>${esc(fmtInterval(s.freshness_seconds))}</dd>
      <dt>Data origin</dt><dd>${esc(s.data_origin || "—")}</dd>${missing}${headRows}</dl>
    ${s.last_error ? `<div class="small" style="color:#fca5a5">Last error: ${esc(s.last_error)}</div>` : ""}${extra}`);
}

// ---------------------------------------------------------------- pages
function pageOverview() {
  const left = `${mapPanelHtml(false)}`;
  const right = `<div class="side-col">${populationWidget()}</div>`;
  const hasRight = compVisible("population");
  return `${renderCards()}${left || right ? `<div class="${hasRight && left ? "grid-2" : ""}">${left}${hasRight ? right : ""}</div>` : ""}${muniTable()}`;
}

function pageDataSources() {
  const rows = effectiveSources()
    .map(
      (s) => `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.category)}</div></td><td>${statusBadge(s.status, s.status_label)}</td>
      <td>${esc(fmtDateTime(s.last_success_at))}</td><td>${esc(fmtInterval(s.interval_seconds))}</td><td class="small">${esc(s.message)}</td>
      <td><button class="btn small" data-action="source" data-id="${esc(s.id)}">Details</button></td></tr>`
    )
    .join("");
  return `<section class="panel"><h2>Data sources</h2><p class="muted small">Status is computed from real fetch results. Sources are turned on/off in the Admin Control Panel.</p>
    <div style="overflow:auto"><table><thead><tr><th>Source</th><th>Status</th><th>Last successful update</th><th>Interval</th><th>Message</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function pageSettings() {
  const on = localStorage.getItem("dt.autorefresh") !== "off";
  return `<section class="panel"><h2>Settings</h2><p class="muted small">Personal, non-destructive settings for this browser. Dashboard configuration lives in the <a href="/admin">Admin Control Panel</a>.</p>
    <label class="layer-row"><span class="switch"><input type="checkbox" id="set-autorefresh" ${on ? "checked" : ""}><span class="track"></span></span> Refresh data every 15 seconds</label></section>`;
}

function pageUnavailable(title, what) {
  return `<section class="panel"><h2>${esc(title)}</h2><div class="empty">${esc(what)} is not available in this build yet.</div></section>`;
}

function renderView() {
  const r = route();
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === r));
  let html;
  if (PREVIEW) html = pageOverview();
  else if (r === "overview") html = pageOverview();
  else if (r === "map") html = `${mapPanelHtml(true)}`;
  else if (r === "municipalities") html = muniTable();
  else if (r === "data-sources") html = pageDataSources();
  else if (r === "settings") html = pageSettings();
  else if (r === "simulation") html = pageUnavailable("Simulation", "The scenario workspace");
  else if (r === "insights") html = pageUnavailable("Insights", "Generated insights");
  else html = pageUnavailable("Reports", "Reports");
  $("#view").innerHTML = html || `<div class="panel empty">Everything on this page is hidden by the dashboard configuration.</div>`;
  mountMap();
}

function render() {
  if (!S.control) return;
  renderHeader();
  renderBanner();
  renderView();
}

// ---------------------------------------------------------------- events
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) {
    document.querySelectorAll(".menu-pop").forEach((p) => p.classList.add("hidden"));
    return;
  }
  const a = t.dataset.action;
  if (a === "mode") {
    S.viewMode = t.dataset.mode;
    render();
  } else if (a === "source") openSource(t.dataset.id);
  else if (a === "muni-view") {
    e.stopPropagation();
    openMunicipality(t.dataset.code);
  } else if (a === "muni-row") openMunicipality(t.dataset.code);
  else if (a === "layers") {
    e.stopPropagation();
    $("#layer-pop")?.classList.toggle("hidden");
  } else if (a === "user") {
    e.stopPropagation();
    const pop = $("#user-pop");
    pop.innerHTML = S.me?.user
      ? `<a href="/admin">Admin panel</a><button data-action="logout">Log out</button>`
      : `<a href="/login?next=/admin">Admin login</a>`;
    pop.classList.toggle("hidden");
  } else if (a === "logout") {
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).then(() => {
      S.me = { user: null };
      render();
    });
  } else if (a === "health") {
    openDrawer(`<h2>System health</h2><p class="muted small">${S.summary?.online_count}/${S.summary?.total} sources online</p>
      ${effectiveSources().map((s) => `<div style="margin:10px 0">${statusBadge(s.status, s.status_label)} <b>${esc(s.name)}</b><div class="small muted">${esc(s.message)}</div></div>`).join("")}`);
  } else if (a === "updates") {
    openDrawer(`<h2>Latest updates</h2>${effectiveSources().map((s) => `<dl class="kv"><dt>${esc(s.name)}</dt><dd>${esc(fmtDateTime(s.last_success_at))}${s.last_success_at ? ` · ${esc(relTime(s.last_success_at))}` : ""}</dd></dl>`).join("")}`);
  }
});

document.addEventListener("change", (e) => {
  const cb = e.target.closest("input[data-layer]");
  if (cb) {
    S.layerView[cb.dataset.layer] = cb.checked;
    mountMapState();
  }
  if (e.target.id === "set-autorefresh") localStorage.setItem("dt.autorefresh", e.target.checked ? "on" : "off");
});

document.addEventListener("input", (e) => {
  if (e.target.id === "muni-search") {
    S.search = e.target.value;
    $("#muni-body").innerHTML = muniRows();
  }
});

function mountMapState() {
  if (!S.map) return;
  S.map.ready.then(async () => {
    S.map.setPopulationVisible(layerState("population").visible && layerState("population").available);
    S.map.setBoundariesVisible(layerState("boundaries").visible);
    const overlays = {};
    for (const id of ["weather", "roads", "water", "forest", "land"]) overlays[id] = layerState(id);
    await S.map.setOverlays(overlays);
  });
}

window.addEventListener("hashchange", () => {
  document.querySelectorAll(".menu-pop").forEach((p) => p.classList.add("hidden"));
  if (S.control) renderView();
});

if (PREVIEW) {
  $("#app").classList.add("preview");
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.data?.type !== "preview-state") return;
    S.override = e.data.state;
    S.control = S.control || { ...e.data.state, version: e.data.savedVersion };
    S.viewMode = null;
    S.layerView = {};
    loadAll();
  });
  window.parent.postMessage({ type: "preview-ready" }, location.origin);
}

(async function start() {
  if (!PREVIEW) {
    try {
      S.me = await get("/api/auth/me");
    } catch (_) {
      S.me = { user: null };
    }
    await loadAll();
    setInterval(pollState, POLL_MS);
  }
})();
