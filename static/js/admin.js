// Admin Control Panel. Edits a PENDING copy of the control state in the browser; Save & Apply is the single
// commit (POST /api/control/apply with the base version). The Preview iframe is the real Main Interface
// rendering the pending state, so what you see is what stakeholders will see after Apply.
import { ApiError, get, post } from "./api.js";
import { esc, fmtDateTime, fmtInterval, relTime, statusBadge, toast } from "./util.js";

const TABS = [
  ["overview", "Overview"],
  ["control", "Dashboard Control"],
  ["sources", "Data Sources"],
  ["map", "Map & Regions"],
  ["appearance", "Appearance"],
  ["system", "System"],
];
const LAYERS = [
  ["boundaries", "Municipality boundaries"],
  ["population", "Population"],
  ["weather", "Weather (SMHI)"],
  ["roads", "Roads / traffic (Trafikverket)"],
  ["water", "Water / geology (SGU)"],
  ["forest", "Forest (Skogsstyrelsen)"],
  ["land", "Land parcels (Lantmäteriet)"],
  ["simulation_risk", "Simulation risk overlay"],
];
// Only components the Main Interface actually renders in this build get a switch.
const COMPONENTS = [
  ["source_cards", "Source cards", "Shows the data-source status cards."],
  ["population", "Population", "Shows the population widget."],
  ["municipality_table", "Municipality table", "Shows the 15-municipality table."],
  ["map", "Map", "Shows the Dalarna map."],
];
const INTERVALS = [300, 900, 1800, 3600, 21600, 86400];

const A = { saved: null, pending: null, summary: null, munis: null, health: null, tab: "overview", busy: false };
const $ = (s) => document.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const META = ["version", "applied_at", "applied_by", "changed", "unchanged"]; // response metadata, not state
const stateOnly = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !META.includes(k)));

function diffPaths(a, b, prefix = "") {
  const out = [];
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[k];
    const y = b?.[k];
    if (x && y && typeof x === "object" && typeof y === "object") out.push(...diffPaths(x, y, `${prefix}${k}.`));
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${prefix}${k}`);
  }
  return out;
}
const dirtyPaths = () => (A.saved && A.pending ? diffPaths(stateOnly(A.saved), A.pending) : []);
const isChanged = (path) => dirtyPaths().includes(path);
const chg = (path) => (isChanged(path) ? "changed" : "");

// ---------------------------------------------------------------- loading
async function loadSaved() {
  const [saved, summary, munis] = await Promise.all([get("/api/control/state"), get("/api/datasources/summary"), get("/api/municipalities")]);
  A.saved = saved;
  A.pending = clone(stateOnly(saved));
  A.summary = summary;
  A.munis = munis;
}

async function refreshLive() {
  try {
    [A.summary, A.munis] = await Promise.all([get("/api/datasources/summary"), get("/api/municipalities")]);
    if (A.tab === "overview" || A.tab === "sources") renderTab();
  } catch (_) { /* keep last */ }
}

// ---------------------------------------------------------------- preview sync
let previewReady = false;
function pushPreview() {
  const frame = $("#preview");
  if (!previewReady || !frame?.contentWindow || !A.pending) return;
  frame.contentWindow.postMessage({ type: "preview-state", state: clone(A.pending), savedVersion: A.saved.version }, location.origin);
}
window.addEventListener("message", (e) => {
  if (e.origin === location.origin && e.data?.type === "preview-ready") {
    previewReady = true;
    pushPreview();
  }
});

// ---------------------------------------------------------------- global bar
function renderBar() {
  const n = dirtyPaths().length;
  $("#globalbar").innerHTML = `
    <div class="seg" role="group" aria-label="Dashboard mode">
      <button data-act="mode" data-mode="live" class="${A.pending.mode === "live" ? "on" : ""}" aria-pressed="${A.pending.mode === "live"}">Live</button>
      <button data-act="mode" data-mode="simulation" class="${A.pending.mode === "simulation" ? "on" : ""}" aria-pressed="${A.pending.mode === "simulation"}">Simulation</button>
    </div>
    <span class="small muted">Saved version <b>${esc(A.saved.version)}</b> · ${esc(fmtDateTime(A.saved.applied_at))} by ${esc(A.saved.applied_by)}</span>
    <span class="spacer"></span>
    <span class="${n ? "dirty-note" : "clean-note"}" role="status">${n ? `${n} unsaved change${n > 1 ? "s" : ""}` : "No unsaved changes"}</span>
    <button class="btn" data-act="refresh-preview">Refresh Preview</button>
    <button class="btn" data-act="reset" ${n ? "" : "disabled"}>Reset</button>
    <button class="btn primary" data-act="apply" ${n && !A.busy ? "" : "disabled"}>${A.busy ? "Applying…" : "Save &amp; Apply"}</button>`;
}

// ---------------------------------------------------------------- tabs
function renderTabs() {
  $("#tabs").innerHTML = TABS.map(([id, label]) => `<button role="tab" data-act="tab" data-tab="${id}" class="${A.tab === id ? "on" : ""}" aria-selected="${A.tab === id}">${esc(label)}</button>`).join("");
}

function sw(checked, attrs, label = "") {
  return `<label class="switch" ${label ? `aria-label="${esc(label)}"` : ""}><input type="checkbox" ${checked ? "checked" : ""} ${attrs}><span class="track"></span></label>`;
}

function scopeSelect() {
  const opts = [`<option value="dalarna" ${A.pending.scope === "dalarna" ? "selected" : ""}>All Dalarna (15 municipalities)</option>`].concat(
    (A.munis?.municipalities || []).map((m) => `<option value="${esc(m.code)}" ${A.pending.scope === m.code ? "selected" : ""}>${esc(m.name)}</option>`)
  );
  return `<select data-act="scope" aria-label="Scope">${opts.join("")}</select>`;
}

const TAB_RENDER = {
  overview() {
    const s = A.summary;
    const rows = s.sources
      .map((x) => `<div class="row"><div class="grow"><b>${esc(x.name)}</b> <span class="small muted">${esc(x.category)}</span><div class="small muted">${esc(x.message)}</div></div>${statusBadge(x.status, x.status_label)}<span class="small muted" style="min-width:90px;text-align:right">${esc(relTime(x.last_success_at))}</span></div>`)
      .join("");
    return `<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="small muted">Live dashboard version</div><div class="v">${esc(A.saved.version)}</div></div>
        <div class="kpi"><div class="small muted">Mode</div><div class="v">${esc(A.saved.mode)}</div></div>
        <div class="kpi"><div class="small muted">Scope</div><div class="v">${A.saved.scope === "dalarna" ? "All Dalarna" : esc(A.munis.municipalities.find((m) => m.code === A.saved.scope)?.name || A.saved.scope)}</div></div>
        <div class="kpi"><div class="small muted">Sources online</div><div class="v">${s.online_count}/${s.total}</div></div>
      </div>
      <section class="panel"><h2>Source health</h2>${rows}</section></div>`;
  },

  control() {
    return `<section class="panel"><h2>Dashboard Control</h2>
      <div class="row"><div class="grow"><b class="${chg("mode")}">Mode</b><div class="small muted">Live shows current source data. Simulation switches the dashboard to scenario output (no scenario exists yet in this build).</div></div>
        <span class="tag ${A.pending.mode === "live" ? "live" : "sim"}">${esc(A.pending.mode)}</span><span class="small muted">use the toggle in the top bar</span></div>
      <div class="row"><div class="grow"><b class="${chg("scope")}">Scope</b><div class="small muted">All Dalarna, or focus map and table on one municipality.</div></div>${scopeSelect()}</div></section>`;
  },

  sources() {
    const rows = A.summary.sources
      .map((s) => {
        const on = A.pending.sources[s.id];
        const secs = A.pending.source_intervals[s.id];
        const opts = (INTERVALS.includes(secs) ? INTERVALS : [...INTERVALS, secs].sort((a, b) => a - b)).map((v) => `<option value="${v}" ${v === secs ? "selected" : ""}>${esc(fmtInterval(v))}</option>`).join("");
        return `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.category)}</div></td>
          <td>${sw(on, `data-act="src-toggle" data-id="${esc(s.id)}"`, `Enable ${s.name}`)}<span class="${chg(`sources.${s.id}`)}"></span></td>
          <td><select data-act="src-interval" data-id="${esc(s.id)}" aria-label="Update interval for ${esc(s.name)}">${opts}</select><span class="${chg(`source_intervals.${s.id}`)}"></span></td>
          <td>${statusBadge(s.status, s.status_label)}<div class="small muted" style="max-width:260px">${esc(s.message)}</div></td>
          <td class="small">${esc(relTime(s.last_success_at))}</td></tr>`;
      })
      .join("");
    return `<section class="panel"><h2>Data Sources</h2><p class="muted small">Turning a source off stops future fetches only; stored history is never deleted. Interval changes are used by the scheduler after Save &amp; Apply.</p>
      <div style="overflow:auto"><table><thead><tr><th>Source</th><th>Enabled</th><th>Update interval</th><th>Status</th><th>Last update</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  },

  map() {
    const rows = LAYERS.map(([id, label]) => `<div class="row"><div class="grow"><b>${esc(label)}</b><span class="${chg(`layers.${id}`)}"></span></div>${sw(A.pending.layers[id], `data-act="layer" data-id="${id}"`, label)}</div>`).join("");
    return `<section class="panel"><h2>Map &amp; Regions</h2>${rows}
      <div class="row"><div class="grow"><b class="${chg("scope")}">Municipality selector</b><div class="small muted">Same setting as Scope in Dashboard Control.</div></div>${scopeSelect()}</div></section>`;
  },

  appearance() {
    const rows = COMPONENTS.map(([id, label, help]) => `<div class="row"><div class="grow"><b>${esc(label)}</b><span class="${chg(`components.${id}`)}"></span><div class="small muted">${esc(help)}</div></div>${sw(A.pending.components[id], `data-act="component" data-id="${id}"`, label)}</div>`).join("");
    return `<section class="panel"><h2>Appearance</h2><p class="muted small">Presentation only: hidden components are not rendered, but no data is disabled or deleted.</p>${rows}</section>`;
  },

  system() {
    const h = A.health;
    if (!h) return `<section class="panel"><h2>System</h2><div class="empty">Loading…</div></section>`;
    const warn = [];
    if (!h.auth.session_secret_persistent) warn.push("SESSION_SECRET is not set: admins are logged out whenever the app restarts.");
    if (!h.auth.admin_login_configured) warn.push("Admin login is not configured.");
    const rows = h.sources.map((s) => `<div class="row"><div class="grow"><b>${esc(s.name)}</b><div class="small muted">${esc(s.last_error || s.message)}</div></div>${statusBadge(s.status, s.status_label)}</div>`).join("");
    return `<div class="stack">${warn.map((w) => `<div class="notice">${esc(w)}</div>`).join("")}
      <div class="kpis"><div class="kpi"><div class="small muted">Database</div><div class="v">${h.database.ok ? "OK" : "Down"}</div></div>
      <div class="kpi"><div class="small muted">Scheduler</div><div class="v">${h.scheduler.alive ? "Running" : "Stopped"}</div></div>
      <div class="kpi"><div class="small muted">Checked</div><div class="v small">${esc(fmtDateTime(h.time))}</div></div></div>
      <section class="panel"><h2>Sources</h2>${rows}</section>
      <div class="small muted">Monitoring and time series: <a id="grafana-link-2" href="#" target="_blank" rel="noopener">View in Grafana ↗</a></div></div>`;
  },
};

async function renderTab() {
  if (A.tab === "system" && !A.health) {
    try {
      A.health = await get("/api/system/health");
    } catch (e) {
      toast(e.message, "error");
    }
  }
  $("#tab").innerHTML = TAB_RENDER[A.tab]();
  const g = $("#grafana-link-2");
  if (g) g.href = grafanaUrl();
}

const grafanaUrl = () => `${location.protocol}//${location.hostname}:3000`;

function renderAll() {
  renderBar();
  renderTabs();
  renderTab();
  pushPreview();
}

// ---------------------------------------------------------------- actions
async function apply() {
  if (A.busy || !dirtyPaths().length) return;
  A.busy = true;
  renderBar();
  try {
    const res = await post("/api/control/apply", { base_version: A.saved.version, state: A.pending });
    A.saved = res;
    A.pending = clone(stateOnly(res));
    A.health = null;
    toast(res.unchanged ? "Nothing to apply." : `Applied as version ${res.version} (${res.changed.length} change${res.changed.length === 1 ? "" : "s"}): ${res.changed.join(", ")}`, "ok", 8000);
    await refreshLive();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      if (confirm(`The dashboard was changed by someone else (now version ${e.extra.current_version}).\n\nOK = discard your edits and load the latest.\nCancel = keep editing (Save will keep failing until you reload).`)) {
        await loadSaved();
      }
    } else if (e instanceof ApiError && e.status === 401) {
      location.href = "/login?next=/admin";
      return;
    } else {
      toast(e.details?.length ? e.details.map((d) => `${d.field}: ${d.message}`).join("; ") : e.message, "error", 8000);
    }
  } finally {
    A.busy = false;
    renderAll();
  }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || t.tagName === "SELECT" || t.tagName === "INPUT") return;
  const act = t.dataset.act;
  if (act === "tab") {
    A.tab = t.dataset.tab;
    renderTabs();
    renderTab();
  } else if (act === "mode") {
    A.pending.mode = t.dataset.mode;
    renderAll();
  } else if (act === "apply") apply();
  else if (act === "reset") {
    A.pending = clone(stateOnly(A.saved));
    renderAll();
    toast("Unsaved changes discarded.");
  } else if (act === "refresh-preview") {
    pushPreview();
    refreshLive();
    toast("Preview refreshed from the pending settings.");
  }
});

document.addEventListener("change", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  const id = t.dataset.id;
  if (act === "src-toggle") A.pending.sources[id] = t.checked;
  else if (act === "src-interval") A.pending.source_intervals[id] = Number(t.value);
  else if (act === "layer") A.pending.layers[id] = t.checked;
  else if (act === "component") A.pending.components[id] = t.checked;
  else if (act === "scope") A.pending.scope = t.value;
  else return;
  renderAll();
});

window.addEventListener("beforeunload", (e) => {
  if (!A.leaving && dirtyPaths().length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

$("#logout").addEventListener("click", async () => {
  if (dirtyPaths().length && !confirm("You have unsaved changes. Log out anyway?")) return;
  A.leaving = true;
  await post("/api/auth/logout", {});
  location.href = "/login";
});

(async function start() {
  $("#grafana-link").href = grafanaUrl();
  try {
    const me = await get("/api/auth/me");
    if (!me.user) {
      location.href = "/login?next=/admin";
      return;
    }
    $("#whoami").textContent = `Signed in as ${me.user}`;
    await loadSaved();
    renderAll();
    setInterval(refreshLive, 30000);
  } catch (e) {
    $("#tab").innerHTML = `<div class="panel empty">Could not load the admin panel: ${esc(e.message)}</div>`;
  }
})();
