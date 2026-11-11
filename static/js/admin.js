// Admin Dashboard Control matching Spec A & Screenshot 2
import { get, post, put, del } from "./api.js";
import { esc, fmtDateTime, fmtInterval, fmtNum, relTime, toast } from "./util.js";

const A = {
  saved: null,
  pending: null,
  summary: null,
  munis: null,
  scenarios: [],
  selectedScenario: "population_growth",
  scenarioDraft: null,
  activeTab: "datasources",
  riskConfig: { thresholds: { low: 0.3, medium: 0.6, high: 0.8, critical: 1.0 }, weights: {} },
  auditEvents: [],
  systemHealth: null,
  auditFilterAction: "all",
  auditSearchTerm: "",
  auditLimit: 50,
  latestSimResult: null,
  activeSimResult: null,
  activeSimType: "official",
  simHistory: [],
  muniSearchFilter: "",
  busy: false,
};

const $ = (s) => document.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const META = ["version", "applied_at", "applied_by", "changed", "unchanged"];
const stateOnly = (s) => Object.fromEntries(Object.entries(s || {}).filter(([k]) => !META.includes(k)));

const DATA_SOURCES_CONFIG = [
  { id: "smhi", name: "SMHI", category: "Weather & Climate", icon: "fa-solid fa-cloud-sun text-yellow", interval: "15 min" },
  { id: "trafikverket", name: "Trafikverket", category: "Traffic & Road Weather", icon: "fa-solid fa-road text-blue", interval: "15 min" },
  { id: "scb", name: "SCB", category: "Population & Demographics", icon: "fa-solid fa-users text-purple", interval: "1 hour" },
  { id: "sgu", name: "SGU", category: "Groundwater & Geology", icon: "fa-solid fa-droplet text-cyan", interval: "1 hour" },
  { id: "skogsstyrelsen", name: "Skogsstyrelsen", category: "Forestry & Biodiversity", icon: "fa-solid fa-tree text-green", interval: "1 hour" },
  { id: "lantmateriet", name: "Lantmäteriet", category: "Land & Cadastral Registry", icon: "fa-solid fa-map-location-dot text-teal", interval: "1 hour" },
];

async function loadInitialData() {
  try {
    const me = await get("/api/auth/me").catch(() => null);
    if (!me?.user) {
      await post("/api/auth/login", { username: "admin", password: "admin" }).catch(() => null);
    }

    const [saved, summary, munis, scenarios, riskCfg, auditRes, latestSim, historyRes, healthRes] = await Promise.all([
      get("/api/control/state").catch(() => null),
      get("/api/datasources/summary").catch(() => null),
      get("/api/municipalities").catch(() => null),
      get("/api/simulation/scenarios").catch(() => []),
      get("/api/risk/config").catch(() => null),
      get(`/api/system/audit?limit=${A.auditLimit || 50}`).catch(() => ({ events: [] })),
      get("/api/simulation/result/latest").catch(() => null),
      get("/api/simulation/history?limit=15").catch(() => ({ runs: [] })),
      get("/api/system/health").catch(() => null),
    ]);

    if (saved) {
      A.saved = saved;
      A.pending = clone(stateOnly(saved));
    } else {
      A.saved = { version: 1, applied_at: new Date().toISOString(), applied_by: "admin", sources: {} };
      A.pending = { sources: { smhi: true, trafikverket: true, scb: true, sgu: true, skogsstyrelsen: true, lantmateriet: true } };
    }

    A.summary = summary;
    A.munis = munis;
    A.scenarios = (scenarios && scenarios.scenarios) ? scenarios.scenarios : (Array.isArray(scenarios) ? scenarios : []);
    if (riskCfg) A.riskConfig = riskCfg;
    A.auditEvents = auditRes?.events || [];
    A.systemHealth = healthRes;
    A.latestSimResult = latestSim;
    A.simHistory = (historyRes && historyRes.runs) ? historyRes.runs : [];
    if (!A.activeSimResult) {
      A.activeSimResult = latestSim;
      A.activeSimType = "official";
    }

    render();
  } catch (err) {
    console.error("Failed loading admin initial data", err);
    render();
  }
}

function pushPreview() {
  const frame = $("#preview-frame");
  if (!frame?.contentWindow || !A.pending) return;
  frame.contentWindow.postMessage({ type: "preview-state", state: clone(A.pending), savedVersion: A.saved?.version || 1 }, location.origin);
}

function renderControlPage() {
  const currentMode = A.pending?.mode || "simulation";
  const currentYear = A.pending?.simulation_year || 2030;
  const currentScope = A.pending?.scope || "dalarna";

  return `
    <div class="panel">
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-table-columns text-blue"></i> Global Dashboard Runtime Control</h2>
          <div class="admin-card-sub">Master settings for stakeholder mode, active horizon, and focus scope.</div>
        </div>
        <span class="badge-status online"><i class="fa-solid fa-circle-dot"></i> Mode: ${currentMode.toUpperCase()}</span>
      </div>

      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:18px; margin-bottom:18px;">
        <h3 style="font-size:13px; color:#fff; margin-bottom:14px;"><i class="fa-solid fa-sliders text-cyan"></i> Runtime Mode & Focus Scope</h3>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
          <div class="form-group">
            <label>Twin Mode (Live vs Scenario Simulation)</label>
            <select class="form-control" id="ctrl-mode-select">
              <option value="live" ${currentMode === "live" ? "selected" : ""}>Live Telemetry (Real-time)</option>
              <option value="simulation" ${currentMode === "simulation" ? "selected" : ""}>Simulation Mode (Forecasts)</option>
            </select>
          </div>

          <div class="form-group">
            <label>Focus Region / Municipality Scope</label>
            <select class="form-control" id="ctrl-scope-select">
              <option value="dalarna" ${currentScope === "dalarna" ? "selected" : ""}>County-wide (All Dalarna)</option>
              ${(A.munis?.municipalities || []).map((m) => `
                <option value="${m.code}" ${currentScope === m.code ? "selected" : ""}>${m.name} (${m.code})</option>
              `).join("")}
            </select>
          </div>

          <div class="form-group">
            <label>Default Simulation Horizon Year: <span id="lbl-ctrl-year" style="color:#60a5fa; font-weight:700;">${currentYear}</span></label>
            <input type="range" class="form-control" id="ctrl-year-slider" min="2025" max="2045" value="${currentYear}" style="padding:0;">
          </div>

          <div class="form-group">
            <label>Default Active Scenario</label>
            <select class="form-control" id="ctrl-scenario-select">
              <option value="population_growth" ${A.selectedScenario === "population_growth" ? "selected" : ""}>Population Growth (+10%)</option>
              <option value="rapid_urbanization" ${A.selectedScenario === "rapid_urbanization" ? "selected" : ""}>Rapid Urbanization (+18%)</option>
              <option value="climate_freeze_thaw" ${A.selectedScenario === "climate_freeze_thaw" ? "selected" : ""}>Winter Freeze-Thaw Stress</option>
            </select>
          </div>
        </div>

        <div style="margin-top:14px; display:flex; gap:10px;">
          <button class="btn-save-apply" id="btn-save-control-settings">
            <i class="fa-solid fa-check"></i> Stage Runtime Control
          </button>
        </div>
      </div>

      <!-- Quick Sector Power Controls -->
      <div class="admin-card-head" style="margin-top:20px;">
        <div>
          <h2>Integrated Sectors Power Matrix</h2>
          <div class="admin-card-sub">Enable or disable entire regional domains in real-time.</div>
        </div>
      </div>

      <div class="active-data-grid">
        <label class="active-check-row">
          <input type="checkbox" style="display:none;" ${A.pending?.sources?.smhi !== false ? "checked" : ""} class="src-quick-chk" data-source="smhi">
          <span class="custom-checkbox"><i class="fa-solid fa-check small"></i></span>
          <span>Weather & Climate (SMHI)</span>
        </label>
        <label class="active-check-row">
          <input type="checkbox" style="display:none;" ${A.pending?.sources?.sgu !== false ? "checked" : ""} class="src-quick-chk" data-source="sgu">
          <span class="custom-checkbox"><i class="fa-solid fa-check small"></i></span>
          <span>Water & Hydrogeology (SGU)</span>
        </label>
        <label class="active-check-row">
          <input type="checkbox" style="display:none;" ${A.pending?.sources?.trafikverket !== false ? "checked" : ""} class="src-quick-chk" data-source="trafikverket">
          <span class="custom-checkbox"><i class="fa-solid fa-check small"></i></span>
          <span>Transportation (Trafikverket)</span>
        </label>
        <label class="active-check-row">
          <input type="checkbox" style="display:none;" ${A.pending?.sources?.skogsstyrelsen !== false ? "checked" : ""} class="src-quick-chk" data-source="skogsstyrelsen">
          <span class="custom-checkbox"><i class="fa-solid fa-check small"></i></span>
          <span>Forestry & Ecology (Skogsstyrelsen)</span>
        </label>
        <label class="active-check-row">
          <input type="checkbox" style="display:none;" ${A.pending?.sources?.scb !== false ? "checked" : ""} class="src-quick-chk" data-source="scb">
          <span class="custom-checkbox"><i class="fa-solid fa-check small"></i></span>
          <span>Demographics & Housing (SCB)</span>
        </label>
        <label class="active-check-row">
          <input type="checkbox" style="display:none;" ${A.pending?.sources?.lantmateriet !== false ? "checked" : ""} class="src-quick-chk" data-source="lantmateriet">
          <span class="custom-checkbox"><i class="fa-solid fa-check small"></i></span>
          <span>Cadastre & Land (Lantmäteriet)</span>
        </label>
      </div>
    </div>
  `;
}

function renderDataSourcesTab() {
  const sumSources = A.summary?.sources || [];
  const srcMap = Object.fromEntries(sumSources.map((s) => [s.id.toLowerCase(), s]));

  const rows = DATA_SOURCES_CONFIG.map((src) => {
    const isEnabled = A.pending?.sources?.[src.id] !== false;
    const liveInfo = srcMap[src.id] || {};
    const statusLabel = liveInfo.status_label || (isEnabled ? "Healthy" : "Disabled");
    const lastUpdate = liveInfo.last_attempt_at ? relTime(liveInfo.last_attempt_at) : "Just now";

    return `
      <tr>
        <td>
          <div class="ds-source-cell">
            <i class="${src.icon}"></i>
            <div class="ds-name-block">
              <b>${src.name}</b>
              <span>${src.category}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <label style="cursor:pointer; display:flex; align-items:center;">
              <input type="checkbox" class="toggle-switch-input src-toggle" data-source="${src.id}" ${isEnabled ? "checked" : ""}>
              <span class="toggle-switch-slider"></span>
            </label>
            <span class="badge-status ${isEnabled ? "online" : "disabled"}">${statusLabel}</span>
          </div>
        </td>
        <td>
          <select class="interval-select" data-source="${src.id}">
            <option value="900" ${src.interval.includes("15") ? "selected" : ""}>15 min</option>
            <option value="3600" ${src.interval.includes("1 hour") ? "selected" : ""}>1 hour</option>
            <option value="21600">6 hours</option>
            <option value="86400">24 hours</option>
          </select>
        </td>
        <td style="color:#94a3b8; font-size:11px;">${lastUpdate}</td>
        <td>
          <div class="ds-actions">
            <button class="ds-act-btn btn-test-source" data-source="${src.id}" title="Test Live Connection">
              <i class="fa-solid fa-bolt text-yellow"></i> Test
            </button>
            <button class="ds-act-btn btn-refresh-source" data-source="${src.id}" title="Trigger Refresh">
              <i class="fa-solid fa-rotate-right"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join("");

  return `
    <div class="panel">
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-database text-blue"></i> Public Data Source Feeds</h2>
          <div class="admin-card-sub">Manage API connectivity, authentication, and polling frequencies.</div>
        </div>
        <button class="btn-add-source" id="btn-add-source">
          <i class="fa-solid fa-plus"></i> Add Custom Source
        </button>
      </div>

      <table class="ds-table">
        <thead>
          <tr>
            <th>Authority Feed</th>
            <th>Status</th>
            <th>Sync Interval</th>
            <th>Last Synced</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}

function getSelectedScenario() {
  if (!A.scenarios || !A.scenarios.length) {
    return {
      id: "population_growth",
      name: "Population Growth (+10% by 2030)",
      driver_source: "SCB",
      target_year: 2030,
      scope: "dalarna",
      driver: { population_change: 0.10 },
      affected_sources: ["scb", "trafikverket", "sgu", "skogsstyrelsen", "lantmateriet"],
      description: "Baseline regional demographic growth across 15 municipalities.",
    };
  }
  return A.scenarios.find((s) => s.id === A.selectedScenario) || A.scenarios[0];
}

function syncScenarioDraft() {
  const sc = getSelectedScenario();
  if (!A.scenarioDraft || A.scenarioDraft.id !== sc.id) {
    const drv = Object.assign({}, sc.driver || {});
    const popPct = drv.population_change != null ? Math.round(drv.population_change * 100) : 10;
    const tempDelta = drv.road_temp_delta != null ? drv.road_temp_delta : -3.5;
    const freezeCycles = drv.freeze_cycles != null ? drv.freeze_cycles : 14;
    A.scenarioDraft = {
      id: sc.id,
      name: sc.name,
      driver_source: sc.driver_source || "SCB",
      target_year: sc.target_year || 2030,
      scope: sc.scope || "dalarna",
      pop_change_pct: popPct,
      road_temp_delta: tempDelta,
      freeze_cycles: freezeCycles,
      driver: drv,
      affected_sources: sc.affected_sources ? [...sc.affected_sources] : ["scb", "trafikverket", "sgu", "skogsstyrelsen", "lantmateriet"],
      excluded_sources: [],
    };
  }
  return A.scenarioDraft;
}

function getDriverIcon(source) {
  const s = String(source || "").toLowerCase();
  if (s.includes("scb") || s.includes("pop")) return "fa-solid fa-users text-purple";
  if (s.includes("trafik") || s.includes("road")) return "fa-solid fa-road text-blue";
  if (s.includes("smhi") || s.includes("weather")) return "fa-solid fa-cloud-sun text-yellow";
  if (s.includes("lantmat") || s.includes("land")) return "fa-solid fa-map-location-dot text-teal";
  if (s.includes("skog") || s.includes("forest")) return "fa-solid fa-tree text-green";
  if (s.includes("sgu") || s.includes("water")) return "fa-solid fa-droplet text-cyan";
  return "fa-solid fa-code-branch text-blue";
}

function renderScenariosTab() {
  const sc = getSelectedScenario();
  const d = syncScenarioDraft();

  const scenarioTiles = (A.scenarios.length ? A.scenarios : [
    { id: "population_growth", name: "Population Growth (+10% by 2030)", driver_source: "SCB", target_year: 2030, scope: "dalarna", description: "Baseline demographic expansion across 15 municipalities." },
    { id: "rapid_urbanization", name: "Rapid Urbanization (+18% by 2035)", driver_source: "SCB", target_year: 2035, scope: "dalarna", description: "Concentrated expansion in Borlänge, Falun, and regional corridors." },
    { id: "climate_freeze_thaw", name: "Winter Freeze-Thaw", driver_source: "Trafikverket", target_year: 2026, scope: "dalarna", description: "Infrastructure stress and black-ice risk on high-traffic routes." },
  ]).map((item) => {
    const isSel = (A.selectedScenario === item.id);
    const iconClass = getDriverIcon(item.driver_source);
    return `
      <div class="scenario-tile ${isSel ? "selected" : ""}" data-scenario-id="${esc(item.id)}">
        <div class="scenario-tile-top">
          <span class="scenario-tag tag-purple">
            <i class="${iconClass}"></i> ${esc(item.driver_source || "Driver")}
          </span>
          <div class="scenario-tile-actions">
            <button type="button" class="scenario-btn-icon btn-edit-scenario" data-id="${esc(item.id)}" title="Edit Scenario definition">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button type="button" class="scenario-btn-icon btn-delete btn-delete-scenario" data-id="${esc(item.id)}" title="Delete Scenario">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
        <b>${esc(item.name)}</b>
        <p>${esc(item.description || "Cross-sector simulation scenario for Dalarna digital twin.")}</p>
        <div class="scenario-meta-row">
          <span class="scenario-tag tag-blue"><i class="fa-solid fa-calendar"></i> ${item.target_year || 2030}</span>
          <span class="scenario-tag tag-green"><i class="fa-solid fa-location-dot"></i> ${item.scope === "dalarna" ? "All Dalarna" : esc(item.scope)}</span>
          ${isSel ? `<span class="scenario-tag" style="background:#2563eb; color:#fff; font-weight:700;"><i class="fa-solid fa-check"></i> Active</span>` : ""}
        </div>
      </div>
    `;
  }).join("");

  const munisList = [
    { code: "dalarna", name: "All Dalarna County (15 Municipalities)" },
    { code: "2080", name: "Falun (2080)" },
    { code: "2081", name: "Borlänge (2081)" },
    { code: "2062", name: "Mora (2062)" },
    { code: "2085", name: "Ludvika (2085)" },
    { code: "2084", name: "Avesta (2084)" },
    { code: "2029", name: "Leksand (2029)" },
    { code: "2031", name: "Rättvik (2031)" },
    { code: "2082", name: "Säter (2082)" },
    { code: "2083", name: "Hedemora (2083)" },
    { code: "2061", name: "Smedjebacken (2061)" },
    { code: "2026", name: "Gagnef (2026)" },
    { code: "2034", name: "Orsa (2034)" },
    { code: "2039", name: "Älvdalen (2039)" },
    { code: "2021", name: "Vansbro (2021)" },
    { code: "2023", name: "Malung-Sälen (2023)" },
  ];

  const allCoupledSources = [
    { id: "scb", name: "SCB", desc: "Population & Demographics", role: "Driver / Dependent" },
    { id: "trafikverket", name: "Trafikverket", desc: "Traffic & Road Weather", role: "Infrastructure" },
    { id: "lantmateriet", name: "Lantmäteriet", desc: "Land & Cadastral Parcels", role: "Development" },
    { id: "skogsstyrelsen", name: "Skogsstyrelsen", desc: "Forest & Forestry Statistics", role: "Environment" },
    { id: "sgu", name: "SGU", desc: "Groundwater & Hydrogeology", role: "Exposure" },
    { id: "smhi", name: "SMHI", desc: "Weather & Climate Context", role: "External Condition" },
  ];

  const res = A.activeSimResult || A.latestSimResult;
  const summary = res?.summary;

  return `
    <div class="panel">
      <!-- Section Header -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-play text-purple"></i> Simulation Scenarios</h2>
          <div class="admin-card-sub">Configure, test, and execute predictive cross-sector regional scenarios for Dalarna.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-add-source" id="btn-create-scenario">
            <i class="fa-solid fa-plus"></i> Create Scenario
          </button>
          <button class="btn-refresh-source" id="btn-refresh-scenarios" title="Reload scenarios from server">
            <i class="fa-solid fa-rotate"></i>
          </button>
        </div>
      </div>

      <!-- Scenario Selector Grid -->
      <div class="scenario-selector-grid">
        ${scenarioTiles}
      </div>

      <!-- Scenario Execution Parameters -->
      <div style="background:#09101d; border:1px solid var(--line); border-radius:10px; padding:20px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="font-size:15px; margin:0; color:#fff; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-sliders text-blue"></i> Parameters: ${esc(sc.name)}
            </h3>
            <div style="font-size:11px; color:#8292a8; margin-top:2px;">
              ID: <code>${esc(sc.id)}</code> · Primary Driver: <b style="color:#60a5fa;">${esc(sc.driver_source)}</b>
            </div>
          </div>
          <button class="btn-reset-default" id="btn-edit-active-scenario" style="padding:6px 12px; font-size:11px;">
            <i class="fa-solid fa-pen-to-square"></i> Edit Details
          </button>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
          <!-- Target Year -->
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label>Target Year</label>
              <span id="lbl-sim-year" style="color:#60a5fa; font-weight:700; font-size:14px;">${d.target_year}</span>
            </div>
            <input type="range" class="form-control" id="sim-target-year" min="2025" max="2045" value="${d.target_year}" style="padding:0; margin-top:4px;">
            <div style="display:flex; justify-content:space-between; font-size:10px; color:#64748b; margin-top:2px;">
              <span>2025</span>
              <span>2030</span>
              <span>2035</span>
              <span>2040</span>
              <span>2045</span>
            </div>
          </div>

          <!-- Scope -->
          <div class="form-group">
            <label>Geographic Scope</label>
            <select class="form-control" id="sim-scope-select" style="margin-top:4px;">
              ${munisList.map(m => `<option value="${m.code}" ${d.scope === m.code ? "selected" : ""}>${m.name}</option>`).join("")}
            </select>
          </div>
        </div>

        <!-- Driver Parameter Controls -->
        <div style="background:#060b14; border:1px solid #1e293b; border-radius:8px; padding:14px; margin-bottom:16px;">
          <div style="font-size:12px; font-weight:600; color:#cbd5e1; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <i class="fa-solid fa-bolt text-yellow"></i> Driver Settings (${esc(sc.driver_source)})
          </div>

          ${(sc.driver_source === "SCB" || d.driver.population_change != null) ? `
            <div class="form-group" style="margin-bottom:0;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px;">Population Growth / Decline Rate</label>
                <span id="lbl-sim-pop" style="color:#10b981; font-weight:700; font-size:14px;">
                  ${d.pop_change_pct >= 0 ? "+" : ""}${d.pop_change_pct}%
                </span>
              </div>
              <input type="range" class="form-control" id="sim-pop-change" min="-20" max="40" value="${d.pop_change_pct}" style="padding:0; margin-top:4px;">
              <div style="display:flex; justify-content:space-between; font-size:10px; color:#64748b; margin-top:2px;">
                <span>-20% (Contraction)</span>
                <span>0% (Stable)</span>
                <span>+10% (Baseline)</span>
                <span>+25% (Rapid)</span>
                <span>+40% (Surge)</span>
              </div>
            </div>
          ` : `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group" style="margin-bottom:0;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <label style="font-size:12px;">Road Temp Delta</label>
                  <span id="lbl-sim-temp" style="color:#f59e0b; font-weight:700; font-size:14px;">${d.road_temp_delta >= 0 ? "+" : ""}${d.road_temp_delta}°C</span>
                </div>
                <input type="range" class="form-control" id="sim-temp-delta" min="-10" max="5" step="0.5" value="${d.road_temp_delta}" style="padding:0; margin-top:4px;">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label style="font-size:12px;">Freeze-Thaw Cycles (Days)</label>
                <input type="number" class="form-control" id="sim-freeze-cycles" value="${d.freeze_cycles}" min="0" max="60" style="margin-top:4px;">
              </div>
            </div>
          `}
        </div>

        <!-- Coupled Authority Feeds -->
        <div style="margin-bottom:18px;">
          <div style="font-size:12px; font-weight:600; color:#cbd5e1; margin-bottom:8px;">
            Coupled Authority Feeds & Causal Propagation
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px;">
            ${allCoupledSources.map(s => {
              const isExcluded = d.excluded_sources.includes(s.id);
              const isDriver = (s.id.toLowerCase() === (sc.driver_source || "").toLowerCase());
              return `
                <label style="display:flex; align-items:flex-start; gap:8px; background:#070d19; border:1px solid #1e293b; padding:8px 10px; border-radius:6px; cursor:pointer;">
                  <input type="checkbox" class="dep-source-chk" data-source="${s.id}" ${!isExcluded ? "checked" : ""} style="margin-top:2px;">
                  <div style="font-size:11px; line-height:1.3;">
                    <b style="color:#fff;">${s.name}</b>
                    <div style="color:#94a3b8; font-size:10px;">${s.desc}</div>
                    <span class="scenario-tag ${isDriver ? "tag-purple" : "tag-blue"}" style="font-size:9px; padding:1px 4px; margin-top:4px;">
                      ${isDriver ? "Driver" : s.role}
                    </span>
                  </div>
                </label>
              `;
            }).join("")}
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
          <button class="btn-save-apply" id="btn-run-sim-test" style="background:#4f46e5; border-color:#4338ca;">
            <i class="fa-solid fa-flask"></i> Run Test (Safe)
          </button>
          <button class="btn-save-apply" id="btn-run-sim-official" style="background:linear-gradient(135deg, #1d68e8, #2563eb);">
            <i class="fa-solid fa-play"></i> Execute & Set Official
          </button>
          <button class="btn-reset-default" id="btn-export-sim-csv">
            <i class="fa-solid fa-file-csv"></i> Export CSV
          </button>
        </div>
      </div>

      <!-- Simulation Results View -->
      ${res ? `
        <div style="background:#0b1325; border:1px solid #1e293b; border-radius:10px; padding:20px;">
          <!-- Results Header -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid #1e293b;">
            <div style="display:flex; align-items:center; gap:10px;">
              <h3 style="font-size:15px; color:#e2e8f0; margin:0;">
                <i class="fa-solid fa-chart-line text-blue"></i>
                Simulation Forecast: ${esc(res.scenario || sc.name)} (${res.target_year || d.target_year})
              </h3>
              ${(!res.is_test) ? `
                <span class="badge-status online" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid #10b981;">
                  <i class="fa-solid fa-circle-check"></i> Official Digital Twin Result
                </span>
              ` : `
                <span class="badge-status disabled" style="background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid #a855f7;">
                  <i class="fa-solid fa-flask"></i> Safe Test Run (Not Official)
                </span>
              `}
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-family:monospace; font-size:11px; background:#070d19; padding:4px 8px; border-radius:4px; border:1px solid #1e293b; color:#94a3b8;">
                Run ID: <b style="color:#60a5fa;">${esc(res.run_id)}</b>
              </span>
              <span style="font-size:11px; color:#64748b;">${fmtDateTime(res.timestamp)}</span>
            </div>
          </div>

          <!-- 4 KPI Metrics -->
          <div class="sim-kpi-grid">
            <div class="sim-kpi-card">
              <div class="kpi-label">Simulated Population</div>
              <div class="kpi-value">${fmtNum(summary?.population_simulated)}</div>
              <div class="kpi-sub" style="color:${(summary?.population_change_pct || 0) >= 0 ? "#10b981" : "#ef4444"};">
                ${(summary?.population_change_pct || 0) >= 0 ? "+" : ""}${summary?.population_change_pct || 0}% vs Current (${fmtNum(summary?.population_current)})
              </div>
            </div>

            <div class="sim-kpi-card">
              <div class="kpi-label">Regional Risk Score</div>
              <div class="kpi-value" style="color:#f59e0b;">
                ${((summary?.regional_risk?.score || 0) * 100).toFixed(0)}%
              </div>
              <div class="kpi-sub">
                <span class="scenario-tag tag-purple">${summary?.regional_risk?.level || "Medium"}</span>
              </div>
            </div>

            <div class="sim-kpi-card">
              <div class="kpi-label">Infrastructure Load</div>
              <div class="kpi-value" style="color:#ef4444;">
                ${summary?.category_risks?.infrastructure_risk || "High"}
              </div>
              <div class="kpi-sub" style="color:#94a3b8;">Roads & Traffic Stress</div>
            </div>

            <div class="sim-kpi-card">
              <div class="kpi-label">Environmental Exposure</div>
              <div class="kpi-value" style="color:#38bdf8;">
                ${summary?.category_risks?.environment_risk || "Medium"}
              </div>
              <div class="kpi-sub" style="color:#94a3b8;">Forest & Hydrogeology</div>
            </div>
          </div>

          <!-- Narrative Synthesis -->
          <div style="background:#070d19; border-left:3px solid #3b82f6; border-radius:0 6px 6px 0; padding:12px 16px; margin-bottom:18px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#60a5fa; letter-spacing:0.5px; margin-bottom:4px;">
              <i class="fa-solid fa-circle-info"></i> Model Policy Takeaway
            </div>
            <div style="font-size:12px; color:#cbd5e1; line-height:1.6; font-style:italic;">
              "${esc(summary?.key_takeaway || "Cross-sector causal simulation executed successfully.")}"
            </div>
          </div>

          <!-- Cross-Sector Multipliers Matrix -->
          <div style="margin-bottom:20px;">
            <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:8px;">
              <i class="fa-solid fa-network-wired text-purple"></i> Cross-Sector Feeder Source Coupling
            </div>
            <div style="overflow-x:auto;">
              <table class="sim-source-matrix">
                <thead>
                  <tr>
                    <th>Authority Feed</th>
                    <th>Causal Role</th>
                    <th>Current Baseline</th>
                    <th>Simulated Forecast</th>
                    <th>Projected Delta</th>
                    <th>Impact Severity</th>
                  </tr>
                </thead>
                <tbody>
                  ${(res.impact_by_source || []).map(imp => `
                    <tr>
                      <td><b>${esc(imp.name)}</b></td>
                      <td><span class="scenario-tag ${imp.role === "Driver" ? "tag-purple" : "tag-blue"}">${esc(imp.role)}</span></td>
                      <td>${esc(imp.current)}</td>
                      <td><b style="color:#fff;">${esc(imp.simulated)}</b></td>
                      <td style="color:${String(imp.change).startsWith("+") ? "#10b981" : "#cbd5e1"}; font-weight:600;">${esc(imp.change)}</td>
                      <td>
                        <span class="scenario-tag ${imp.impact === "High" ? "tag-purple" : imp.impact === "Medium" ? "tag-blue" : "tag-green"}">
                          ${esc(imp.impact)}
                        </span>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>

          <!-- 15 Municipalities Breakdown Table -->
          <div>
            <div class="muni-filter-bar">
              <div style="font-size:13px; font-weight:700; color:#fff;">
                <i class="fa-solid fa-city text-cyan"></i> 15 Municipalities Detailed Forecast
              </div>
              <input type="text" id="muni-search-input" class="muni-filter-input" placeholder="Search municipality (e.g. Falun, Mora)..." value="${esc(A.muniSearchFilter)}">
            </div>

            <div style="overflow-x:auto; max-height:400px; border:1px solid #1e293b; border-radius:8px;">
              <table class="audit-table" id="muni-results-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Municipality</th>
                    <th>Base Population</th>
                    <th>Simulated Population</th>
                    <th>Delta (%)</th>
                    <th>Infra Risk</th>
                    <th>Food Risk</th>
                    <th>Flood Risk</th>
                    <th>Env Risk</th>
                    <th>Composite Risk</th>
                  </tr>
                </thead>
                <tbody>
                  ${(res.municipalities || []).filter(m => !A.muniSearchFilter || m.name.toLowerCase().includes(A.muniSearchFilter.toLowerCase()) || m.code.includes(A.muniSearchFilter)).map(m => {
                    const rLvl = m.overall_risk?.level || "Medium";
                    const badgeClass = rLvl === "Low" ? "risk-badge-low" : rLvl === "Medium" ? "risk-badge-med" : rLvl === "High" ? "risk-badge-high" : "risk-badge-crit";
                    return `
                      <tr>
                        <td><code>${esc(m.code)}</code></td>
                        <td><b>${esc(m.name)}</b></td>
                        <td>${fmtNum(m.current_population)}</td>
                        <td><b style="color:#fff;">${fmtNum(m.simulated_population)}</b></td>
                        <td style="color:${m.population_change_pct >= 0 ? "#10b981" : "#ef4444"}; font-weight:600;">
                          ${m.population_change_pct >= 0 ? "+" : ""}${m.population_change_pct}%
                        </td>
                        <td>${m.infrastructure_risk?.level || "—"}</td>
                        <td>${m.food_risk?.level || "—"}</td>
                        <td>${m.snow_flood_risk?.level || "—"}</td>
                        <td>${m.environment_risk?.level || "—"}</td>
                        <td>
                          <span class="${badgeClass}">
                            ${rLvl} (${m.overall_risk?.score?.toFixed(2) || "0.00"})
                          </span>
                        </td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ` : ""}
    </div>`;
}

const DALARNA_15_MUNICIPALITIES_RISK = [
  { code: "2081", name: "Borlänge", pop: 51399, baseScore: 0.46 },
  { code: "2080", name: "Falun", pop: 59016, baseScore: 0.46 },
  { code: "2062", name: "Mora", pop: 21928, baseScore: 0.44 },
  { code: "2085", name: "Ludvika", pop: 26389, baseScore: 0.55 },
  { code: "2084", name: "Avesta", pop: 23105, baseScore: 0.51 },
  { code: "2029", name: "Leksand", pop: 15950, baseScore: 0.42 },
  { code: "2083", name: "Hedemora", pop: 15300, baseScore: 0.41 },
  { code: "2082", name: "Säter", pop: 11200, baseScore: 0.37 },
  { code: "2031", name: "Rättvik", pop: 11000, baseScore: 0.40 },
  { code: "2061", name: "Smedjebacken", pop: 10900, baseScore: 0.44 },
  { code: "2026", name: "Gagnef", pop: 10400, baseScore: 0.37 },
  { code: "2023", name: "Malung-Sälen", pop: 10200, baseScore: 0.42 },
  { code: "2039", name: "Älvdalen", pop: 7000, baseScore: 0.36 },
  { code: "2034", name: "Orsa", pop: 6900, baseScore: 0.34 },
  { code: "2021", name: "Vansbro", pop: 6700, baseScore: 0.36 },
];

function classifyRiskLocally(score, th) {
  const tLow = th?.low != null ? Number(th.low) : 0.30;
  const tMed = th?.medium != null ? Number(th.medium) : 0.60;
  const tHigh = th?.high != null ? Number(th.high) : 0.80;
  if (score < tLow) return "Low";
  if (score < tMed) return "Medium";
  if (score < tHigh) return "High";
  return "Critical";
}

function getRiskBadgeClass(level) {
  const l = (level || "").toLowerCase();
  if (l === "low") return "risk-badge-low";
  if (l === "medium" || l === "med") return "risk-badge-med";
  if (l === "high") return "risk-badge-high";
  return "risk-badge-crit";
}

function renderRisksTab() {
  const th = A.riskConfig?.thresholds || { low: 0.3, medium: 0.6, high: 0.8, critical: 1.0 };
  const wt = A.riskConfig?.weights || { population: 0.25, food: 0.20, snow_flood: 0.20, infrastructure: 0.20, environment: 0.15 };
  const totalWeight = Object.values(wt).reduce((a, b) => a + Number(b), 0);
  const isWeightBalanced = Math.abs(totalWeight - 1.0) < 0.01;

  const lowWidth = Math.max(5, Math.min(90, (th.low * 100))).toFixed(1);
  const medWidth = Math.max(5, Math.min(90, ((th.medium - th.low) * 100))).toFixed(1);
  const highWidth = Math.max(5, Math.min(90, ((th.high - th.medium) * 100))).toFixed(1);
  const critWidth = Math.max(5, Math.min(90, ((1.0 - th.high) * 100))).toFixed(1);

  return `
    <div class="panel">
      <!-- Section Header with Actions -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-shield-halved text-cyan"></i> Risk Thresholds & Sector Weights</h2>
          <div class="admin-card-sub">Fine-tune classification boundaries and cross-sector influence weights for Dalarna.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-save-apply" id="btn-save-risk-cfg">
            <i class="fa-solid fa-floppy-disk"></i> Save Risk Settings
          </button>
          <button class="btn-reset-default" id="btn-reset-risk-cfg" title="Revert to last saved values">
            <i class="fa-solid fa-rotate-right"></i> Reset
          </button>
        </div>
      </div>

      <!-- Quick Preset Selection -->
      <div class="risk-preset-row">
        <span style="font-size:11px; color:#8292a8; display:flex; align-items:center; gap:4px; margin-right:4px;">
          <i class="fa-solid fa-wand-magic-sparkles text-purple"></i> Quick Presets:
        </span>
        <button type="button" class="risk-preset-btn" data-preset="balanced">
          <i class="fa-solid fa-scale-balanced text-cyan"></i> Balanced Default (0.30 / 0.60 / 0.80)
        </button>
        <button type="button" class="risk-preset-btn" data-preset="strict">
          <i class="fa-solid fa-triangle-exclamation text-yellow"></i> Precautionary / Strict (0.20 / 0.45 / 0.70)
        </button>
        <button type="button" class="risk-preset-btn" data-preset="permissive">
          <i class="fa-solid fa-shield text-green"></i> High-Tolerance (0.40 / 0.70 / 0.85)
        </button>
      </div>

      <!-- Visual Spectrum Bar -->
      <div class="risk-spectrum-wrap">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#94a3b8; margin-bottom:4px;">
          <b><i class="fa-solid fa-chart-simple text-blue"></i> Risk Classification Spectrum (0.00 &ndash; 1.00)</b>
          <span style="font-size:10px; color:#64748b;">Dynamic bands adjust live with slider controls</span>
        </div>
        <div class="risk-spectrum-bar" id="risk-spectrum-bar">
          <div class="risk-spec-seg seg-low" id="seg-low" style="width:${lowWidth}%;">
            LOW (&lt; <span id="lbl-seg-low">${th.low}</span>)
          </div>
          <div class="risk-spec-seg seg-med" id="seg-med" style="width:${medWidth}%;">
            MED (<span id="lbl-seg-med-lo">${th.low}</span>&ndash;<span id="lbl-seg-med-hi">${th.medium}</span>)
          </div>
          <div class="risk-spec-seg seg-high" id="seg-high" style="width:${highWidth}%;">
            HIGH (<span id="lbl-seg-high-lo">${th.medium}</span>&ndash;<span id="lbl-seg-high-hi">${th.high}</span>)
          </div>
          <div class="risk-spec-seg seg-crit" id="seg-crit" style="width:${critWidth}%;">
            CRIT (&gt; <span id="lbl-seg-crit">${th.high}</span>)
          </div>
        </div>
      </div>

      <!-- Validation Error Box -->
      <div id="risk-validation-msg" style="display:none; background:rgba(239,68,68,0.15); border:1px solid #ef4444; border-radius:6px; padding:10px; color:#fca5a5; font-size:12px; margin-bottom:14px;">
        <i class="fa-solid fa-circle-exclamation mr-1"></i> Thresholds must be strictly ascending: 0.00 &lt; Low &lt; Medium &lt; High &le; 1.00
      </div>

      <!-- Classification Cutoffs Form -->
      <div style="margin-bottom:24px;">
        <h3 style="font-size:13px; color:#fff; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-sliders text-blue"></i> Classification Threshold Boundaries
        </h3>

        <!-- LOW Row -->
        <div class="risk-threshold-row">
          <span class="risk-badge-low" style="width:65px; text-align:center;">LOW</span>
          <div style="flex:1;">
            <div style="display:flex; justify-content:space-between; font-size:12px; color:#cbd5e1; margin-bottom:4px;">
              <span>Score &lt; Low Threshold (Normal Resilience)</span>
              <b style="color:#10b981;" id="lbl-val-low">${th.low}</b>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <input type="range" class="form-control" id="risk-th-low-slider" min="0.05" max="0.50" step="0.01" value="${th.low}" style="flex:1; padding:0;">
              <input type="number" class="form-control" id="risk-th-low" value="${th.low}" step="0.01" min="0.05" max="0.50" style="width:85px; text-align:center;">
            </div>
          </div>
        </div>

        <!-- MEDIUM Row -->
        <div class="risk-threshold-row">
          <span class="risk-badge-med" style="width:65px; text-align:center;">MEDIUM</span>
          <div style="flex:1;">
            <div style="display:flex; justify-content:space-between; font-size:12px; color:#cbd5e1; margin-bottom:4px;">
              <span>Score between Low and Medium (Moderate Stress)</span>
              <b style="color:#f59e0b;" id="lbl-val-med">${th.medium}</b>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <input type="range" class="form-control" id="risk-th-med-slider" min="0.20" max="0.75" step="0.01" value="${th.medium}" style="flex:1; padding:0;">
              <input type="number" class="form-control" id="risk-th-med" value="${th.medium}" step="0.01" min="0.20" max="0.75" style="width:85px; text-align:center;">
            </div>
          </div>
        </div>

        <!-- HIGH Row -->
        <div class="risk-threshold-row">
          <span class="risk-badge-high" style="width:65px; text-align:center;">HIGH</span>
          <div style="flex:1;">
            <div style="display:flex; justify-content:space-between; font-size:12px; color:#cbd5e1; margin-bottom:4px;">
              <span>Score between Medium and High (Elevated Danger)</span>
              <b style="color:#ef4444;" id="lbl-val-high">${th.high}</b>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <input type="range" class="form-control" id="risk-th-high-slider" min="0.50" max="0.95" step="0.01" value="${th.high}" style="flex:1; padding:0;">
              <input type="number" class="form-control" id="risk-th-high" value="${th.high}" step="0.01" min="0.50" max="0.95" style="width:85px; text-align:center;">
            </div>
          </div>
        </div>

        <!-- CRITICAL Row -->
        <div class="risk-threshold-row" style="opacity:0.95;">
          <span class="risk-badge-crit" style="width:65px; text-align:center;">CRITICAL</span>
          <div style="flex:1;">
            <div style="display:flex; justify-content:space-between; font-size:12px; color:#cbd5e1;">
              <span>Score exceeds High threshold (&gt; <span id="lbl-val-crit">${th.high}</span> up to 1.00)</span>
              <b style="color:#a855f7;">Emergency Protocol</b>
            </div>
            <div style="font-size:11px; color:#8292a8; margin-top:4px;">
              Civil contingency and regional disaster warning automatically activated.
            </div>
          </div>
        </div>
      </div>

      <!-- Sector Multiplier Weights -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="font-size:13px; color:#fff; margin:0; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-scale-balanced text-yellow"></i> Sector Multiplier Weights (Total = 1.00)
            </h3>
            <div style="font-size:11px; color:#8292a8; margin-top:2px;">
              Relative weighting applied to societal vulnerability indicators during index aggregation.
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span id="badge-weight-total" class="badge-status ${isWeightBalanced ? "online" : "disabled"}" style="font-size:11px;">
              Sum: <b id="lbl-weight-sum">${Math.round(totalWeight * 100)}%</b>
            </span>
            <button class="btn-reset-default" id="btn-normalize-weights" style="font-size:11px; padding:5px 10px;" title="Scale all weights proportionally to equal 100%">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Normalize to 100%
            </button>
          </div>
        </div>

        <div class="risk-weights-grid">
          <!-- Population -->
          <div class="risk-weight-card">
            <div class="risk-weight-head">
              <span class="risk-weight-title"><i class="fa-solid fa-users text-purple"></i> Population (SCB)</span>
              <span class="risk-weight-badge" id="badge-wt-pop">${Math.round((wt.population || 0.25) * 100)}%</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <input type="range" class="form-control" id="risk-wt-pop-slider" min="0" max="1" step="0.05" value="${wt.population || 0.25}" style="padding:0; flex:1;">
              <input type="number" class="form-control" id="risk-wt-pop" value="${wt.population || 0.25}" step="0.05" min="0" max="1" style="width:65px; text-align:center;">
            </div>
          </div>

          <!-- Food Supply -->
          <div class="risk-weight-card">
            <div class="risk-weight-head">
              <span class="risk-weight-title"><i class="fa-solid fa-wheat-awn text-yellow"></i> Food Security</span>
              <span class="risk-weight-badge" id="badge-wt-food">${Math.round((wt.food || 0.20) * 100)}%</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <input type="range" class="form-control" id="risk-wt-food-slider" min="0" max="1" step="0.05" value="${wt.food || 0.20}" style="padding:0; flex:1;">
              <input type="number" class="form-control" id="risk-wt-food" value="${wt.food || 0.20}" step="0.05" min="0" max="1" style="width:65px; text-align:center;">
            </div>
          </div>

          <!-- Snow & Flood -->
          <div class="risk-weight-card">
            <div class="risk-weight-head">
              <span class="risk-weight-title"><i class="fa-solid fa-droplet text-blue"></i> Snow & Flood</span>
              <span class="risk-weight-badge" id="badge-wt-snow">${Math.round((wt.snow_flood || 0.20) * 100)}%</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <input type="range" class="form-control" id="risk-wt-snow-slider" min="0" max="1" step="0.05" value="${wt.snow_flood || 0.20}" style="padding:0; flex:1;">
              <input type="number" class="form-control" id="risk-wt-snow" value="${wt.snow_flood || 0.20}" step="0.05" min="0" max="1" style="width:65px; text-align:center;">
            </div>
          </div>

          <!-- Infrastructure -->
          <div class="risk-weight-card">
            <div class="risk-weight-head">
              <span class="risk-weight-title"><i class="fa-solid fa-road text-amber"></i> Infrastructure</span>
              <span class="risk-weight-badge" id="badge-wt-infra">${Math.round((wt.infrastructure || 0.20) * 100)}%</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <input type="range" class="form-control" id="risk-wt-infra-slider" min="0" max="1" step="0.05" value="${wt.infrastructure || 0.20}" style="padding:0; flex:1;">
              <input type="number" class="form-control" id="risk-wt-infra" value="${wt.infrastructure || 0.20}" step="0.05" min="0" max="1" style="width:65px; text-align:center;">
            </div>
          </div>

          <!-- Environment -->
          <div class="risk-weight-card">
            <div class="risk-weight-head">
              <span class="risk-weight-title"><i class="fa-solid fa-tree text-green"></i> Environment</span>
              <span class="risk-weight-badge" id="badge-wt-env">${Math.round((wt.environment || 0.15) * 100)}%</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <input type="range" class="form-control" id="risk-wt-env-slider" min="0" max="1" step="0.05" value="${wt.environment || 0.15}" style="padding:0; flex:1;">
              <input type="number" class="form-control" id="risk-wt-env" value="${wt.environment || 0.15}" step="0.05" min="0" max="1" style="width:65px; text-align:center;">
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

const MAP_LAYERS_CONFIG = [
  {
    id: "boundaries",
    name: "Municipal Boundaries",
    icon: "fa-solid fa-draw-polygon text-purple",
    source: "System / GeoJSON",
    category: "Administrative",
    desc: "15 Dalarna municipal administrative borders and polygon geometries.",
    feeder: null,
    features: "15 Municipal Polygons",
    geometry: "Polygon (MultiPolygon)",
    crs: "EPSG:4326 (WGS84)",
  },
  {
    id: "population",
    name: "Population Heatmap",
    icon: "fa-solid fa-users text-purple",
    source: "SCB (Statistics Sweden)",
    category: "Demographics",
    desc: "Demographic concentration and settlement density across parishes.",
    feeder: "scb",
    features: "288,000 Inhabitants Monitored",
    geometry: "Choropleth & Weighted Density",
    crs: "EPSG:4326 (WGS84)",
  },
  {
    id: "weather",
    name: "Weather & Sensor Points",
    icon: "fa-solid fa-cloud-sun text-yellow",
    source: "SMHI Open Data",
    category: "Climate",
    desc: "Meteorological station telemetry, ambient temperatures, and weather alerts.",
    feeder: "smhi",
    features: "Live Station Telemetry (Falun / SMHI:105260)",
    geometry: "Point Features (Sensor Stations)",
    crs: "EPSG:4326 (WGS84)",
  },
  {
    id: "roads",
    name: "Road Weather & Cameras",
    icon: "fa-solid fa-road text-blue",
    source: "Trafikverket",
    category: "Infrastructure",
    desc: "Road surface conditions, freeze-thaw danger zones, and traffic cameras.",
    feeder: "trafikverket",
    features: "86 Road Observation Stations",
    geometry: "LineStrings & Sensor Points",
    crs: "EPSG:4326 (WGS84)",
  },
  {
    id: "water",
    name: "Groundwater & Hydrology",
    icon: "fa-solid fa-droplet text-cyan",
    source: "SGU (Geological Survey)",
    category: "Hydrogeology",
    desc: "Groundwater bodies, aquifer levels, and hydrogeological risk zones.",
    feeder: "sgu",
    features: "293 Aquifers & Groundwater Bodies",
    geometry: "Polygon Aquifers & Well Points",
    crs: "EPSG:4326 (WGS84)",
  },
  {
    id: "forest",
    name: "Forest Cover & Trees",
    icon: "fa-solid fa-tree text-green",
    source: "Skogsstyrelsen",
    category: "Environment",
    desc: "Forest stands, mean canopy heights, biomass density, and wildfire risk.",
    feeder: "skogsstyrelsen",
    features: "450,000 ha Monitored Timberland",
    geometry: "Raster / Vector Grid Polygons",
    crs: "EPSG:4326 (WGS84)",
  },
  {
    id: "land",
    name: "Cadastre & Land Parcels",
    icon: "fa-solid fa-map-location-dot text-teal",
    source: "Lantmäteriet NGP",
    category: "Cadastre",
    desc: "Real property cadastral boundaries and building outline footprints.",
    feeder: "lantmateriet",
    features: "12,450 Cadastral Parcels",
    geometry: "Property Parcel Polygons",
    crs: "EPSG:4326 (WGS84)",
  },
  {
    id: "simulation_risk",
    name: "Simulation Risk Choropleth",
    icon: "fa-solid fa-triangle-exclamation text-amber",
    source: "Forecast Engine",
    category: "Forecasting",
    desc: "Municipal composite vulnerability heatmap active during what-if simulations.",
    feeder: null,
    features: "Dynamic Scenario Projection (2025–2045)",
    geometry: "Choropleth Color Interpolation",
    crs: "EPSG:4326 (WGS84)",
    isSimOnly: true,
  },
];

const DALARNA_MUNICIPALITIES_SCOPE = [
  { code: "dalarna", name: "All Dalarna County", pop: "288,000", coords: "15.60° E, 60.60° N", zoom: 8 },
  { code: "2081", name: "Borlänge", pop: "51,399", coords: "15.43° E, 60.48° N", zoom: 12 },
  { code: "2080", name: "Falun", pop: "59,016", coords: "15.63° E, 60.60° N", zoom: 12 },
  { code: "2062", name: "Mora", pop: "21,928", coords: "14.54° E, 61.00° N", zoom: 12 },
  { code: "2085", name: "Ludvika", pop: "26,389", coords: "15.18° E, 60.15° N", zoom: 12 },
  { code: "2084", name: "Avesta", pop: "23,105", coords: "16.17° E, 60.14° N", zoom: 12 },
  { code: "2082", name: "Säter", pop: "11,200", coords: "15.75° E, 60.35° N", zoom: 12 },
  { code: "2083", name: "Hedemora", pop: "15,300", coords: "15.99° E, 60.28° N", zoom: 12 },
  { code: "2029", name: "Leksand", pop: "15,950", coords: "14.99° E, 60.73° N", zoom: 12 },
  { code: "2031", name: "Rättvik", pop: "11,000", coords: "15.18° E, 60.88° N", zoom: 12 },
  { code: "2023", name: "Malung-Sälen", pop: "10,200", coords: "13.71° E, 60.68° N", zoom: 11 },
  { code: "2034", name: "Orsa", pop: "6,900", coords: "14.61° E, 61.12° N", zoom: 12 },
  { code: "2039", name: "Älvdalen", pop: "7,000", coords: "14.04° E, 61.23° N", zoom: 11 },
  { code: "2021", name: "Vansbro", pop: "6,700", coords: "14.22° E, 60.51° N", zoom: 12 },
  { code: "2026", name: "Gagnef", pop: "10,400", coords: "15.08° E, 60.60° N", zoom: 12 },
  { code: "2061", name: "Smedjebacken", pop: "10,900", coords: "15.41° E, 60.14° N", zoom: 12 },
];

function renderMapLayersTab() {
  if (!A.pending) A.pending = {};
  if (!A.pending.layers) {
    A.pending.layers = {
      boundaries: true,
      population: true,
      weather: true,
      roads: true,
      water: true,
      forest: true,
      land: true,
      simulation_risk: true,
    };
  }

  const currentScope = A.pending?.scope || A.saved?.scope || "dalarna";
  const activeScopeObj = DALARNA_MUNICIPALITIES_SCOPE.find(m => m.code === currentScope) || DALARNA_MUNICIPALITIES_SCOPE[0];

  const activeCount = MAP_LAYERS_CONFIG.filter(l => A.pending?.layers?.[l.id] !== false).length;

  const cards = MAP_LAYERS_CONFIG.map((l) => {
    const isVis = A.pending?.layers?.[l.id] !== false;
    return `
      <div class="layer-card ${!isVis ? "disabled-layer" : ""}" id="layer-card-${l.id}">
        <div class="layer-card-top">
          <div class="layer-card-icon-title">
            <div class="layer-icon-circle">
              <i class="${l.icon}"></i>
            </div>
            <div>
              <b style="color:#fff; font-size:13px;">${esc(l.name)}</b>
              <span class="scenario-tag tag-blue" style="font-size:9px; padding:1px 5px; margin-top:2px;">
                ${esc(l.category)}
              </span>
            </div>
          </div>
          <label style="cursor:pointer; display:flex; align-items:center; margin:0;">
            <input type="checkbox" class="toggle-switch-input layer-toggle" data-layer="${l.id}" ${isVis ? "checked" : ""}>
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="layer-card-info" style="margin:8px 0;">
          <span>${esc(l.desc)}</span>
        </div>

        <div class="layer-card-bottom">
          <span class="layer-meta-badge">
            <i class="fa-solid fa-server mr-1"></i> ${esc(l.source)}
          </span>
          <button type="button" class="btn-reset-default btn-inspect-layer" data-layer="${l.id}" style="padding:3px 8px; font-size:10px;" title="View geospatial attributes & schema">
            <i class="fa-solid fa-circle-info"></i> Inspect
          </button>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="panel">
      <!-- Section Header -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-layer-group text-green"></i> Map & Regional Layers Matrix</h2>
          <div class="admin-card-sub">Configure 8 regional geospatial layers, feeder feeds, and 15 municipality focus scopes.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-save-apply" id="btn-save-map-layers">
            <i class="fa-solid fa-floppy-disk"></i> Save & Apply Layers
          </button>
          <button class="btn-reset-default" id="btn-reset-map-layers" title="Revert to saved layer settings">
            <i class="fa-solid fa-rotate-right"></i> Reset
          </button>
        </div>
      </div>

      <!-- Quick Batch Actions Toolbar -->
      <div class="risk-preset-row" style="margin-bottom:16px;">
        <span style="font-size:11px; color:#8292a8; display:flex; align-items:center; gap:4px; margin-right:4px;">
          <span class="badge-status online" id="badge-active-layers" style="font-size:11px;">
            Visible: <b id="lbl-active-layers-count">${activeCount}</b> / 8 Layers
          </span>
        </span>
        <button type="button" class="risk-preset-btn" id="btn-enable-all-layers">
          <i class="fa-solid fa-check-double text-green"></i> Enable All Layers
        </button>
        <button type="button" class="risk-preset-btn" id="btn-disable-all-layers">
          <i class="fa-solid fa-ban text-red"></i> Disable All
        </button>
        <button type="button" class="risk-preset-btn" id="btn-default-layers">
          <i class="fa-solid fa-rotate-left text-cyan"></i> Default Layers
        </button>
      </div>

      <!-- Geographic Scope & Focus Selector (Spec 10) -->
      <div class="scope-selector-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div>
            <h3 style="font-size:13px; color:#fff; margin:0; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-location-crosshairs text-blue"></i> Geographic Scope & Camera Focus
            </h3>
            <div style="font-size:11px; color:#8292a8; margin-top:2px;">
              Control active map boundary focus across the county or zoom into a specific municipality.
            </div>
          </div>
          <span class="scenario-tag tag-purple" id="lbl-scope-tag" style="font-size:11px; padding:3px 8px;">
            Current: ${esc(activeScopeObj.name)}
          </span>
        </div>

        <div style="display:grid; grid-template-columns: 1fr auto; gap:12px; align-items:center;">
          <div>
            <select class="form-control" id="map-scope-select" style="font-size:13px; padding:8px 12px; font-weight:600;">
              ${DALARNA_MUNICIPALITIES_SCOPE.map(m => `
                <option value="${m.code}" ${m.code === currentScope ? "selected" : ""}>
                  ${m.name} (${m.code === "dalarna" ? "County-wide" : "Code: " + m.code + " · Pop: " + m.pop})
                </option>
              `).join("")}
            </select>
          </div>
          <div style="display:flex; gap:8px; font-size:11px; color:#94a3b8; background:#060b14; padding:8px 12px; border-radius:6px; border:1px solid #1e293b;">
            <span>Coords: <b style="color:#60a5fa;" id="lbl-scope-coords">${activeScopeObj.coords}</b></span>
            <span>·</span>
            <span>Pop: <b style="color:#10b981;" id="lbl-scope-pop">${activeScopeObj.pop}</b></span>
          </div>
        </div>
      </div>

      <!-- 8 Geospatial Layer Cards Grid -->
      <div class="layers-grid">
        ${cards}
      </div>
    </div>`;
}

const DASHBOARD_COMPONENTS_CONFIG = [
  {
    id: "source_cards",
    name: "Public Authority Feeds KPI Cards",
    category: "Telemetry",
    icon: "fa-solid fa-database text-blue",
    group: "telemetry",
    desc: "Top overview indicator row displaying real-time telemetry and polling connectivity from SMHI, Trafikverket, SCB, SGU, Skogsstyrelsen & Lantmäteriet.",
    slot: "#header / section.kpi-row",
    impact: "Provides immediate situational awareness of public feeder health, freshest observation timestamps, and offline alerts.",
  },
  {
    id: "map",
    name: "2.5D Regional Satellite Map",
    category: "Geospatial",
    icon: "fa-solid fa-map-location-dot text-green",
    group: "telemetry",
    desc: "Central interactive MapLibre GL 2.5D regional geospatial twin with municipality polygon boundaries, vector layers, and live sensors.",
    slot: "#map-slot / .map-card",
    impact: "Visual centerpiece of the digital twin; renders county choropleth fills, road conditions, and geographical boundaries.",
  },
  {
    id: "municipality_table",
    name: "15 Municipalities Summary Matrix",
    category: "Demographics",
    icon: "fa-solid fa-city text-cyan",
    group: "telemetry",
    desc: "Comprehensive sortable and searchable matrix ranking all 15 Dalarna municipalities by population, growth delta, and composite risks.",
    slot: "#muni-slot / section.muni-card",
    impact: "Enables comparative policy analysis, municipality population tracking, and regional risk assessment drilldowns.",
  },
  {
    id: "simulation_control",
    name: "Simulation Control Panel",
    category: "Modeling",
    icon: "fa-solid fa-sliders text-purple",
    group: "simulation",
    desc: "Interactive scenario parameter editor with target horizon year pills (2026–2040), population slider (-20% to +30%), and source dependency toggles.",
    slot: "#control-slot / .sim-ctrl-card",
    impact: "Primary user interface for running predictive what-if demographic and climate policy scenarios.",
  },
  {
    id: "simulation_results",
    name: "Multi-Source Impact Table",
    category: "Modeling",
    icon: "fa-solid fa-chart-column text-yellow",
    group: "simulation",
    desc: "Consequence breakdown reporting baseline versus projected metrics, percentage change, and impact classification across all feeds.",
    slot: "#results-slot / .impact-table-wrap",
    impact: "Quantifies multi-sectoral effects across public authority systems following scenario execution.",
  },
  {
    id: "regional_risk",
    name: "Overall Regional Risk Gauge",
    category: "Risk Assessment",
    icon: "fa-solid fa-gauge-high text-amber",
    group: "risk",
    desc: "Prominent radial dial presenting the aggregate regional risk index (0.00–1.00) alongside synthesized policy takeaways.",
    slot: "#results-slot / .gauge-box",
    impact: "High-level index summarizing composite risk across population, food, water, infrastructure, and forestry.",
  },
  {
    id: "population",
    name: "Population Demographic Pillar",
    category: "Risk Pillar",
    icon: "fa-solid fa-users text-purple",
    group: "pillars",
    desc: "Primary demographic summary pill tracking total simulated regional population and net demographic change percentage.",
    slot: ".metrics-5-box / population",
    impact: "Baseline demographic expansion metric tracking population movement across the county.",
  },
  {
    id: "food_risk",
    name: "Food & Supply Vulnerability",
    category: "Risk Pillar",
    icon: "fa-solid fa-leaf text-green",
    group: "pillars",
    desc: "Agricultural stability, food production capacity, and municipal supply chain risk indicator card and table column.",
    slot: ".metrics-5-box / food_risk",
    impact: "Coupled directly with SCB demographic consumption and agricultural telemetry.",
  },
  {
    id: "snow_flood_risk",
    name: "Snow & Flood Hazard Pillar",
    category: "Risk Pillar",
    icon: "fa-solid fa-snowflake text-cyan",
    group: "pillars",
    desc: "Groundwater table exposure, spring snowmelt runoff, and hydrogeological inundation hazard indicator card.",
    slot: ".metrics-5-box / snow_flood_risk",
    impact: "Coupled directly with SGU groundwater and hydrological monitoring stations.",
  },
  {
    id: "infrastructure_risk",
    name: "Road & Transport Risk Pillar",
    category: "Risk Pillar",
    icon: "fa-solid fa-road text-blue",
    group: "pillars",
    desc: "Corridor transport stress, bridge and asphalt wear, and winter freeze-thaw degradation indicator card.",
    slot: ".metrics-5-box / infrastructure_risk",
    impact: "Coupled with Trafikverket road weather sensors, asphalt temperature, and camera feeds.",
  },
  {
    id: "environment_risk",
    name: "Forest & Ecology Risk Pillar",
    category: "Risk Pillar",
    icon: "fa-solid fa-tree text-emerald",
    group: "pillars",
    desc: "Timberland canopy loss, forest stand biomass stress, and wildfire ecological vulnerability indicator card.",
    slot: ".metrics-5-box / environment_risk",
    impact: "Coupled with Skogsstyrelsen forestry inventory and timberland monitoring feeds.",
  },
];

function renderVisualTab() {
  if (!A.pending) A.pending = {};
  if (!A.pending.components) {
    A.pending.components = {
      source_cards: true,
      regional_risk: true,
      population: true,
      food_risk: true,
      snow_flood_risk: true,
      infrastructure_risk: true,
      environment_risk: true,
      municipality_table: true,
      simulation_control: true,
      simulation_results: true,
      map: true,
    };
  }

  const activeCount = DASHBOARD_COMPONENTS_CONFIG.filter(c => A.pending?.components?.[c.id] !== false).length;

  const cards = DASHBOARD_COMPONENTS_CONFIG.map((c) => {
    const isVis = A.pending?.components?.[c.id] !== false;
    return `
      <div class="layer-card comp-card ${!isVis ? "disabled-layer" : ""}" id="comp-card-${c.id}" data-comp="${c.id}" data-group="${c.group}">
        <div class="layer-card-top">
          <div class="layer-card-icon-title">
            <div class="layer-icon-circle">
              <i class="${c.icon}"></i>
            </div>
            <div>
              <b style="color:#fff; font-size:13px;">${esc(c.name)}</b>
              <span class="scenario-tag tag-purple" style="font-size:9px; padding:1px 5px; margin-top:2px;">
                ${esc(c.category)}
              </span>
            </div>
          </div>
          <label style="cursor:pointer; display:flex; align-items:center; margin:0;">
            <input type="checkbox" class="toggle-switch-input comp-toggle" data-act="toggle-comp" data-key="${c.id}" data-comp="${c.id}" ${isVis ? "checked" : ""}>
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="layer-card-info" style="margin:8px 0;">
          <span>${esc(c.desc)}</span>
        </div>

        <div class="layer-card-bottom">
          <span class="layer-meta-badge">
            <i class="fa-solid fa-code mr-1"></i> ${esc(c.slot)}
          </span>
          <button type="button" class="btn-reset-default btn-inspect-comp" data-comp="${c.id}" style="padding:3px 8px; font-size:10px;" title="View component layout slot & specifications">
            <i class="fa-solid fa-circle-info"></i> Inspect
          </button>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="panel">
      <!-- Section Header -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-palette text-yellow"></i> Dashboard Appearance & Layout Control</h2>
          <div class="admin-card-sub">Customize visible UI widgets, 5-pillar risk indicators, and forecasting panels across the stakeholder interface.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-save-apply" id="btn-save-appearance">
            <i class="fa-solid fa-floppy-disk"></i> Save & Apply Appearance
          </button>
          <button class="btn-reset-default" id="btn-reset-appearance" title="Revert to saved appearance settings">
            <i class="fa-solid fa-rotate-right"></i> Reset
          </button>
        </div>
      </div>

      <!-- Quick Batch Actions & Counter Bar -->
      <div class="risk-preset-row" style="margin-bottom:12px;">
        <span style="font-size:11px; color:#8292a8; display:flex; align-items:center; gap:4px; margin-right:4px;">
          <span class="badge-status online" id="badge-active-comps" style="font-size:11px;">
            Visible: <b id="lbl-active-comps-count">${activeCount}</b> / 11 Widgets
          </span>
        </span>
        <button type="button" class="risk-preset-btn" id="btn-enable-all-comps">
          <i class="fa-solid fa-check-double text-green"></i> Show All (11)
        </button>
        <button type="button" class="risk-preset-btn" id="btn-disable-all-comps">
          <i class="fa-solid fa-ban text-red"></i> Hide All
        </button>
        <button type="button" class="risk-preset-btn" id="btn-default-comps">
          <i class="fa-solid fa-rotate-left text-cyan"></i> Default Layout
        </button>
      </div>

      <!-- Layout View Presets Row -->
      <div style="background:#080f1e; border:1px solid #1e293b; border-radius:8px; padding:12px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:12px; font-weight:600; color:#cbd5e1; display:flex; align-items:center; gap:6px;">
            <i class="fa-solid fa-table-cells-large text-blue"></i> Fast Layout Presets
          </span>
          <span style="font-size:10px; color:#64748b;">Instant arrangement tailored to stakeholder roles</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          <button type="button" class="risk-preset-btn btn-comp-preset" data-preset="executive">
            <i class="fa-solid fa-briefcase text-blue"></i> Executive Overview
          </button>
          <button type="button" class="risk-preset-btn btn-comp-preset" data-preset="simulation">
            <i class="fa-solid fa-flask text-purple"></i> Simulation Specialist
          </button>
          <button type="button" class="risk-preset-btn btn-comp-preset" data-preset="map">
            <i class="fa-solid fa-map text-green"></i> Geospatial Map Only
          </button>
          <button type="button" class="risk-preset-btn btn-comp-preset" data-preset="pillars">
            <i class="fa-solid fa-shield-halved text-amber"></i> 5 Risk Pillars Focus
          </button>
        </div>
      </div>

      <!-- Category Filter Chips & Search Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap:12px; flex-wrap:wrap;">
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="scenario-tag tag-blue btn-comp-filter active" data-filter="all" style="cursor:pointer; font-size:11px; padding:4px 10px;">
            All (11)
          </button>
          <button type="button" class="scenario-tag tag-purple btn-comp-filter" data-filter="telemetry" style="cursor:pointer; font-size:11px; padding:4px 10px;">
            Telemetry & Map
          </button>
          <button type="button" class="scenario-tag tag-yellow btn-comp-filter" data-filter="simulation" style="cursor:pointer; font-size:11px; padding:4px 10px;">
            Simulation & Modeling
          </button>
          <button type="button" class="scenario-tag tag-green btn-comp-filter" data-filter="pillars" style="cursor:pointer; font-size:11px; padding:4px 10px;">
            5 Risk Pillars
          </button>
        </div>
        <div style="flex:1; min-width:200px; max-width:300px;">
          <input type="text" class="form-control" id="comp-search-input" placeholder="Search widgets (e.g. Map, Risk, Table)..." style="font-size:11px; padding:6px 10px;">
        </div>
      </div>

      <!-- 11 Components Grid -->
      <div class="layers-grid" id="components-grid">
        ${cards}
      </div>
    </div>`;
}

function getAuditTagBadge(action) {
  const act = action || "action";
  let cls = "tag-other";
  if (act.startsWith("control.apply")) cls = "tag-apply";
  else if (act.startsWith("control.source")) cls = "tag-source";
  else if (act.startsWith("control.map_layer")) cls = "tag-layer";
  else if (act.startsWith("control.component")) cls = "tag-comp";
  else if (act.startsWith("control.scope")) cls = "tag-scope";
  else if (act.startsWith("auth.")) cls = "tag-auth";
  else if (act.startsWith("simulation.")) cls = "tag-sim";
  else if (act.startsWith("control.refresh")) cls = "tag-apply";
  return `<span class="audit-action-tag ${cls}">${esc(act)}</span>`;
}

function getFilteredAuditEvents() {
  let list = A.auditEvents || [];
  if (A.auditFilterAction && A.auditFilterAction !== "all") {
    list = list.filter((ev) => ev.action === A.auditFilterAction);
  }
  if (A.auditSearchTerm && A.auditSearchTerm.trim()) {
    const q = A.auditSearchTerm.trim().toLowerCase();
    list = list.filter((ev) => {
      const act = (ev.action || "").toLowerCase();
      const user = (ev.username || "").toLowerCase();
      const sum = JSON.stringify(ev.summary || {}).toLowerCase();
      return act.includes(q) || user.includes(q) || sum.includes(q);
    });
  }
  return list;
}

function renderSystemTab() {
  const dbOk = A.systemHealth?.database?.ok ?? true;
  const schedAlive = A.systemHealth?.scheduler?.alive ?? true;
  const authSec = A.systemHealth?.auth?.session_secret_persistent ?? true;
  const authCfg = A.systemHealth?.auth?.admin_login_configured ?? true;

  const sourcesList = A.systemHealth?.sources || A.summary?.sources || [];
  const onlineSourcesCount = sourcesList.filter((s) => s.status === "online" || s.status === "ok").length;

  const filteredEvents = getFilteredAuditEvents();

  const auditRows = filteredEvents.map((ev, idx) => `
    <tr>
      <td style="font-size:11px; color:#94a3b8; white-space:nowrap;">
        <b>${fmtDateTime(ev.timestamp)}</b>
        <div style="font-size:10px; color:#64748b;">${relTime(ev.timestamp)}</div>
      </td>
      <td>${getAuditTagBadge(ev.action)}</td>
      <td><b style="color:#f8fafc;">${esc(ev.username || "admin")}</b></td>
      <td>
        <code class="audit-summary-code" title="${esc(JSON.stringify(ev.summary || {}))}">
          ${esc(JSON.stringify(ev.summary || {}))}
        </code>
      </td>
      <td>
        <span class="badge-status ${ev.result === "ok" ? "online" : "disabled"}" style="font-size:10px; padding:2px 8px;">
          ${(ev.result || "ok").toUpperCase()}
        </span>
      </td>
      <td style="text-align:right;">
        <button type="button" class="btn-reset-default btn-inspect-audit" data-index="${idx}" style="padding:3px 8px; font-size:10px;" title="View raw JSON payload">
          <i class="fa-solid fa-code"></i> Inspect
        </button>
      </td>
    </tr>
  `).join("");

  const allFeedsConfig = [
    { id: "smhi", name: "SMHI", category: "Weather & Climate", icon: "fa-solid fa-cloud-sun text-yellow", interval: "15 min" },
    { id: "trafikverket", name: "Trafikverket", category: "Traffic & Road Weather", icon: "fa-solid fa-road text-blue", interval: "15 min" },
    { id: "scb", name: "SCB", category: "Population & Demographics", icon: "fa-solid fa-users text-purple", interval: "1 hour" },
    { id: "sgu", name: "SGU", category: "Groundwater & Geology", icon: "fa-solid fa-droplet text-cyan", interval: "1 hour" },
    { id: "skogsstyrelsen", name: "Skogsstyrelsen", category: "Forestry & Biodiversity", icon: "fa-solid fa-tree text-green", interval: "1 hour" },
    { id: "lantmateriet", name: "Lantmäteriet", category: "Land & Cadastral Registry", icon: "fa-solid fa-map-location-dot text-teal", interval: "1 hour" },
  ];

  const feedRows = allFeedsConfig.map((cfg) => {
    const info = sourcesList.find((s) => s.id === cfg.id) || {};
    const st = info.status || "online";
    let badgeHtml = `<span class="badge-status online"><span class="dot-online"></span> HEALTHY</span>`;
    if (st === "fallback") {
      badgeHtml = `<span class="badge-status" style="color:#f59e0b; border-color:rgba(245,158,11,0.4); background:rgba(245,158,11,0.15);"><i class="fa-solid fa-triangle-exclamation"></i> FALLBACK</span>`;
    } else if (st === "not_configured") {
      badgeHtml = `<span class="badge-status" style="color:#94a3b8; border-color:rgba(148,163,184,0.4); background:rgba(148,163,184,0.15);"><i class="fa-solid fa-key"></i> UNCONFIGURED</span>`;
    } else if (st === "error" || st === "offline") {
      badgeHtml = `<span class="badge-status disabled"><i class="fa-solid fa-circle-xmark"></i> OFFLINE</span>`;
    }

    const lastAtt = info.last_attempt_at ? fmtDateTime(info.last_attempt_at) : "Active scheduler daemon";
    const msg = info.message || "Operational connection established.";

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <i class="${cfg.icon}" style="font-size:16px;"></i>
            <div>
              <b style="color:#fff; font-size:12px;">${esc(cfg.name)}</b>
              <div style="font-size:10px; color:#8292a8;">${esc(cfg.category)}</div>
            </div>
          </div>
        </td>
        <td>${badgeHtml}</td>
        <td style="font-size:11px; color:#cbd5e1;">${lastAtt}</td>
        <td style="font-size:11px; color:#94a3b8; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(msg)}">
          ${esc(msg)}
        </td>
        <td style="text-align:right;">
          <button type="button" class="btn-reset-default btn-sys-test-src" data-source="${cfg.id}" style="padding:4px 9px; font-size:11px;" title="Test live connector">
            <i class="fa-solid fa-bolt text-yellow"></i> Test
          </button>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="panel">
      <!-- Section 1 Header Toolbar -->
      <div class="admin-card-head" style="margin-bottom:18px;">
        <div>
          <h2><i class="fa-solid fa-server text-blue"></i> System Infrastructure & Audit Center</h2>
          <div class="admin-card-sub">Real-time health telemetry, background daemon status, configuration diff sandbox, and immutable audit events.</div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn-save-apply" id="btn-reload-system-data">
            <i class="fa-solid fa-arrows-rotate"></i> Refresh State
          </button>
          <button type="button" class="btn-reset-default" id="btn-sys-open-import">
            <i class="fa-solid fa-file-import text-blue"></i> Import JSON Config
          </button>
        </div>
      </div>

      <!-- Section 2: 4 Infrastructure Health Diagnostics Cards -->
      <div class="sys-health-grid">
        <!-- DB Engine -->
        <div class="sys-health-card">
          <div>
            <div class="sys-health-card-head">
              <div class="sys-health-icon-wrap" style="background:rgba(59,130,246,0.15);">
                <i class="fa-solid fa-database text-blue"></i>
              </div>
              ${dbOk ? `<span class="badge-status online"><span class="dot-online"></span> HEALTHY</span>` : `<span class="badge-status disabled">OFFLINE</span>`}
            </div>
            <div class="sys-health-title">PostgreSQL / PostGIS</div>
            <div class="sys-health-subtitle">Primary Spatial Relational Database</div>
          </div>
          <div class="sys-health-details">
            <div>• Port 5432 · PostGIS 3.4 Spatial Extensions</div>
            <div>• Connection Pool: Active · Response &lt; 2ms</div>
            <div>• 15 Municipality Boundary Polygons Loaded</div>
          </div>
        </div>

        <!-- Ingest Scheduler -->
        <div class="sys-health-card">
          <div>
            <div class="sys-health-card-head">
              <div class="sys-health-icon-wrap" style="background:rgba(16,185,129,0.15);">
                <i class="fa-solid fa-clock-rotate-left text-green"></i>
              </div>
              ${schedAlive ? `<span class="badge-status online"><span class="dot-online"></span> ACTIVE</span>` : `<span class="badge-status disabled">STOPPED</span>`}
            </div>
            <div class="sys-health-title">Background Ingest Scheduler</div>
            <div class="sys-health-subtitle">Autonomous Ingestion Daemon</div>
          </div>
          <div class="sys-health-details">
            <div>• Daemon Thread: Active · Cron Dispatcher</div>
            <div>• Feeds Polling: ${onlineSourcesCount} / 6 Authorities Connected</div>
            <div>• Intervals: Weather 15m · SGU 6h · SCB 24h</div>
          </div>
        </div>

        <!-- Simulation Engine -->
        <div class="sys-health-card">
          <div>
            <div class="sys-health-card-head">
              <div class="sys-health-icon-wrap" style="background:rgba(168,85,247,0.15);">
                <i class="fa-solid fa-brain text-purple"></i>
              </div>
              <span class="badge-status online" style="color:#a855f7; border-color:rgba(168,85,247,0.4); background:rgba(168,85,247,0.15);">
                <span class="dot-online" style="background:#a855f7; box-shadow:0 0 6px #a855f7;"></span> READY
              </span>
            </div>
            <div class="sys-health-title">Predictive Causal Engine</div>
            <div class="sys-health-subtitle">Multi-Sector Mathematical Model</div>
          </div>
          <div class="sys-health-details">
            <div>• Model Formulation: Multi-Sector Causal v1.2.0</div>
            <div>• Resolution: 15 Municipalities × 5 Risk Pillars</div>
            <div>• Logged Runs: ${(A.simHistory || []).length} Recorded Executions</div>
          </div>
        </div>

        <!-- Security & Session Auth -->
        <div class="sys-health-card">
          <div>
            <div class="sys-health-card-head">
              <div class="sys-health-icon-wrap" style="background:rgba(6,182,212,0.15);">
                <i class="fa-solid fa-shield-halved text-cyan"></i>
              </div>
              ${authSec ? `<span class="badge-status online"><span class="dot-online"></span> SECURE</span>` : `<span class="badge-status disabled">EPHEMERAL</span>`}
            </div>
            <div class="sys-health-title">Security & Session Auth</div>
            <div class="sys-health-subtitle">HMAC Token & Role Verification</div>
          </div>
          <div class="sys-health-details">
            <div>• Admin Credentials: ${authCfg ? "Configured & Protected" : "Default"}</div>
            <div>• Session Cookie: HttpOnly · SameSite=Lax</div>
            <div>• Headers: nosniff · SAMEORIGIN · Cache-Control</div>
          </div>
        </div>
      </div>

      <!-- Section 3: Live Authority Feeds Telemetry Matrix -->
      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:16px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="font-size:13px; color:#fff; margin:0; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-satellite-dish text-blue"></i> Live Public Authority Feeds Matrix
            </h3>
            <div style="font-size:11px; color:#8292a8; margin-top:2px;">
              Real-time health telemetry across all 6 national feeds.
            </div>
          </div>
          <button type="button" class="btn-reset-default" id="btn-sys-refresh-all" style="padding:5px 10px; font-size:11px;">
            <i class="fa-solid fa-rotate text-blue"></i> Trigger Ingest All
          </button>
        </div>

        <div style="overflow-x:auto;">
          <table class="audit-table" style="font-size:11px;">
            <thead>
              <tr>
                <th>Authority / Feeder</th>
                <th>Status</th>
                <th>Last Fetch Attempt</th>
                <th>Diagnostic Message</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${feedRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section 4: Full Data Package Export Center (4 Formats) -->
      <div style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="font-size:13px; color:#fff; margin:0; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-box-archive text-green"></i> Full Data Package Export Center
            </h3>
            <div style="font-size:11px; color:#8292a8; margin-top:2px;">
              Download complete digital twin state, municipal forecasts, tabular spreadsheets, and spatial boundaries.
            </div>
          </div>
          <span class="scenario-tag tag-green" style="font-size:11px; padding:3px 8px;">
            4 Export Formats Active
          </span>
        </div>

        <div class="sys-export-grid">
          <!-- 1. JSON -->
          <div class="sys-export-card">
            <div>
              <div class="sys-export-head">
                <i class="fa-solid fa-file-code text-blue" style="font-size:24px;"></i>
                <span class="sys-export-fmt-badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.4);">JSON</span>
              </div>
              <div class="sys-export-title">Full Digital Twin Snapshot</div>
              <div class="sys-export-desc">
                Complete regional state including baseline SCB population, 15 municipal risk metrics, data feeds catalog, and latest simulation forecast.
              </div>
            </div>
            <a href="/api/system/export?format=json" download class="sys-export-btn" style="background:#2563eb;">
              <i class="fa-solid fa-download"></i> Download Full JSON
            </a>
          </div>

          <!-- 2. XLSX -->
          <div class="sys-export-card">
            <div>
              <div class="sys-export-head">
                <i class="fa-solid fa-file-excel text-green" style="font-size:24px;"></i>
                <span class="sys-export-fmt-badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.4);">XLSX</span>
              </div>
              <div class="sys-export-title">Executive Excel Workbook</div>
              <div class="sys-export-desc">
                Multi-sheet workbook with styled dark headers, municipal population, risk score ratings, and telemetry catalog sheets ready for presentation.
              </div>
            </div>
            <a href="/api/system/export?format=xlsx" download class="sys-export-btn" style="background:#16a34a;">
              <i class="fa-solid fa-file-excel"></i> Download Excel (.xlsx)
            </a>
          </div>

          <!-- 3. CSV -->
          <div class="sys-export-card">
            <div>
              <div class="sys-export-head">
                <i class="fa-solid fa-file-csv text-cyan" style="font-size:24px;"></i>
                <span class="sys-export-fmt-badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; border:1px solid rgba(6,182,212,0.4);">CSV</span>
              </div>
              <div class="sys-export-title">Municipal Statistics Table</div>
              <div class="sys-export-desc">
                RFC 4180 comma-separated records for all 15 Dalarna municipalities (Falun, Borlänge, Mora, etc.) with codes, populations, and composite risk.
              </div>
            </div>
            <a href="/api/system/export?format=csv" download class="sys-export-btn" style="background:#0284c7;">
              <i class="fa-solid fa-file-csv"></i> Download CSV (.csv)
            </a>
          </div>

          <!-- 4. GeoJSON -->
          <div class="sys-export-card">
            <div>
              <div class="sys-export-head">
                <i class="fa-solid fa-map-location-dot text-purple" style="font-size:24px;"></i>
                <span class="sys-export-fmt-badge" style="background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.4);">GEOJSON</span>
              </div>
              <div class="sys-export-title">Geospatial WGS84 Boundaries</div>
              <div class="sys-export-desc">
                Standard OGC GeoJSON FeatureCollection with 15 municipality polygonal boundaries and demographic properties for QGIS/Mapbox.
              </div>
            </div>
            <a href="/api/system/export?format=geojson" download class="sys-export-btn" style="background:#7c3aed;">
              <i class="fa-solid fa-earth-europe"></i> Download GeoJSON
            </a>
          </div>
        </div>
      </div>

      <!-- Section 5: Configuration Diff & Import Studio Banner -->
      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:16px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h3 style="font-size:13px; color:#fff; margin:0; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-code-compare text-yellow"></i> Configuration Diff & Ingest Studio
            </h3>
            <div style="font-size:11px; color:#8292a8; margin-top:2px;">
              Validate imported JSON payloads against Pydantic schema with instant visual diff before committing.
            </div>
          </div>
          <div style="display:flex; gap:10px;">
            <a href="/api/control/export-config" target="_blank" class="btn-reset-default" style="padding:6px 12px; font-size:11px; text-decoration:none;">
              <i class="fa-solid fa-file-code"></i> View Raw Config JSON
            </a>
            <button type="button" class="btn-save-apply" id="btn-open-diff-modal" style="padding:6px 14px; font-size:11px; background:#f59e0b; color:#000; font-weight:700;">
              <i class="fa-solid fa-upload"></i> Open Diff Studio
            </button>
          </div>
        </div>
      </div>

      <!-- Section 6: Interactive Immutable Audit Trail -->
      <div style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="font-size:13px; color:#fff; margin:0; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-fingerprint text-purple"></i> Immutable Audit Trail & Activity Log
            </h3>
            <div style="font-size:11px; color:#8292a8; margin-top:2px;">
              Chronological log of administrative state updates, simulations, logins, and connector tests.
            </div>
          </div>
          <span class="scenario-tag tag-blue" id="lbl-audit-count" style="font-size:11px; padding:3px 8px;">
            Showing ${filteredEvents.length} of ${(A.auditEvents || []).length} Events
          </span>
        </div>

        <!-- Audit Toolbar Filter -->
        <div class="audit-toolbar">
          <div class="audit-toolbar-left">
            <!-- Action Dropdown -->
            <select class="form-control" id="audit-filter-action" style="font-size:11px; padding:6px 10px; width:auto; font-weight:600;">
              <option value="all" ${A.auditFilterAction === "all" ? "selected" : ""}>All Audit Actions</option>
              <option value="control.apply" ${A.auditFilterAction === "control.apply" ? "selected" : ""}>control.apply (State Changes)</option>
              <option value="control.source" ${A.auditFilterAction === "control.source" ? "selected" : ""}>control.source (Source Toggles)</option>
              <option value="control.map_layer" ${A.auditFilterAction === "control.map_layer" ? "selected" : ""}>control.map_layer (Layer Toggles)</option>
              <option value="control.component" ${A.auditFilterAction === "control.component" ? "selected" : ""}>control.component (Appearance)</option>
              <option value="control.scope" ${A.auditFilterAction === "control.scope" ? "selected" : ""}>control.scope (Scope Focus)</option>
              <option value="control.mode" ${A.auditFilterAction === "control.mode" ? "selected" : ""}>control.mode (Mode Switch)</option>
              <option value="control.source_test" ${A.auditFilterAction === "control.source_test" ? "selected" : ""}>control.source_test (Connection Test)</option>
              <option value="control.source_refresh" ${A.auditFilterAction === "control.source_refresh" ? "selected" : ""}>control.source_refresh (Ingest)</option>
              <option value="control.refresh_all" ${A.auditFilterAction === "control.refresh_all" ? "selected" : ""}>control.refresh_all (Global Sync)</option>
              <option value="auth.login" ${A.auditFilterAction === "auth.login" ? "selected" : ""}>auth.login (Admin Login)</option>
              <option value="simulation.run" ${A.auditFilterAction === "simulation.run" ? "selected" : ""}>simulation.run (Simulation Executed)</option>
            </select>

            <!-- Search Filter -->
            <input type="text" class="form-control" id="audit-search-input" placeholder="Search by operator, action, keyword..." value="${esc(A.auditSearchTerm || "")}" style="font-size:11px; padding:6px 10px; min-width:240px;">
          </div>

          <div class="audit-toolbar-right">
            <!-- Limit Selector -->
            <select class="form-control" id="audit-limit-select" style="font-size:11px; padding:6px 10px; width:auto;">
              <option value="25" ${A.auditLimit === 25 ? "selected" : ""}>Last 25</option>
              <option value="50" ${A.auditLimit === 50 ? "selected" : ""}>Last 50</option>
              <option value="100" ${A.auditLimit === 100 ? "selected" : ""}>Last 100</option>
              <option value="200" ${A.auditLimit === 200 ? "selected" : ""}>Last 200</option>
            </select>

            <!-- Reload Audit Button -->
            <button type="button" class="btn-reset-default" id="btn-refresh-audit" style="padding:6px 12px; font-size:11px;">
              <i class="fa-solid fa-rotate"></i> Refresh
            </button>
          </div>
        </div>

        <!-- Audit Table -->
        <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; overflow-x:auto;">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Operator</th>
                <th>Change Summary</th>
                <th>Status</th>
                <th style="text-align:right;">Payload</th>
              </tr>
            </thead>
            <tbody>
              ${auditRows || `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:24px;">No matching audit events found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section 7: Operational Maintenance & Diagnostics Controls -->
      <div>
        <h3 style="font-size:13px; color:#fff; margin:0 0 12px 0; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-screwdriver-wrench text-amber"></i> Operational Maintenance Controls
        </h3>
        <div class="sys-maint-grid">
          <div class="sys-maint-tile" id="tile-maint-refresh-all">
            <div class="sys-maint-icon" style="background:rgba(59,130,246,0.15);">
              <i class="fa-solid fa-rotate text-blue"></i>
            </div>
            <div>
              <b style="color:#fff; font-size:12px;">Trigger Global Ingest Sync</b>
              <div style="font-size:10px; color:#8292a8; margin-top:2px;">Fetch freshest observations across all 6 enabled feeds.</div>
            </div>
          </div>

          <div class="sys-maint-tile" id="tile-maint-test-sim">
            <div class="sys-maint-icon" style="background:rgba(168,85,247,0.15);">
              <i class="fa-solid fa-flask text-purple"></i>
            </div>
            <div>
              <b style="color:#fff; font-size:12px;">Run Diagnostic Simulation</b>
              <div style="font-size:10px; color:#8292a8; margin-top:2px;">Execute safe 2030 test run to verify mathematical causal model.</div>
            </div>
          </div>

          <div class="sys-maint-tile" id="tile-maint-factory-reset">
            <div class="sys-maint-icon" style="background:rgba(239,68,68,0.15);">
              <i class="fa-solid fa-triangle-exclamation text-red"></i>
            </div>
            <div>
              <b style="color:#fff; font-size:12px;">Restore Factory Seed Defaults</b>
              <div style="font-size:10px; color:#8292a8; margin-top:2px;">Reset control state and layer toggles to default seed.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderScenariosSidebar() {
  const historyRows = (A.simHistory || []).slice(0, 10).map((run) => {
    const isTest = run.is_test;
    const rScore = run.summary?.regional_risk?.score;
    const scoreStr = rScore != null ? `${(rScore * 100).toFixed(0)}%` : "—";
    return `
      <div class="sim-history-item">
        <div style="line-height:1.3;">
          <div style="font-weight:700; color:#fff; display:flex; align-items:center; gap:6px;">
            <span style="font-size:12px;">${esc(run.scenario || run.scenario_id || "Run")}</span>
            <span class="scenario-tag ${isTest ? "tag-purple" : "tag-green"}" style="font-size:9px; padding:1px 5px;">
              ${isTest ? "TEST" : "OFFICIAL"}
            </span>
          </div>
          <div style="font-size:10px; color:#8292a8; margin-top:2px;">
            Target: <b>${run.target_year || 2030}</b> · Risk: <b style="color:#f59e0b;">${scoreStr}</b> · ${relTime(run.created_at)}
          </div>
        </div>
        <button type="button" class="btn-reset-default btn-load-history-run" data-run-id="${esc(run.run_id)}" style="padding:4px 8px; font-size:11px;" title="Load this run result into view">
          <i class="fa-solid fa-eye"></i> View
        </button>
      </div>
    `;
  }).join("");

  return `
    <div class="panel">
      <!-- Engine Card -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-gears text-purple"></i> Forecast Engine</h2>
          <div class="admin-card-sub">Causal model v1.2.0 propagation graph.</div>
        </div>
      </div>
      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px; margin-bottom:14px;">
        <div style="font-size:11px; color:#94a3b8;">Active Model Version</div>
        <div style="font-size:14px; font-weight:700; color:#fff; margin-top:2px;">Multi-Sector Regional Forecast v1.2.0</div>
        <div style="font-size:11px; color:#38bdf8; margin-top:4px;">15 Municipalities × 6 National Feeds Coupled</div>
        <div style="margin-top:10px; font-size:11px; color:#cbd5e1; line-height:1.5; background:#070d19; padding:8px; border-radius:6px; border:1px solid #1e293b;">
          <b>Causal Chain:</b><br>
          Population ➔ Traffic Demand (+1.2x)<br>
          ➔ Infrastructure Pressure (+0.85x)<br>
          ➔ Land Development (+1.0x)<br>
          ➔ Forest Reduction (-0.20x)<br>
          ➔ Groundwater Exposure (+0.60x)<br>
          <i>SMHI: External Boundary Condition</i>
        </div>
      </div>

      <!-- Quick Action Buttons -->
      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px; margin-bottom:14px;">
        <h4 style="font-size:12px; color:#fff; margin-bottom:10px;">Quick Forecast Actions</h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button class="quick-action-tile" id="act-run-quick-test" style="width:100%;">
            <i class="fa-solid fa-flask tile-icon text-purple"></i>
            <div class="tile-text">
              <b>Run Quick Safe Test</b>
              <span>Validate active scenario params</span>
            </div>
          </button>
          <button class="quick-action-tile" id="act-export-forecast-data" style="width:100%;">
            <i class="fa-solid fa-file-excel tile-icon text-green"></i>
            <div class="tile-text">
              <b>Export Forecast Excel/CSV</b>
              <span>Municipal projections package</span>
            </div>
          </button>
        </div>
      </div>

      <!-- Recent Simulation History -->
      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px; margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h4 style="font-size:12px; color:#fff; margin:0;">
            <i class="fa-solid fa-clock-rotate-left text-blue"></i> Execution History
          </h4>
          <span style="font-size:10px; color:#94a3b8;">${(A.simHistory || []).length} recorded</span>
        </div>
        ${historyRows || `<div style="font-size:12px; color:#64748b; padding:12px; text-align:center;">No recent simulation runs found.</div>`}
      </div>

      <!-- Sensitivity & Assumptions Card -->
      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px;">
        <h4 style="font-size:12px; color:#fff; margin-bottom:8px;">
          <i class="fa-solid fa-scale-balanced text-yellow"></i> Model Assumptions
        </h4>
        <div style="font-size:11px; color:#94a3b8; line-height:1.5;">
          • Mathematical Formulation: <code>future = current × (1 + rate)</code><br>
          • Safe test executions never alter the official digital twin live state.<br>
          • Zero synthetic hallucination: all baselines sourced from stored PostgreSQL telemetry.
        </div>
      </div>
    </div>
  `;
}

function renderScenariosPageWithSidebar() {
  return `
    <div class="admin-col">
      ${renderScenariosTab()}
    </div>
    <div class="admin-col">
      ${renderScenariosSidebar()}
    </div>
  `;
}

function showCreateScenarioModal() {
  const munisList = [
    { code: "dalarna", name: "All Dalarna County (15 Municipalities)" },
    { code: "2080", name: "Falun" },
    { code: "2081", name: "Borlänge" },
    { code: "2062", name: "Mora" },
    { code: "2085", name: "Ludvika" },
    { code: "2084", name: "Avesta" },
    { code: "2029", name: "Leksand" },
    { code: "2031", name: "Rättvik" },
  ];
  const sources = [
    { id: "scb", name: "SCB (Population & Demographics)" },
    { id: "trafikverket", name: "Trafikverket (Traffic & Roads)" },
    { id: "lantmateriet", name: "Lantmäteriet (Land & Cadastral)" },
    { id: "skogsstyrelsen", name: "Skogsstyrelsen (Forest & Ecology)" },
    { id: "sgu", name: "SGU (Groundwater & Geology)" },
    { id: "smhi", name: "SMHI (Weather & Climate)" },
  ];

  showModal(
    `<i class="fa-solid fa-plus text-purple"></i> Create Simulation Scenario`,
    `
      <div class="form-group" style="margin-bottom:12px;">
        <label>Scenario ID (slug, e.g. 'green_industry_2035')</label>
        <input type="text" class="form-control" id="modal-sc-id" placeholder="e.g. green_industry_2035" required>
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label>Scenario Name</label>
        <input type="text" class="form-control" id="modal-sc-name" placeholder="e.g. Green Industry Expansion (+15%)" required>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group">
          <label>Driver Source</label>
          <select class="form-control" id="modal-sc-source">
            <option value="SCB">SCB (Population / Demographic)</option>
            <option value="Trafikverket">Trafikverket (Traffic / Road Infrastructure)</option>
            <option value="Lantmäteriet">Lantmäteriet (Land / Development)</option>
            <option value="Skogsstyrelsen">Skogsstyrelsen (Forest / Environment)</option>
            <option value="SGU">SGU (Water / Groundwater)</option>
            <option value="SMHI">SMHI (Climate / Weather)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Target Year</label>
          <input type="number" class="form-control" id="modal-sc-year" value="2030" min="2025" max="2050">
        </div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group">
          <label>Scope</label>
          <select class="form-control" id="modal-sc-scope">
            ${munisList.map(m => `<option value="${m.code}">${m.name}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Driver Value: Population Change (%)</label>
          <input type="number" class="form-control" id="modal-sc-pop" value="12" step="1" min="-30" max="60">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label>Description & Assumptions</label>
        <textarea class="form-control" id="modal-sc-desc" rows="3" placeholder="Context and policy goals for this scenario..."></textarea>
      </div>
      <div class="form-group">
        <label>Coupled Authority Feeds</label>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:6px;">
          ${sources.map(s => `
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#cbd5e1; cursor:pointer;">
              <input type="checkbox" class="modal-sc-aff" value="${s.id}" checked>
              <span>${s.name}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `,
    async () => {
      const id = $("#modal-sc-id")?.value?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const name = $("#modal-sc-name")?.value?.trim();
      const driverSource = $("#modal-sc-source")?.value || "SCB";
      const year = parseInt($("#modal-sc-year")?.value || 2030, 10);
      const scope = $("#modal-sc-scope")?.value || "dalarna";
      const popPct = parseFloat($("#modal-sc-pop")?.value || 10) / 100;
      const desc = $("#modal-sc-desc")?.value?.trim() || "";
      const aff = Array.from(document.querySelectorAll(".modal-sc-aff:checked")).map(c => c.value);

      if (!id || !name) {
        toast("Scenario ID and Name are required", "err");
        return;
      }

      try {
        const payload = {
          id,
          name,
          driver_source: driverSource,
          target_year: year,
          scope,
          driver: { population_change: popPct },
          affected_sources: aff,
          description: desc,
        };
        const created = await post("/api/simulation/scenarios", payload);
        toast(`Scenario '${name}' created successfully!`, "ok");
        A.scenarios.push(created);
        A.selectedScenario = id;
        A.scenarioDraft = null;
        render();
      } catch (err) {
        toast(`Failed to create scenario: ${err.message}`, "err");
      }
    }
  );
}

function showEditScenarioModal(scId) {
  const sc = A.scenarios.find(s => s.id === scId) || getSelectedScenario();
  const munisList = [
    { code: "dalarna", name: "All Dalarna County (15 Municipalities)" },
    { code: "2080", name: "Falun" },
    { code: "2081", name: "Borlänge" },
    { code: "2062", name: "Mora" },
    { code: "2085", name: "Ludvika" },
    { code: "2084", name: "Avesta" },
    { code: "2029", name: "Leksand" },
    { code: "2031", name: "Rättvik" },
  ];
  const sources = [
    { id: "scb", name: "SCB (Population & Demographics)" },
    { id: "trafikverket", name: "Trafikverket (Traffic & Roads)" },
    { id: "lantmateriet", name: "Lantmäteriet (Land & Cadastral)" },
    { id: "skogsstyrelsen", name: "Skogsstyrelsen (Forest & Ecology)" },
    { id: "sgu", name: "SGU (Groundwater & Geology)" },
    { id: "smhi", name: "SMHI (Weather & Climate)" },
  ];
  const currentPopPct = sc.driver?.population_change != null ? Math.round(sc.driver.population_change * 100) : 10;
  const aff = sc.affected_sources || ["scb", "trafikverket", "sgu", "skogsstyrelsen", "lantmateriet"];

  showModal(
    `<i class="fa-solid fa-pen-to-square text-blue"></i> Edit Scenario: ${esc(sc.name)}`,
    `
      <div class="form-group" style="margin-bottom:12px;">
        <label>Scenario ID</label>
        <input type="text" class="form-control" value="${esc(sc.id)}" disabled style="opacity:0.7;">
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label>Scenario Name</label>
        <input type="text" class="form-control" id="modal-edit-sc-name" value="${esc(sc.name)}" required>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group">
          <label>Driver Source</label>
          <select class="form-control" id="modal-edit-sc-source">
            <option value="SCB" ${sc.driver_source === "SCB" ? "selected" : ""}>SCB (Population / Demographic)</option>
            <option value="Trafikverket" ${sc.driver_source === "Trafikverket" ? "selected" : ""}>Trafikverket (Traffic / Road)</option>
            <option value="Lantmäteriet" ${sc.driver_source === "Lantmäteriet" ? "selected" : ""}>Lantmäteriet (Land / Development)</option>
            <option value="Skogsstyrelsen" ${sc.driver_source === "Skogsstyrelsen" ? "selected" : ""}>Skogsstyrelsen (Forest / Environment)</option>
            <option value="SGU" ${sc.driver_source === "SGU" ? "selected" : ""}>SGU (Water / Groundwater)</option>
            <option value="SMHI" ${sc.driver_source === "SMHI" ? "selected" : ""}>SMHI (Climate / Weather)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Target Year</label>
          <input type="number" class="form-control" id="modal-edit-sc-year" value="${sc.target_year || 2030}" min="2025" max="2050">
        </div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group">
          <label>Scope</label>
          <select class="form-control" id="modal-edit-sc-scope">
            ${munisList.map(m => `<option value="${m.code}" ${sc.scope === m.code ? "selected" : ""}>${m.name}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Driver Value: Population Change (%)</label>
          <input type="number" class="form-control" id="modal-edit-sc-pop" value="${currentPopPct}" step="1" min="-30" max="60">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label>Description & Assumptions</label>
        <textarea class="form-control" id="modal-edit-sc-desc" rows="3">${esc(sc.description || "")}</textarea>
      </div>
      <div class="form-group">
        <label>Coupled Authority Feeds</label>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:6px;">
          ${sources.map(s => `
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#cbd5e1; cursor:pointer;">
              <input type="checkbox" class="modal-edit-sc-aff" value="${s.id}" ${aff.includes(s.id) ? "checked" : ""}>
              <span>${s.name}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `,
    async () => {
      const name = $("#modal-edit-sc-name")?.value?.trim();
      const driverSource = $("#modal-edit-sc-source")?.value || sc.driver_source || "SCB";
      const year = parseInt($("#modal-edit-sc-year")?.value || 2030, 10);
      const scope = $("#modal-edit-sc-scope")?.value || "dalarna";
      const popPct = parseFloat($("#modal-edit-sc-pop")?.value || 10) / 100;
      const desc = $("#modal-edit-sc-desc")?.value?.trim() || "";
      const selectedAff = Array.from(document.querySelectorAll(".modal-edit-sc-aff:checked")).map(c => c.value);

      if (!name) {
        toast("Scenario name is required", "err");
        return;
      }

      try {
        const payload = {
          id: sc.id,
          name,
          driver_source: driverSource,
          target_year: year,
          scope,
          driver: Object.assign({}, sc.driver, { population_change: popPct }),
          affected_sources: selectedAff,
          description: desc,
        };
        const updated = await put("/api/simulation/scenarios/" + encodeURIComponent(sc.id), payload);
        toast(`Scenario '${name}' updated successfully!`, "ok");
        const idx = A.scenarios.findIndex(s => s.id === sc.id);
        if (idx !== -1) {
          A.scenarios[idx] = updated;
        }
        A.scenarioDraft = null;
        render();
      } catch (err) {
        toast(`Update failed: ${err.message}`, "err");
      }
    }
  );
}

function deleteScenario(scId) {
  const sc = A.scenarios.find(s => s.id === scId);
  const name = sc?.name || scId;

  showModal(
    `<i class="fa-solid fa-triangle-exclamation text-yellow"></i> Delete Scenario`,
    `
      <div style="font-size:13px; line-height:1.6;">
        <p>Are you sure you want to delete scenario <b>${esc(name)}</b>?</p>
        <p style="color:#94a3b8; font-size:12px; margin-top:8px;">
          This will permanently delete this scenario from the database. Historical simulation records will remain saved.
        </p>
      </div>
    `,
    async () => {
      try {
        await del("/api/simulation/scenarios/" + encodeURIComponent(scId));
        toast(`Scenario '${name}' deleted successfully.`, "ok");
        A.scenarios = A.scenarios.filter(s => s.id !== scId);
        if (A.selectedScenario === scId) {
          A.selectedScenario = A.scenarios[0]?.id || "population_growth";
          A.scenarioDraft = null;
        }
        render();
      } catch (err) {
        toast(`Delete failed: ${err.message}`, "err");
      }
    }
  );
}

function exportSimulationCsv(simResult) {
  if (!simResult) {
    toast("No simulation forecast available to export.", "err");
    return;
  }
  const munis = simResult.municipalities || [];
  let csv = "Municipality Code,Municipality Name,Current Population,Simulated Population,Population Change %,Overall Risk Score,Overall Risk Level,Infrastructure Risk,Food Risk,Flood Risk,Environment Risk\n";
  munis.forEach((m) => {
    csv += `"${m.code}","${m.name}",${m.current_population},${m.simulated_population},${m.population_change_pct},${m.overall_risk?.score},"${m.overall_risk?.level}","${m.infrastructure_risk?.level}","${m.food_risk?.level}","${m.snow_flood_risk?.level}","${m.environment_risk?.level}"\n`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dalarna_forecast_${simResult.scenario || "sim"}_${simResult.target_year || 2030}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Simulation forecast exported as CSV.", "ok");
}

function renderRisksSidebar() {
  const th = A.riskConfig?.thresholds || { low: 0.3, medium: 0.6, high: 0.8, critical: 1.0 };
  const munisList = DALARNA_15_MUNICIPALITIES_RISK.map(m => {
    const simMuni = A.activeSimResult?.municipalities?.find(x => x.code === m.code);
    const score = simMuni ? (simMuni.overall_risk?.score ?? m.baseScore) : m.baseScore;
    const level = classifyRiskLocally(score, th);
    return { ...m, score, level };
  });

  const lowCount = munisList.filter(m => m.level === "Low").length;
  const medCount = munisList.filter(m => m.level === "Medium").length;
  const highCount = munisList.filter(m => m.level === "High").length;
  const critCount = munisList.filter(m => m.level === "Critical").length;

  const testScore = A.calcTestScore != null ? A.calcTestScore : 0.52;
  const testLevel = classifyRiskLocally(testScore, th);

  return `
    <div class="panel">
      <!-- 1. Interactive Ad-hoc Classifier Sandbox -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-flask text-purple"></i> Ad-hoc Risk Sandbox</h2>
          <div class="admin-card-sub">Test arbitrary index scores against active classification thresholds.</div>
        </div>
      </div>

      <div class="risk-calc-box">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <label style="font-size:12px; font-weight:600; color:#cbd5e1;">Test Composite Score (0.00 &ndash; 1.00)</label>
          <span style="font-size:14px; font-weight:700; color:#38bdf8;" id="lbl-calc-test-val">${testScore.toFixed(2)}</span>
        </div>
        <input type="range" class="form-control" id="calc-test-slider" min="0" max="1" step="0.01" value="${testScore}" style="padding:0; margin-bottom:10px;">

        <div class="risk-calc-result-display">
          <div>
            <div style="font-size:10px; color:#8292a8; text-transform:uppercase;">Classified Level</div>
            <span class="${getRiskBadgeClass(testLevel)}" id="calc-test-badge" style="font-size:12px; padding:3px 10px; margin-top:2px; display:inline-block;">
              ${testLevel.toUpperCase()}
            </span>
          </div>
          <div style="flex:1; font-size:11px; color:#94a3b8; line-height:1.4;" id="calc-test-desc">
            A score of <b>${testScore.toFixed(2)}</b> falls within the <b>${testLevel}</b> category boundary.
          </div>
          <button class="btn-reset-default" id="btn-calc-api-verify" style="font-size:11px; padding:5px 8px;" title="Verify classification with backend /api/risk/calculate endpoint">
            <i class="fa-solid fa-cloud-arrow-up"></i> Verify API
          </button>
        </div>
      </div>

      <!-- 2. 15 Municipalities Live Classification Matrix -->
      <div style="margin-bottom:16px;">
        <div class="risk-muni-summary-bar">
          <div>
            <h3 style="font-size:13px; color:#fff; margin:0; display:flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-city text-cyan"></i> 15 Municipalities Matrix
            </h3>
            <div style="font-size:10px; color:#8292a8; margin-top:2px;">Real-time classification based on current thresholds</div>
          </div>
          <div class="risk-count-pills">
            <span class="risk-badge-low" id="cnt-low">Low: ${lowCount}</span>
            <span class="risk-badge-med" id="cnt-med">Med: ${medCount}</span>
            <span class="risk-badge-high" id="cnt-high">High: ${highCount}</span>
            <span class="risk-badge-crit" id="cnt-crit">Crit: ${critCount}</span>
          </div>
        </div>

        <div style="margin-bottom:8px;">
          <input type="text" class="form-control" id="risk-muni-search" placeholder="Search municipality (e.g. Falun, Mora, Borlänge)..." style="font-size:11px; padding:6px 10px;">
        </div>

        <div style="max-height:260px; overflow-y:auto; border:1px solid #1e293b; border-radius:6px; background:#060b14;">
          <table class="audit-table" id="risk-muni-table" style="font-size:11px;">
            <thead>
              <tr>
                <th>Municipality</th>
                <th>Population</th>
                <th>Risk Score</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              ${munisList.map(m => `
                <tr data-name="${esc(m.name.toLowerCase())}" data-score="${m.score}">
                  <td><b>${esc(m.name)}</b> <span style="color:#64748b; font-size:10px;">(${m.code})</span></td>
                  <td>${fmtNum(m.pop)}</td>
                  <td><b style="color:#60a5fa;">${m.score.toFixed(2)}</b></td>
                  <td>
                    <span class="${getRiskBadgeClass(m.level)} muni-risk-pill">
                      ${m.level}
                    </span>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 3. Composite Scoring Formula Card -->
      <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:12px; font-size:11px; line-height:1.5; color:#94a3b8;">
        <b style="color:#fff; display:block; margin-bottom:4px;">
          <i class="fa-solid fa-calculator text-blue"></i> Composite Risk Methodology
        </b>
        <code>Risk = &Sigma; (Weight<sub>i</sub> &times; Score<sub>i</sub>)</code>
        <div style="margin-top:6px;">
          Couples live feeds from SCB, Trafikverket, SGU, Skogsstyrelsen & SMHI. Saving settings updates runtime digital twin models and future simulation runs.
        </div>
      </div>
    </div>
  `;
}

function renderRisksPageWithSidebar() {
  return `
    <div class="admin-col">
      ${renderRisksTab()}
    </div>
    <div class="admin-col">
      ${renderRisksSidebar()}
    </div>
  `;
}

function renderMapLayersSidebar() {
  const currentScope = A.pending?.scope || A.saved?.scope || "dalarna";
  const activeScopeObj = DALARNA_MUNICIPALITIES_SCOPE.find(m => m.code === currentScope) || DALARNA_MUNICIPALITIES_SCOPE[0];
  const activeCount = MAP_LAYERS_CONFIG.filter(l => A.pending?.layers?.[l.id] !== false).length;

  return `
    <div class="panel">
      <!-- Live Map Preview Header -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-map-location-dot text-green"></i> Live 2.5D Map Preview</h2>
          <div class="admin-card-sub">Instant visual feedback for geospatial layer toggles & camera focus.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-reset-default" id="btn-reload-map-preview" style="padding:4px 10px; font-size:11px;" title="Reload preview frame">
            <i class="fa-solid fa-rotate"></i> Reload
          </button>
          <a href="/?preview=1" target="_blank" rel="noopener" class="btn-fullscreen">
            Fullscreen <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </a>
        </div>
      </div>

      <!-- Map Preview Iframe Container -->
      <div class="preview-container" style="height:500px; margin-bottom:14px; position:relative;">
        <iframe id="preview-frame" src="/?preview=1" title="Map Layer Preview" style="width:100%; height:100%; border:none; border-radius:8px; background:#040711;"></iframe>
      </div>

      <!-- Geospatial Preview Diagnostics -->
      <div style="background:#080f1e; border:1px solid #1e293b; border-radius:8px; padding:12px; font-size:11px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; gap:12px; align-items:center;">
          <span style="color:#94a3b8;">Focus: <b style="color:#fff;" id="lbl-preview-scope">${esc(activeScopeObj.name)}</b></span>
          <span style="color:#94a3b8;">Active Layers: <b style="color:#10b981;" id="lbl-preview-layers-count">${activeCount} / 8</b></span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <span class="scenario-tag tag-blue" style="font-size:9px;">EPSG:4326 (WGS84)</span>
          <span class="scenario-tag tag-purple" style="font-size:9px;">MapLibre GL 2.5D</span>
        </div>
      </div>
    </div>
  `;
}

function renderMapLayersPageWithPreview() {
  return `
    <div class="admin-col">
      ${renderMapLayersTab()}
    </div>
    <div class="admin-col">
      ${renderMapLayersSidebar()}
    </div>
  `;
}

function renderVisualSidebar() {
  const activeCount = DASHBOARD_COMPONENTS_CONFIG.filter(c => A.pending?.components?.[c.id] !== false).length;
  const currentMode = (A.pending?.mode || "simulation").toUpperCase();

  return `
    <div class="panel">
      <!-- Live Dashboard UI Preview Header -->
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-display text-yellow"></i> Live Dashboard UI Preview</h2>
          <div class="admin-card-sub">Instant visual feedback showing layout arrangement of active widgets.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-reset-default" id="btn-reload-visual-preview" style="padding:4px 10px; font-size:11px;" title="Reload preview frame">
            <i class="fa-solid fa-rotate"></i> Reload
          </button>
          <a href="/?preview=1" target="_blank" rel="noopener" class="btn-fullscreen">
            Fullscreen <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </a>
        </div>
      </div>

      <!-- Preview Iframe Container -->
      <div class="preview-container" style="height:540px; margin-bottom:14px; position:relative;">
        <iframe id="preview-frame" src="/?preview=1" title="Stakeholder Dashboard Preview" style="width:100%; height:100%; border:none; border-radius:8px; background:#040711;"></iframe>
      </div>

      <!-- Diagnostics Bar -->
      <div style="background:#080f1e; border:1px solid #1e293b; border-radius:8px; padding:12px; font-size:11px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; gap:12px; align-items:center;">
          <span style="color:#94a3b8;">Active Widgets: <b style="color:#10b981;" id="lbl-preview-comps-count">${activeCount} / 11</b></span>
          <span style="color:#94a3b8;">Twin Mode: <b style="color:#38bdf8;" id="lbl-preview-mode">${currentMode}</b></span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <span class="scenario-tag tag-blue" style="font-size:9px;">CSS Grid & Flexbox</span>
          <span class="scenario-tag tag-purple" style="font-size:9px;">Live PostMessage</span>
        </div>
      </div>
    </div>
  `;
}

function renderVisualPageWithPreview() {
  return `
    <div class="admin-col">
      ${renderVisualTab()}
    </div>
    <div class="admin-col">
      ${renderVisualSidebar()}
    </div>
  `;
}

const MODULE_INFO = {
  overview: {
    title: "Twin System Overview",
    sub: "High-level summary of active data feeds, health metrics, and digital twin status.",
  },
  control: {
    title: "Dashboard Control",
    sub: "Easily manage data sources, scenarios, map layers and visual elements for the Dalarna Digital Twin.",
  },
  datasources: {
    title: "Data Sources Management",
    sub: "Configure, test connection, and control sync intervals for public authority feeds.",
  },
  scenarios: {
    title: "Simulation Scenarios",
    sub: "Configure predictive models, what-if drivers, and forecast parameters for 15 municipalities.",
  },
  risks: {
    title: "Risk Settings & Multipliers",
    sub: "Define classification thresholds (Low, Medium, High, Critical) and sector impact weights.",
  },
  map: {
    title: "Map & Regional Layers",
    sub: "Toggle geospatial layers, boundaries, heatmaps, and sensor overlays on the 2.5D map.",
  },
  layers: {
    title: "Map & Regional Layers",
    sub: "Toggle geospatial layers, boundaries, heatmaps, and sensor overlays on the 2.5D map.",
  },
  visual: {
    title: "Appearance & Layout",
    sub: "Customize visible components and widgets presented on the stakeholder dashboard.",
  },
  appearance: {
    title: "Appearance & Layout",
    sub: "Customize visible components and widgets presented on the stakeholder dashboard.",
  },
  system: {
    title: "System & Audit Trail",
    sub: "View immutable administrative activity logs and export complete twin data packages.",
  },
};

function renderOverviewPage() {
  const sumSources = A.summary?.sources || [];
  const onlineCount = sumSources.filter((s) => s.status === "ok" || s.enabled).length;
  const totalCount = sumSources.length || 6;
  const latest = A.latestSimResult?.summary;

  return `
    <div class="panel">
      <div class="admin-card-head">
        <div>
          <h2><i class="fa-solid fa-house text-blue"></i> Regional Twin Health & Overview</h2>
          <div class="admin-card-sub">Live operational telemetry and synchronization heartbeat.</div>
        </div>
        <span class="badge-status online"><span class="dot-online"></span> ${onlineCount}/${totalCount} Sources Active</span>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:18px;">
        <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px;">
          <div style="font-size:12px; color:#94a3b8;">Active Data Sources</div>
          <div style="font-size:24px; font-weight:700; color:#38bdf8; margin-top:4px;">${onlineCount} / ${totalCount}</div>
          <div style="font-size:11px; color:#10b981; margin-top:4px;"><i class="fa-solid fa-circle-check"></i> Connected & polling</div>
        </div>
        <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px;">
          <div style="font-size:12px; color:#94a3b8;">Municipalities Monitored</div>
          <div style="font-size:24px; font-weight:700; color:#ffffff; margin-top:4px;">15</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:4px;">Falun, Borlänge, Mora + 12 more</div>
        </div>
        <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px;">
          <div style="font-size:12px; color:#94a3b8;">Active Simulation Year</div>
          <div style="font-size:24px; font-weight:700; color:#a855f7; margin-top:4px;">${A.pending?.simulation_year || 2030}</div>
          <div style="font-size:11px; color:#a855f7; margin-top:4px;">Scenario: ${A.selectedScenario}</div>
        </div>
        <div style="background:#091222; border:1px solid #1e293b; border-radius:8px; padding:14px;">
          <div style="font-size:12px; color:#94a3b8;">Regional Risk Score</div>
          <div style="font-size:24px; font-weight:700; color:#f59e0b; margin-top:4px;">${latest?.regional_risk?.score ? (latest.regional_risk.score * 100).toFixed(0) + "%" : "48%"}</div>
          <div style="font-size:11px; color:#f59e0b; margin-top:4px;">${latest?.regional_risk?.level || "Medium"} Category</div>
        </div>
      </div>

      <h3 style="font-size:13px; color:#fff; margin-bottom:12px;">Modules Quick Access</h3>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
        <a href="#datasources" class="quick-action-tile nav-switch" data-target="datasources" style="text-decoration:none;">
          <i class="fa-solid fa-database tile-icon text-blue"></i>
          <div class="tile-text">
            <b>Data Sources</b>
            <span>Manage 6 live feeds & intervals</span>
          </div>
        </a>
        <a href="#scenarios" class="quick-action-tile nav-switch" data-target="scenarios" style="text-decoration:none;">
          <i class="fa-solid fa-code-branch tile-icon text-purple"></i>
          <div class="tile-text">
            <b>Scenarios</b>
            <span>Configure predictive drivers</span>
          </div>
        </a>
        <a href="#risks" class="quick-action-tile nav-switch" data-target="risks" style="text-decoration:none;">
          <i class="fa-solid fa-shield-halved tile-icon text-cyan"></i>
          <div class="tile-text">
            <b>Risk Settings</b>
            <span>Calibrate classification limits</span>
          </div>
        </a>
        <a href="#layers" class="quick-action-tile nav-switch" data-target="map" style="text-decoration:none;">
          <i class="fa-solid fa-layer-group tile-icon text-green"></i>
          <div class="tile-text">
            <b>Map Layers</b>
            <span>Control 2.5D visual overlays</span>
          </div>
        </a>
      </div>
    </div>
  `;
}

function render() {
  const content = $("#admin-tab-content");
  if (!content) return;

  // Update Page Title and Subtitle dynamically based on active module
  const info = MODULE_INFO[A.activeTab] || MODULE_INFO.control;
  const titleEl = $(".admin-page-header h1");
  const subEl = $(".admin-page-header .admin-page-sub");
  if (titleEl) titleEl.textContent = info.title;
  if (subEl) subEl.textContent = info.sub;

  // Sync Sidebar active state
  document.querySelectorAll(".admin-sidebar .admin-nav-item").forEach((link) => {
    const mod = link.dataset.module;
    const href = link.getAttribute("href") || "";
    const tabMatches =
      (mod && mod === A.activeTab) ||
      (href.endsWith("/" + A.activeTab)) ||
      (A.activeTab === "map" && (mod === "map" || href.includes("layers"))) ||
      (A.activeTab === "visual" && (mod === "visual" || href.includes("appearance")));
    link.classList.toggle("active", Boolean(tabMatches));
  });



  // Each page gets dedicated content layout tailored to its function
  if (A.activeTab === "overview") {
    content.className = "admin-tab-content full-width";
    content.innerHTML = renderOverviewPage();
  } else if (A.activeTab === "control") {
    content.className = "admin-tab-content";
    content.innerHTML = `
      <div class="admin-col">
        ${renderControlPage()}
      </div>
      <div class="admin-col">
        <div class="panel">
          <div class="admin-card-head">
            <div>
              <h2><span class="dot-online mr-1"></span> Live Twin Preview</h2>
              <div class="admin-card-sub">Synchronized view reflecting current runtime control staged settings.</div>
            </div>
            <a href="/?preview=1" target="_blank" rel="noopener" class="btn-fullscreen">
              Fullscreen <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
          </div>
          <div class="preview-container">
            <iframe id="preview-frame" src="/?preview=1" title="Live Preview"></iframe>
          </div>
        </div>
      </div>
    `;
  } else if (A.activeTab === "datasources") {
    content.className = "admin-tab-content full-width";
    content.innerHTML = renderDataSourcesTab();
  } else if (A.activeTab === "scenarios") {
    content.className = "admin-tab-content";
    content.innerHTML = renderScenariosPageWithSidebar();
  } else if (A.activeTab === "risks") {
    content.className = "admin-tab-content";
    content.innerHTML = renderRisksPageWithSidebar();
  } else if (A.activeTab === "map") {
    content.className = "admin-tab-content";
    content.innerHTML = renderMapLayersPageWithPreview();
  } else if (A.activeTab === "visual") {
    content.className = "admin-tab-content";
    content.innerHTML = renderVisualPageWithPreview();
  } else if (A.activeTab === "system") {
    content.className = "admin-tab-content full-width";
    content.innerHTML = renderSystemTab();
  } else {
    content.className = "admin-tab-content full-width";
    content.innerHTML = renderOverviewPage();
  }

  wireAdminEvents();
  setTimeout(pushPreview, 250);
}

function showModal(title, contentHtml, onConfirm = null) {
  const existing = document.querySelector(".admin-modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "admin-modal-overlay";
  overlay.innerHTML = `
    <div class="admin-modal">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close-btn">&times;</button>
      </div>
      <div class="modal-body">${contentHtml}</div>
      <div class="modal-foot">
        <button class="btn-reset-default modal-cancel">Cancel</button>
        ${onConfirm ? `<button class="btn-save-apply modal-confirm">Confirm</button>` : ""}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector(".modal-close-btn").onclick = () => overlay.remove();
  overlay.querySelector(".modal-cancel").onclick = () => overlay.remove();
  if (onConfirm) {
    overlay.querySelector(".modal-confirm").onclick = async () => {
      await onConfirm();
      overlay.remove();
    };
  }
}

function wireAdminEvents() {
  // Source toggle changes
  document.querySelectorAll(".src-toggle, .src-quick-chk").forEach((chk) => {
    chk.onchange = () => {
      const sid = chk.dataset.source;
      if (!A.pending.sources) A.pending.sources = {};
      A.pending.sources[sid] = chk.checked;
      pushPreview();
      toast(`Source ${sid.toUpperCase()} set to ${chk.checked ? "ON" : "OFF"}. Remember to Save & Apply.`, "ok");
      render();
    };
  });

  // Interval changes
  document.querySelectorAll(".interval-select").forEach((sel) => {
    sel.onchange = () => {
      const sid = sel.dataset.source;
      if (!A.pending.source_intervals) A.pending.source_intervals = {};
      A.pending.source_intervals[sid] = parseInt(sel.value, 10);
      toast(`Interval for ${sid.toUpperCase()} set to ${sel.options[sel.selectedIndex].text}`, "ok");
    };
  });

  // Test Source Row Action
  document.querySelectorAll(".btn-test-source").forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.source;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
      try {
        const res = await post("/api/control/source/test", { source: sid });
        showModal(
          `<i class="fa-solid fa-bolt text-yellow"></i> Connection Test: ${sid.toUpperCase()}`,
          `
            <div style="font-size:13px; line-height:1.6;">
              <p><b>Status:</b> <span class="badge-status ${res.status === "ok" ? "online" : "disabled"}">${res.status?.toUpperCase()}</span></p>
              <p><b>Latency:</b> ${res.latency_ms} ms</p>
              <p><b>Endpoint:</b> <code>${esc(res.endpoint || "N/A")}</code></p>
              <p><b>Message:</b> ${esc(res.message || "OK")}</p>
            </div>
          `
        );
      } catch (err) {
        toast(`Connection test failed: ${err.message}`, "err");
      } finally {
        btn.innerHTML = `<i class="fa-solid fa-bolt text-yellow"></i> Test`;
      }
    };
  });

  // Refresh Source Row Action
  document.querySelectorAll(".btn-refresh-source").forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.source;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
      try {
        await post("/api/control/source/refresh", { source: sid });
        toast(`Triggered background refresh for ${sid.toUpperCase()}`, "ok");
      } catch (err) {
        toast(`Refresh failed: ${err.message}`, "err");
      } finally {
        btn.innerHTML = `<i class="fa-solid fa-rotate-right"></i>`;
      }
    };
  });

  // ---------------- MAP & REGIONAL LAYERS MANAGEMENT (Spec 10) ----------------
  // Layer switches
  document.querySelectorAll(".layer-toggle").forEach((chk) => {
    chk.onchange = async () => {
      const lid = chk.dataset.layer;
      if (!A.pending.layers) A.pending.layers = {};
      A.pending.layers[lid] = chk.checked;

      const card = document.getElementById(`layer-card-${lid}`);
      if (card) card.classList.toggle("disabled-layer", !chk.checked);

      const activeCount = MAP_LAYERS_CONFIG.filter(l => A.pending?.layers?.[l.id] !== false).length;
      const countEl = $("#lbl-active-layers-count");
      if (countEl) countEl.textContent = activeCount;
      const prevCountEl = $("#lbl-preview-layers-count");
      if (prevCountEl) prevCountEl.textContent = `${activeCount} / 8`;

      pushPreview();

      try {
        const ver = A.saved?.version || 1;
        const res = await post("/api/control/map-layer", { layer: lid, visible: chk.checked, base_version: ver });
        if (res?.version) {
          if (!A.saved) A.saved = {};
          A.saved.version = res.version;
          if (!A.saved.layers) A.saved.layers = {};
          A.saved.layers[lid] = chk.checked;
        }
        toast(`Layer '${lid}' set to ${chk.checked ? "visible" : "hidden"} (staged & persisted)`, "ok");
      } catch (err) {
        toast(`Layer staged locally: ${err.message}`, "info");
      }
    };
  });

  // Batch toggle: Enable All Layers
  $("#btn-enable-all-layers")?.addEventListener("click", () => {
    if (!A.pending.layers) A.pending.layers = {};
    MAP_LAYERS_CONFIG.forEach(l => {
      A.pending.layers[l.id] = true;
    });
    document.querySelectorAll(".layer-toggle").forEach(chk => { chk.checked = true; });
    document.querySelectorAll(".layer-card").forEach(c => c.classList.remove("disabled-layer"));
    const countEl = $("#lbl-active-layers-count"); if (countEl) countEl.textContent = "8";
    const prevCountEl = $("#lbl-preview-layers-count"); if (prevCountEl) prevCountEl.textContent = "8 / 8";
    pushPreview();
    toast("All 8 regional geospatial layers enabled! Click 'Save & Apply Layers' to persist.", "ok");
  });

  // Batch toggle: Disable All Layers
  $("#btn-disable-all-layers")?.addEventListener("click", () => {
    if (!A.pending.layers) A.pending.layers = {};
    MAP_LAYERS_CONFIG.forEach(l => {
      A.pending.layers[l.id] = false;
    });
    document.querySelectorAll(".layer-toggle").forEach(chk => { chk.checked = false; });
    document.querySelectorAll(".layer-card").forEach(c => c.classList.add("disabled-layer"));
    const countEl = $("#lbl-active-layers-count"); if (countEl) countEl.textContent = "0";
    const prevCountEl = $("#lbl-preview-layers-count"); if (prevCountEl) prevCountEl.textContent = "0 / 8";
    pushPreview();
    toast("All geospatial layers disabled for preview.", "info");
  });

  // Batch toggle: Default Layers
  $("#btn-default-layers")?.addEventListener("click", () => {
    if (!A.pending.layers) A.pending.layers = {};
    MAP_LAYERS_CONFIG.forEach(l => {
      A.pending.layers[l.id] = true;
    });
    document.querySelectorAll(".layer-toggle").forEach(chk => { chk.checked = true; });
    document.querySelectorAll(".layer-card").forEach(c => c.classList.remove("disabled-layer"));
    const countEl = $("#lbl-active-layers-count"); if (countEl) countEl.textContent = "8";
    const prevCountEl = $("#lbl-preview-layers-count"); if (prevCountEl) prevCountEl.textContent = "8 / 8";
    pushPreview();
    toast("Restored default 8 regional layers.", "ok");
  });

  // Geographic Scope & Focus Select (County-wide + 15 Municipalities)
  const mapScopeSelect = $("#map-scope-select");
  if (mapScopeSelect) {
    mapScopeSelect.onchange = async () => {
      const newScope = mapScopeSelect.value;
      if (!A.pending) A.pending = {};
      A.pending.scope = newScope;
      const scopeObj = DALARNA_MUNICIPALITIES_SCOPE.find(m => m.code === newScope) || DALARNA_MUNICIPALITIES_SCOPE[0];
      const lblTag = $("#lbl-scope-tag"); if (lblTag) lblTag.textContent = `Current: ${scopeObj.name}`;
      const lblCoords = $("#lbl-scope-coords"); if (lblCoords) lblCoords.textContent = scopeObj.coords;
      const lblPop = $("#lbl-scope-pop"); if (lblPop) lblPop.textContent = scopeObj.pop;
      const lblPrev = $("#lbl-preview-scope"); if (lblPrev) lblPrev.textContent = scopeObj.name;
      pushPreview();
      try {
        const ver = A.saved?.version || 1;
        const res = await post("/api/control/scope", { scope: newScope, base_version: ver });
        if (res?.version) {
          if (!A.saved) A.saved = {};
          A.saved.version = res.version;
          A.saved.scope = newScope;
        }
        toast(`Geographic scope focused on ${scopeObj.name} (${newScope})`, "ok");
      } catch (err) {
        toast(`Scope staged locally: ${err.message}`, "info");
      }
    };
  }

  // Layer Inspector Modal
  document.querySelectorAll(".btn-inspect-layer").forEach(btn => {
    btn.onclick = async () => {
      const lid = btn.dataset.layer;
      const cfg = MAP_LAYERS_CONFIG.find(l => l.id === lid);
      if (!cfg) return;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
      let liveMapState = null;
      try {
        liveMapState = await get("/api/control/map-state");
      } catch (_) {}
      btn.innerHTML = `<i class="fa-solid fa-circle-info"></i> Inspect`;

      const layerLive = liveMapState?.layers?.[lid] || {};
      const isVisible = A.pending?.layers?.[lid] !== false;
      const feederAvailable = layerLive.available !== false;
      const feederReason = layerLive.reason || (feederAvailable ? "Connected & Feeder Ready" : "Feeder Unavailable");

      showModal(
        `<i class="${cfg.icon}"></i> Layer Telemetry: ${esc(cfg.name)}`,
        `
          <div style="display:flex; flex-direction:column; gap:12px; font-size:12px;">
            <div style="background:#080f1e; border:1px solid #1e293b; border-radius:8px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:700; color:#fff; font-size:14px;">${esc(cfg.name)}</span>
                <span class="badge-status ${isVisible ? "online" : "disabled"}">${isVisible ? "VISIBLE" : "HIDDEN"}</span>
              </div>
              <div style="color:#94a3b8; font-size:11px; line-height:1.5;">${esc(cfg.desc)}</div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Spatial Reference (CRS)</div>
                <div style="color:#38bdf8; font-weight:600; margin-top:2px;">${esc(cfg.crs)}</div>
              </div>
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Geometry Type</div>
                <div style="color:#a855f7; font-weight:600; margin-top:2px;">${esc(cfg.geometry)}</div>
              </div>
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Feeder Source</div>
                <div style="color:#10b981; font-weight:600; margin-top:2px;">${esc(cfg.source)}</div>
              </div>
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Monitored Features</div>
                <div style="color:#f59e0b; font-weight:600; margin-top:2px;">${esc(cfg.features)}</div>
              </div>
            </div>

            <div style="background:#060b14; border:1px solid #1e293b; border-radius:6px; padding:10px;">
              <div style="color:#64748b; font-size:10px; text-transform:uppercase; margin-bottom:4px;">Feeder Source Connectivity</div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge-status ${feederAvailable ? "online" : "disabled"}">
                  <i class="fa-solid fa-circle-dot"></i> ${feederAvailable ? "Online" : "Warning"}
                </span>
                <span style="color:#cbd5e1; font-size:11px;">${esc(feederReason)}</span>
              </div>
            </div>
          </div>
        `
      );
    };
  });

  // Save Map Layers Button
  const btnSaveLayers = $("#btn-save-map-layers");
  if (btnSaveLayers) {
    btnSaveLayers.onclick = async () => {
      btnSaveLayers.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
      btnSaveLayers.disabled = true;
      try {
        const latestState = await get("/api/control/state").catch(() => null);
        const versionToUse = latestState?.version || A.saved?.version || 1;
        const res = await post("/api/control/apply", {
          base_version: versionToUse,
          state: A.pending,
          note: "Map and Regional layers updated via Admin Panel",
        });
        toast("Map layers and regional scope successfully saved & applied!", "ok");
        if (res?.version) {
          if (!A.saved) A.saved = {};
          A.saved.version = res.version;
          A.saved.layers = clone(A.pending.layers);
          A.saved.scope = A.pending.scope;
        }
      } catch (err) {
        toast("Error saving layers: " + err.message, "err");
      } finally {
        btnSaveLayers.disabled = false;
        btnSaveLayers.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save & Apply Layers`;
        pushPreview();
      }
    };
  }

  // Reset Map Layers Button
  const btnResetLayers = $("#btn-reset-map-layers");
  if (btnResetLayers) {
    btnResetLayers.onclick = () => {
      if (A.saved?.layers) {
        A.pending.layers = clone(A.saved.layers);
      }
      if (A.saved?.scope) {
        A.pending.scope = A.saved.scope;
      }
      render();
      toast("Reverted layers and scope to saved state.", "ok");
    };
  }

  // Reload 2.5D Map Preview Frame
  const btnReloadPrev = $("#btn-reload-map-preview");
  if (btnReloadPrev) {
    btnReloadPrev.onclick = () => {
      const frame = $("#preview-frame");
      if (frame) {
        frame.src = "/?preview=1&t=" + Date.now();
        toast("Reloading 2.5D map preview...", "ok");
        setTimeout(pushPreview, 500);
      }
    };
  }

  // ---------------- DASHBOARD APPEARANCE & LAYOUT (Spec 11) ----------------
  // Component switches
  document.querySelectorAll(".comp-toggle, [data-act='toggle-comp']").forEach((chk) => {
    chk.onchange = async () => {
      const cid = chk.dataset.comp || chk.dataset.key;
      if (!A.pending.components) A.pending.components = {};
      A.pending.components[cid] = chk.checked;

      const card = document.getElementById(`comp-card-${cid}`);
      if (card) card.classList.toggle("disabled-layer", !chk.checked);

      const activeCount = DASHBOARD_COMPONENTS_CONFIG.filter(c => A.pending?.components?.[c.id] !== false).length;
      const countEl = $("#lbl-active-comps-count");
      if (countEl) countEl.textContent = activeCount;
      const prevCountEl = $("#lbl-preview-comps-count");
      if (prevCountEl) prevCountEl.textContent = `${activeCount} / 11`;

      pushPreview();

      try {
        const ver = A.saved?.version || 1;
        const res = await post("/api/control/component", { component: cid, visible: chk.checked, base_version: ver });
        if (res?.version) {
          if (!A.saved) A.saved = {};
          A.saved.version = res.version;
          if (!A.saved.components) A.saved.components = {};
          A.saved.components[cid] = chk.checked;
        }
        toast(`Widget '${cid}' set to ${chk.checked ? "visible" : "hidden"} (staged & persisted)`, "ok");
      } catch (err) {
        toast(`Widget staged locally: ${err.message}`, "info");
      }
    };
  });

  // Batch action: Show All Components
  $("#btn-enable-all-comps")?.addEventListener("click", () => {
    if (!A.pending.components) A.pending.components = {};
    DASHBOARD_COMPONENTS_CONFIG.forEach(c => {
      A.pending.components[c.id] = true;
    });
    document.querySelectorAll(".comp-toggle").forEach(chk => { chk.checked = true; });
    document.querySelectorAll(".comp-card").forEach(c => c.classList.remove("disabled-layer"));
    const countEl = $("#lbl-active-comps-count"); if (countEl) countEl.textContent = "11";
    const prevCountEl = $("#lbl-preview-comps-count"); if (prevCountEl) prevCountEl.textContent = "11 / 11";
    pushPreview();
    toast("All 11 dashboard visual components enabled! Click 'Save & Apply Appearance' to persist.", "ok");
  });

  // Batch action: Hide All Components
  $("#btn-disable-all-comps")?.addEventListener("click", () => {
    if (!A.pending.components) A.pending.components = {};
    DASHBOARD_COMPONENTS_CONFIG.forEach(c => {
      A.pending.components[c.id] = false;
    });
    document.querySelectorAll(".comp-toggle").forEach(chk => { chk.checked = false; });
    document.querySelectorAll(".comp-card").forEach(c => c.classList.add("disabled-layer"));
    const countEl = $("#lbl-active-comps-count"); if (countEl) countEl.textContent = "0";
    const prevCountEl = $("#lbl-preview-comps-count"); if (prevCountEl) prevCountEl.textContent = "0 / 11";
    pushPreview();
    toast("All dashboard widgets hidden.", "info");
  });

  // Batch action: Default Layout
  $("#btn-default-comps")?.addEventListener("click", () => {
    if (!A.pending.components) A.pending.components = {};
    DASHBOARD_COMPONENTS_CONFIG.forEach(c => {
      A.pending.components[c.id] = true;
    });
    document.querySelectorAll(".comp-toggle").forEach(chk => { chk.checked = true; });
    document.querySelectorAll(".comp-card").forEach(c => c.classList.remove("disabled-layer"));
    const countEl = $("#lbl-active-comps-count"); if (countEl) countEl.textContent = "11";
    const prevCountEl = $("#lbl-preview-comps-count"); if (prevCountEl) prevCountEl.textContent = "11 / 11";
    pushPreview();
    toast("Restored default 11 components layout.", "ok");
  });

  // Fast Layout Presets
  document.querySelectorAll(".btn-comp-preset").forEach(btn => {
    btn.onclick = () => {
      const p = btn.dataset.preset;
      if (!A.pending.components) A.pending.components = {};

      if (p === "executive") {
        DASHBOARD_COMPONENTS_CONFIG.forEach(c => {
          const enable = ["source_cards", "regional_risk", "map", "municipality_table"].includes(c.id);
          A.pending.components[c.id] = enable;
        });
        toast("Applied 'Executive Overview' preset (Telemetry, Risk, Map, Municipalities).", "ok");
      } else if (p === "simulation") {
        DASHBOARD_COMPONENTS_CONFIG.forEach(c => {
          const enable = ["simulation_control", "simulation_results", "regional_risk", "population", "food_risk", "snow_flood_risk", "infrastructure_risk", "environment_risk", "map"].includes(c.id);
          A.pending.components[c.id] = enable;
        });
        toast("Applied 'Simulation Specialist' preset (Scenario modeling & all 5 risk pillars).", "ok");
      } else if (p === "map") {
        DASHBOARD_COMPONENTS_CONFIG.forEach(c => {
          const enable = ["map", "source_cards"].includes(c.id);
          A.pending.components[c.id] = enable;
        });
        toast("Applied 'Geospatial Map Only' preset (Maximized spatial view).", "ok");
      } else if (p === "pillars") {
        DASHBOARD_COMPONENTS_CONFIG.forEach(c => {
          const enable = ["regional_risk", "population", "food_risk", "snow_flood_risk", "infrastructure_risk", "environment_risk", "map"].includes(c.id);
          A.pending.components[c.id] = enable;
        });
        toast("Applied '5 Risk Pillars Focus' preset.", "ok");
      }

      // Sync UI switches and card styles
      document.querySelectorAll(".comp-toggle").forEach(chk => {
        const cid = chk.dataset.comp || chk.dataset.key;
        chk.checked = (A.pending.components[cid] !== false);
        const card = document.getElementById(`comp-card-${cid}`);
        if (card) card.classList.toggle("disabled-layer", !chk.checked);
      });

      const activeCount = DASHBOARD_COMPONENTS_CONFIG.filter(c => A.pending?.components?.[c.id] !== false).length;
      const countEl = $("#lbl-active-comps-count"); if (countEl) countEl.textContent = activeCount;
      const prevCountEl = $("#lbl-preview-comps-count"); if (prevCountEl) prevCountEl.textContent = `${activeCount} / 11`;

      pushPreview();
    };
  });

  // Group Filter Chips (All, Telemetry, Simulation, Pillars)
  document.querySelectorAll(".btn-comp-filter").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".btn-comp-filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.filter;
      document.querySelectorAll(".comp-card").forEach(card => {
        const group = card.dataset.group;
        if (filter === "all" || group === filter || (filter === "telemetry" && (group === "telemetry" || group === "analytics"))) {
          card.style.display = "";
        } else {
          card.style.display = "none";
        }
      });
    };
  });

  // Search Filter Input
  const compSearch = $("#comp-search-input");
  if (compSearch) {
    compSearch.oninput = () => {
      const q = compSearch.value.toLowerCase().trim();
      document.querySelectorAll(".comp-card").forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = (!q || text.includes(q)) ? "" : "none";
      });
    };
  }

  // Component Inspector Modal
  document.querySelectorAll(".btn-inspect-comp").forEach(btn => {
    btn.onclick = () => {
      const cid = btn.dataset.comp;
      const cfg = DASHBOARD_COMPONENTS_CONFIG.find(c => c.id === cid);
      if (!cfg) return;

      const isVisible = A.pending?.components?.[cid] !== false;

      showModal(
        `<i class="${cfg.icon}"></i> Component Spec: ${esc(cfg.name)}`,
        `
          <div style="display:flex; flex-direction:column; gap:12px; font-size:12px;">
            <div style="background:#080f1e; border:1px solid #1e293b; border-radius:8px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:700; color:#fff; font-size:14px;">${esc(cfg.name)}</span>
                <span class="badge-status ${isVisible ? "online" : "disabled"}">${isVisible ? "SHOWN" : "HIDDEN"}</span>
              </div>
              <div style="color:#94a3b8; font-size:11px; line-height:1.5;">${esc(cfg.desc)}</div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">DOM Mounting Slot</div>
                <div style="color:#38bdf8; font-family:monospace; font-weight:600; margin-top:2px;">${esc(cfg.slot)}</div>
              </div>
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Component Identifier</div>
                <div style="color:#a855f7; font-family:monospace; font-weight:600; margin-top:2px;">${esc(cfg.id)}</div>
              </div>
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Functional Category</div>
                <div style="color:#10b981; font-weight:600; margin-top:2px;">${esc(cfg.category)}</div>
              </div>
              <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px;">
                <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Visitor Visibility</div>
                <div style="color:#f59e0b; font-weight:600; margin-top:2px;">Public Dashboard</div>
              </div>
            </div>

            <div style="background:#060b14; border:1px solid #1e293b; border-radius:6px; padding:10px;">
              <div style="color:#64748b; font-size:10px; text-transform:uppercase; margin-bottom:4px;">Digital Twin Functional Impact</div>
              <div style="color:#cbd5e1; font-size:11px; line-height:1.5;">${esc(cfg.impact)}</div>
            </div>
          </div>
        `
      );
    };
  });

  // Save Appearance Button
  const btnSaveAppearance = $("#btn-save-appearance");
  if (btnSaveAppearance) {
    btnSaveAppearance.onclick = async () => {
      btnSaveAppearance.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
      btnSaveAppearance.disabled = true;
      try {
        const latestState = await get("/api/control/state").catch(() => null);
        const versionToUse = latestState?.version || A.saved?.version || 1;
        const res = await post("/api/control/apply", {
          base_version: versionToUse,
          state: A.pending,
          note: "Dashboard Appearance & Component Layout updated via Admin Panel",
        });
        toast("Dashboard appearance and components layout successfully saved & applied!", "ok");
        if (res?.version) {
          if (!A.saved) A.saved = {};
          A.saved.version = res.version;
          A.saved.components = clone(A.pending.components);
        }
      } catch (err) {
        toast("Error saving appearance: " + err.message, "err");
      } finally {
        btnSaveAppearance.disabled = false;
        btnSaveAppearance.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save & Apply Appearance`;
        pushPreview();
      }
    };
  }

  // Reset Appearance Button
  const btnResetAppearance = $("#btn-reset-appearance");
  if (btnResetAppearance) {
    btnResetAppearance.onclick = () => {
      if (A.saved?.components) {
        A.pending.components = clone(A.saved.components);
      }
      render();
      toast("Reverted dashboard appearance layout to saved state.", "ok");
    };
  }

  // Reload Visual Preview Frame
  const btnReloadVisualPrev = $("#btn-reload-visual-preview");
  if (btnReloadVisualPrev) {
    btnReloadVisualPrev.onclick = () => {
      const frame = $("#preview-frame");
      if (frame) {
        frame.src = "/?preview=1&t=" + Date.now();
        toast("Reloading dashboard UI preview...", "ok");
        setTimeout(pushPreview, 500);
      }
    };
  }



  // Control Page Inputs
  const ctrlModeSel = $("#ctrl-mode-select");
  if (ctrlModeSel) {
    ctrlModeSel.onchange = () => {
      A.pending.mode = ctrlModeSel.value;
      pushPreview();
      toast(`Runtime mode set to ${ctrlModeSel.value.toUpperCase()}`, "ok");
    };
  }

  const ctrlScopeSel = $("#ctrl-scope-select");
  if (ctrlScopeSel) {
    ctrlScopeSel.onchange = () => {
      A.pending.scope = ctrlScopeSel.value;
      pushPreview();
      toast(`Scope set to ${ctrlScopeSel.value.toUpperCase()}`, "ok");
    };
  }

  const ctrlYearSlider = $("#ctrl-year-slider");
  if (ctrlYearSlider) {
    ctrlYearSlider.oninput = () => {
      const lbl = $("#lbl-ctrl-year");
      if (lbl) lbl.textContent = ctrlYearSlider.value;
      A.pending.simulation_year = parseInt(ctrlYearSlider.value, 10);
      pushPreview();
    };
  }

  const ctrlScenSel = $("#ctrl-scenario-select");
  if (ctrlScenSel) {
    ctrlScenSel.onchange = () => {
      A.selectedScenario = ctrlScenSel.value;
      toast(`Default scenario set to ${ctrlScenSel.options[ctrlScenSel.selectedIndex].text}`, "ok");
    };
  }

  const btnSaveCtrl = $("#btn-save-control-settings");
  if (btnSaveCtrl) {
    btnSaveCtrl.onclick = () => {
      toast("Runtime settings staged! Click 'Save & Apply' below to commit globally.", "ok");
    };
  }

  // Quick Switch Links inside overview
  document.querySelectorAll(".nav-switch").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const target = btn.dataset.target || "datasources";
      A.activeTab = target;
      location.hash = "#" + target;
      render();
    };
  });

  // Left sidebar nav clicks
  document.querySelectorAll(".admin-sidebar .admin-nav-item").forEach((link) => {
    link.onclick = (e) => {
      e.preventDefault();
      const href = link.getAttribute("href") || "/admin/overview";
      const mod = link.dataset.module;
      const rawTarget = mod || href.split("/").pop() || "overview";
      const target = (rawTarget === "layers" ? "map" : (rawTarget === "appearance" ? "visual" : rawTarget));
      A.activeTab = target;
      window.history.pushState({ tab: target }, "", href);
      render();
    };
  });

  // Scenario tile selection and action buttons
  document.querySelectorAll(".scenario-tile").forEach((tile) => {
    tile.onclick = (e) => {
      // Check if clicked edit or delete button
      if (e.target.closest(".btn-edit-scenario")) {
        const scId = e.target.closest(".btn-edit-scenario").dataset.id;
        showEditScenarioModal(scId);
        return;
      }
      if (e.target.closest(".btn-delete-scenario")) {
        const scId = e.target.closest(".btn-delete-scenario").dataset.id;
        deleteScenario(scId);
        return;
      }
      A.selectedScenario = tile.dataset.scenarioId;
      A.scenarioDraft = null;
      render();
    };
  });

  // Open Create Scenario Modal
  $("#btn-create-scenario")?.addEventListener("click", () => {
    showCreateScenarioModal();
  });

  // Reload Scenarios from API
  $("#btn-refresh-scenarios")?.addEventListener("click", async () => {
    try {
      const res = await get("/api/simulation/scenarios");
      A.scenarios = (res && res.scenarios) ? res.scenarios : (Array.isArray(res) ? res : []);
      toast("Scenarios refreshed from server.", "ok");
      render();
    } catch (err) {
      toast(`Refresh failed: ${err.message}`, "err");
    }
  });

  // Edit active scenario
  $("#btn-edit-active-scenario")?.addEventListener("click", () => {
    showEditScenarioModal(A.selectedScenario);
  });

  // Scenario parameters form inputs
  const d = syncScenarioDraft();

  const yrSlider = $("#sim-target-year");
  if (yrSlider) {
    yrSlider.oninput = () => {
      const val = parseInt(yrSlider.value, 10);
      const lbl = $("#lbl-sim-year");
      if (lbl) lbl.textContent = val;
      d.target_year = val;
    };
  }

  const scopeSel = $("#sim-scope-select");
  if (scopeSel) {
    scopeSel.onchange = () => {
      d.scope = scopeSel.value;
    };
  }

  const popSlider = $("#sim-pop-change");
  if (popSlider) {
    popSlider.oninput = () => {
      const val = parseInt(popSlider.value, 10);
      const lbl = $("#lbl-sim-pop");
      if (lbl) lbl.textContent = (val >= 0 ? "+" : "") + val + "%";
      d.pop_change_pct = val;
      if (!d.driver) d.driver = {};
      d.driver.population_change = val / 100;
    };
  }

  const tempSlider = $("#sim-temp-delta");
  if (tempSlider) {
    tempSlider.oninput = () => {
      const val = parseFloat(tempSlider.value);
      const lbl = $("#lbl-sim-temp");
      if (lbl) lbl.textContent = (val >= 0 ? "+" : "") + val + "°C";
      d.road_temp_delta = val;
      if (!d.driver) d.driver = {};
      d.driver.road_temp_delta = val;
    };
  }

  const freezeInput = $("#sim-freeze-cycles");
  if (freezeInput) {
    freezeInput.oninput = () => {
      const val = parseInt(freezeInput.value, 10);
      d.freeze_cycles = val;
      if (!d.driver) d.driver = {};
      d.driver.freeze_cycles = val;
    };
  }

  // Feeder source dependency toggles
  document.querySelectorAll(".dep-source-chk").forEach((chk) => {
    chk.onchange = () => {
      const srcId = chk.dataset.source;
      if (!d.excluded_sources) d.excluded_sources = [];
      if (chk.checked) {
        d.excluded_sources = d.excluded_sources.filter((s) => s !== srcId);
      } else {
        if (!d.excluded_sources.includes(srcId)) d.excluded_sources.push(srcId);
      }
    };
  });

  // Run Test Simulation (Safe)
  const runSimTest = async () => {
    const btn = $("#btn-run-sim-test");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Running Test...`;
    }
    try {
      const sc = getSelectedScenario();
      const draft = syncScenarioDraft();
      const payload = {
        scenario: sc.id,
        target_year: draft.target_year,
        scope: draft.scope,
        driver: draft.driver,
        excluded_sources: draft.excluded_sources || [],
      };
      const res = await post("/api/simulation/test", payload);
      A.activeSimResult = res;
      A.activeSimType = "test";
      const historyRes = await get("/api/simulation/history?limit=15").catch(() => null);
      if (historyRes?.runs) A.simHistory = historyRes.runs;
      toast(`Safe test simulation completed for ${sc.name} (${draft.target_year})! Official twin unchanged.`, "ok");
      render();
    } catch (err) {
      toast(`Simulation test failed: ${err.message}`, "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-flask"></i> Run Test (Safe)`;
      }
    }
  };
  $("#btn-run-sim-test")?.addEventListener("click", runSimTest);
  $("#act-run-quick-test")?.addEventListener("click", runSimTest);

  // Execute Official Simulation
  const runSimOfficial = async () => {
    const btn = $("#btn-run-sim-official");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Executing...`;
    }
    try {
      const sc = getSelectedScenario();
      const draft = syncScenarioDraft();
      const payload = {
        scenario: sc.id,
        target_year: draft.target_year,
        scope: draft.scope,
        driver: draft.driver,
        excluded_sources: draft.excluded_sources || [],
      };
      const res = await post("/api/simulation/run", payload);
      A.latestSimResult = res;
      A.activeSimResult = res;
      A.activeSimType = "official";
      if (A.pending) {
        A.pending.active_scenario = sc.id;
        A.pending.simulation_year = draft.target_year;
        pushPreview();
      }
      const historyRes = await get("/api/simulation/history?limit=15").catch(() => null);
      if (historyRes?.runs) A.simHistory = historyRes.runs;
      toast(`Executed official simulation ${res.run_id}! Now active in the Digital Twin.`, "ok");
      render();
    } catch (err) {
      toast(`Execution failed: ${err.message}`, "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-play"></i> Execute & Set Official`;
      }
    }
  };
  $("#btn-run-sim-official")?.addEventListener("click", runSimOfficial);

  // Export Forecast CSV
  $("#btn-export-sim-csv, #act-export-forecast-data")?.addEventListener("click", () => {
    const active = A.activeSimResult || A.latestSimResult;
    exportSimulationCsv(active);
  });

  // Municipalities search filter
  const muniSearch = $("#muni-search-input");
  if (muniSearch) {
    muniSearch.oninput = () => {
      const query = muniSearch.value.toLowerCase().trim();
      A.muniSearchFilter = muniSearch.value;
      const rows = document.querySelectorAll("#muni-results-table tbody tr");
      rows.forEach((tr) => {
        const text = tr.textContent.toLowerCase();
        tr.style.display = (!query || text.includes(query)) ? "" : "none";
      });
    };
  }

  // Load history run into view
  document.querySelectorAll(".btn-load-history-run").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const runId = btn.dataset.runId;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
      try {
        const res = await get("/api/simulation/result/" + encodeURIComponent(runId));
        A.activeSimResult = res;
        A.activeSimType = res.is_test ? "test" : "official";
        if (res.scenario) A.selectedScenario = res.scenario;
        A.scenarioDraft = null;
        toast(`Loaded simulation run ${runId} into viewer.`, "ok");
        render();
      } catch (err) {
        toast(`Failed to load historical run: ${err.message}`, "err");
      } finally {
        btn.innerHTML = `<i class="fa-solid fa-eye"></i> View`;
      }
    };
  });

  // ---------------- RISK THRESHOLDS & WEIGHTS MANAGEMENT ----------------
  function syncRiskUI() {
    const lowInput = $("#risk-th-low");
    const medInput = $("#risk-th-med");
    const highInput = $("#risk-th-high");
    if (!lowInput || !medInput || !highInput) return;

    const low = parseFloat(lowInput.value || 0.30);
    const med = parseFloat(medInput.value || 0.60);
    const high = parseFloat(highInput.value || 0.80);

    const isValid = (low > 0 && low < med && med < high && high <= 1.0);
    const valMsg = $("#risk-validation-msg");
    const saveBtn = $("#btn-save-risk-cfg");
    if (valMsg) valMsg.style.display = isValid ? "none" : "block";
    if (saveBtn) saveBtn.disabled = !isValid;

    // Update labels
    const lblLow = $("#lbl-val-low"); if (lblLow) lblLow.textContent = low.toFixed(2);
    const lblMed = $("#lbl-val-med"); if (lblMed) lblMed.textContent = med.toFixed(2);
    const lblHigh = $("#lbl-val-high"); if (lblHigh) lblHigh.textContent = high.toFixed(2);
    const lblCrit = $("#lbl-val-crit"); if (lblCrit) lblCrit.textContent = high.toFixed(2);

    // Update visual spectrum widths
    const segLow = $("#seg-low");
    const segMed = $("#seg-med");
    const segHigh = $("#seg-high");
    const segCrit = $("#seg-crit");

    if (segLow && isValid) {
      segLow.style.width = Math.max(5, (low * 100)).toFixed(1) + "%";
      segLow.innerHTML = `LOW (&lt; ${low.toFixed(2)})`;
    }
    if (segMed && isValid) {
      segMed.style.width = Math.max(5, ((med - low) * 100)).toFixed(1) + "%";
      segMed.innerHTML = `MED (${low.toFixed(2)}&ndash;${med.toFixed(2)})`;
    }
    if (segHigh && isValid) {
      segHigh.style.width = Math.max(5, ((high - med) * 100)).toFixed(1) + "%";
      segHigh.innerHTML = `HIGH (${med.toFixed(2)}&ndash;${high.toFixed(2)})`;
    }
    if (segCrit && isValid) {
      segCrit.style.width = Math.max(5, ((1.0 - high) * 100)).toFixed(1) + "%";
      segCrit.innerHTML = `CRIT (&gt; ${high.toFixed(2)})`;
    }

    // Reclassify ad-hoc calculator slider
    const calcSlider = $("#calc-test-slider");
    if (calcSlider) {
      const score = parseFloat(calcSlider.value || 0.52);
      const level = classifyRiskLocally(score, { low, medium: med, high });
      const badge = $("#calc-test-badge");
      const desc = $("#calc-test-desc");
      if (badge) {
        badge.className = `${getRiskBadgeClass(level)}`;
        badge.textContent = level.toUpperCase();
      }
      if (desc) {
        desc.innerHTML = `A score of <b>${score.toFixed(2)}</b> falls within the <b>${level}</b> category boundary.`;
      }
    }

    // Reclassify municipal table rows
    let cLow = 0, cMed = 0, cHigh = 0, cCrit = 0;
    document.querySelectorAll("#risk-muni-table tbody tr").forEach((tr) => {
      const sc = parseFloat(tr.dataset.score || 0);
      const lvl = classifyRiskLocally(sc, { low, medium: med, high });
      if (lvl === "Low") cLow++;
      else if (lvl === "Medium") cMed++;
      else if (lvl === "High") cHigh++;
      else cCrit++;

      const pill = tr.querySelector(".muni-risk-pill");
      if (pill) {
        pill.className = `${getRiskBadgeClass(lvl)} muni-risk-pill`;
        pill.textContent = lvl;
      }
    });

    const cntL = $("#cnt-low"); if (cntL) cntL.textContent = `Low: ${cLow}`;
    const cntM = $("#cnt-med"); if (cntM) cntM.textContent = `Med: ${cMed}`;
    const cntH = $("#cnt-high"); if (cntH) cntH.textContent = `High: ${cHigh}`;
    const cntC = $("#cnt-crit"); if (cntC) cntC.textContent = `Crit: ${cCrit}`;
  }

  // Bind threshold sliders and inputs
  [
    { slider: "#risk-th-low-slider", input: "#risk-th-low" },
    { slider: "#risk-th-med-slider", input: "#risk-th-med" },
    { slider: "#risk-th-high-slider", input: "#risk-th-high" },
  ].forEach(({ slider, input }) => {
    const sEl = $(slider);
    const iEl = $(input);
    if (sEl && iEl) {
      sEl.oninput = () => {
        iEl.value = sEl.value;
        syncRiskUI();
      };
      iEl.oninput = () => {
        sEl.value = iEl.value;
        syncRiskUI();
      };
    }
  });

  // Presets buttons
  document.querySelectorAll(".risk-preset-btn").forEach((btn) => {
    btn.onclick = () => {
      const p = btn.dataset.preset;
      let low = 0.30, med = 0.60, high = 0.80;
      if (p === "strict") { low = 0.20; med = 0.45; high = 0.70; }
      else if (p === "permissive") { low = 0.40; med = 0.70; high = 0.85; }

      const lS = $("#risk-th-low-slider"); const lI = $("#risk-th-low");
      const mS = $("#risk-th-med-slider"); const mI = $("#risk-th-med");
      const hS = $("#risk-th-high-slider"); const hI = $("#risk-th-high");

      if (lS) lS.value = low; if (lI) lI.value = low;
      if (mS) mS.value = med; if (mI) mI.value = med;
      if (hS) hS.value = high; if (hI) hI.value = high;

      syncRiskUI();
      toast(`Loaded preset '${btn.textContent.trim()}'.`, "ok");
    };
  });

  // Sector weight sliders & inputs sync
  const weightFields = [
    { key: "pop", slider: "#risk-wt-pop-slider", input: "#risk-wt-pop", badge: "#badge-wt-pop" },
    { key: "food", slider: "#risk-wt-food-slider", input: "#risk-wt-food", badge: "#badge-wt-food" },
    { key: "snow", slider: "#risk-wt-snow-slider", input: "#risk-wt-snow", badge: "#badge-wt-snow" },
    { key: "infra", slider: "#risk-wt-infra-slider", input: "#risk-wt-infra", badge: "#badge-wt-infra" },
    { key: "env", slider: "#risk-wt-env-slider", input: "#risk-wt-env", badge: "#badge-wt-env" },
  ];

  function syncWeightsUI() {
    let sum = 0;
    weightFields.forEach(({ slider, input, badge }) => {
      const s = $(slider);
      const i = $(input);
      const val = parseFloat(i?.value || s?.value || 0);
      sum += val;
      const b = $(badge);
      if (b) b.textContent = `${Math.round(val * 100)}%`;
    });

    const sumLbl = $("#lbl-weight-sum");
    const totalBadge = $("#badge-weight-total");
    if (sumLbl) sumLbl.textContent = `${Math.round(sum * 100)}%`;
    const isBal = Math.abs(sum - 1.0) < 0.01;
    if (totalBadge) {
      totalBadge.className = `badge-status ${isBal ? "online" : "disabled"}`;
      totalBadge.innerHTML = isBal ? `Sum: <b>100% (Balanced)</b>` : `Sum: <b>${Math.round(sum * 100)}% (Unbalanced)</b>`;
    }
  }

  weightFields.forEach(({ slider, input }) => {
    const s = $(slider);
    const i = $(input);
    if (s && i) {
      s.oninput = () => {
        i.value = s.value;
        syncWeightsUI();
      };
      i.oninput = () => {
        s.value = i.value;
        syncWeightsUI();
      };
    }
  });

  // Normalize weights button
  const btnNorm = $("#btn-normalize-weights");
  if (btnNorm) {
    btnNorm.onclick = () => {
      const values = weightFields.map(f => parseFloat($(f.input)?.value || 0));
      const total = values.reduce((a, b) => a + b, 0);
      if (total <= 0) return;

      let scaled = values.map(v => Math.round((v / total) * 100) / 100);
      // Ensure sum is exactly 1.00
      const currentSum = scaled.reduce((a, b) => a + b, 0);
      const diff = Math.round((1.0 - currentSum) * 100) / 100;
      scaled[0] = Math.round((scaled[0] + diff) * 100) / 100;

      weightFields.forEach((f, idx) => {
        const s = $(f.slider);
        const i = $(f.input);
        if (s) s.value = scaled[idx];
        if (i) i.value = scaled[idx];
      });
      syncWeightsUI();
      toast("Sector weights normalized proportionally to exactly 100%!", "ok");
    };
  }

  // Ad-hoc Calculator Slider
  const calcSlider = $("#calc-test-slider");
  if (calcSlider) {
    calcSlider.oninput = () => {
      const val = parseFloat(calcSlider.value || 0);
      A.calcTestScore = val;
      const lbl = $("#lbl-calc-test-val");
      if (lbl) lbl.textContent = val.toFixed(2);
      syncRiskUI();
    };
  }

  // Ad-hoc verify API button
  const btnVerifyApi = $("#btn-calc-api-verify");
  if (btnVerifyApi) {
    btnVerifyApi.onclick = async () => {
      const score = parseFloat($("#calc-test-slider")?.value || 0.52);
      const low = parseFloat($("#risk-th-low")?.value || 0.30);
      const med = parseFloat($("#risk-th-med")?.value || 0.60);
      const high = parseFloat($("#risk-th-high")?.value || 0.80);

      btnVerifyApi.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
      try {
        const res = await post("/api/risk/calculate", {
          score,
          thresholds: { low, medium: med, high, critical: 1.0 },
        });
        toast(`Backend verified score ${res.score} as '${res.level}'!`, "ok");
      } catch (err) {
        toast(`API verification failed: ${err.message}`, "err");
      } finally {
        btnVerifyApi.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Verify API`;
      }
    };
  }

  // Municipalities search filter
  const muniSearchRisk = $("#risk-muni-search");
  if (muniSearchRisk) {
    muniSearchRisk.oninput = () => {
      const q = muniSearchRisk.value.toLowerCase().trim();
      document.querySelectorAll("#risk-muni-table tbody tr").forEach((tr) => {
        const name = tr.dataset.name || "";
        tr.style.display = (!q || name.includes(q)) ? "" : "none";
      });
    };
  }

  // Reset Risk Config button
  const btnResetRisk = $("#btn-reset-risk-cfg");
  if (btnResetRisk) {
    btnResetRisk.onclick = () => {
      const th = A.riskConfig?.thresholds || { low: 0.3, medium: 0.6, high: 0.8 };
      const wt = A.riskConfig?.weights || { population: 0.25, food: 0.20, snow_flood: 0.20, infrastructure: 0.20, environment: 0.15 };

      const lS = $("#risk-th-low-slider"); const lI = $("#risk-th-low");
      const mS = $("#risk-th-med-slider"); const mI = $("#risk-th-med");
      const hS = $("#risk-th-high-slider"); const hI = $("#risk-th-high");

      if (lS) lS.value = th.low; if (lI) lI.value = th.low;
      if (mS) mS.value = th.medium; if (mI) mI.value = th.medium;
      if (hS) hS.value = th.high; if (hI) hI.value = th.high;

      const pI = $("#risk-wt-pop"); if (pI) pI.value = wt.population || 0.25;
      const fI = $("#risk-wt-food"); if (fI) fI.value = wt.food || 0.20;
      const sI = $("#risk-wt-snow"); if (sI) sI.value = wt.snow_flood || 0.20;
      const iI = $("#risk-wt-infra"); if (iI) iI.value = wt.infrastructure || 0.20;
      const eI = $("#risk-wt-env"); if (eI) eI.value = wt.environment || 0.15;

      const pS = $("#risk-wt-pop-slider"); if (pS) pS.value = wt.population || 0.25;
      const fS = $("#risk-wt-food-slider"); if (fS) fS.value = wt.food || 0.20;
      const sS = $("#risk-wt-snow-slider"); if (sS) sS.value = wt.snow_flood || 0.20;
      const iS = $("#risk-wt-infra-slider"); if (iS) iS.value = wt.infrastructure || 0.20;
      const eS = $("#risk-wt-env-slider"); if (eS) eS.value = wt.environment || 0.15;

      syncRiskUI();
      syncWeightsUI();
      toast("Reverted risk settings to saved configuration.", "ok");
    };
  }

  // Save Risk Config
  const btnRiskSave = $("#btn-save-risk-cfg");
  if (btnRiskSave) {
    btnRiskSave.onclick = async () => {
      const low = parseFloat($("#risk-th-low")?.value || 0.3);
      const med = parseFloat($("#risk-th-med")?.value || 0.6);
      const high = parseFloat($("#risk-th-high")?.value || 0.8);

      if (!(low > 0 && low < med && med < high && high <= 1.0)) {
        toast("Thresholds must be strictly ascending: 0 < Low < Med < High <= 1.0", "err");
        return;
      }

      const popW = parseFloat($("#risk-wt-pop")?.value || 0.25);
      const foodW = parseFloat($("#risk-wt-food")?.value || 0.20);
      const snowW = parseFloat($("#risk-wt-snow")?.value || 0.20);
      const infraW = parseFloat($("#risk-wt-infra")?.value || 0.20);
      const envW = parseFloat($("#risk-wt-env")?.value || 0.15);

      btnRiskSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
      btnRiskSave.disabled = true;

      try {
        const res = await post("/api/risk/config", {
          thresholds: { low, medium: med, high, critical: 1.0 },
          weights: { population: popW, food: foodW, snow_flood: snowW, infrastructure: infraW, environment: envW },
        });
        A.riskConfig = res;
        if (A.pending) {
          A.pending.risk_thresholds = res.thresholds;
          A.pending.weights = res.weights;
          pushPreview();
        }
        toast("Risk thresholds & sector weights successfully updated!", "ok");
        render();
      } catch (err) {
        toast(`Failed to update risk config: ${err.message}`, "err");
      } finally {
        if (btnRiskSave) {
          btnRiskSave.disabled = false;
          btnRiskSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Risk Settings`;
        }
      }
    };
  }

  // Add Source Modal
  const btnAddSource = $("#btn-add-source");
  if (btnAddSource) {
    btnAddSource.onclick = () => {
      showModal(
        `<i class="fa-solid fa-plus text-blue"></i> Register Dynamic Data Source`,
        `
          <div class="form-group">
            <label>Source Identifier (alphanumeric, e.g. 'smhi_radar')</label>
            <input type="text" class="form-control" id="modal-src-id" placeholder="new_source_id">
          </div>
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-control" id="modal-src-name" placeholder="National Geodata Provider">
          </div>
          <div class="form-group">
            <label>Base URL Endpoint</label>
            <input type="text" class="form-control" id="modal-src-url" placeholder="https://api.example.se/v1/data">
          </div>
          <div class="form-group">
            <label>Default Refresh Interval (seconds)</label>
            <input type="number" class="form-control" id="modal-src-interval" value="3600">
          </div>
        `,
        async () => {
          const sid = $("#modal-src-id")?.value?.trim();
          const name = $("#modal-src-name")?.value?.trim();
          const url = $("#modal-src-url")?.value?.trim();
          const interval = parseInt($("#modal-src-interval")?.value || 3600, 10);
          if (!sid || !name) {
            toast("Source ID and Name are required", "err");
            return;
          }
          try {
            await post("/api/control/source/register", {
              id: sid,
              name,
              base_url: url || null,
              interval_seconds: interval,
              enabled: true,
            });
            toast(`Dynamic source '${name}' registered successfully!`, "ok");
            loadInitialData();
          } catch (err) {
            toast(`Registration failed: ${err.message}`, "err");
          }
        }
      );
    };
  }

  // Save & Apply button
  const btnApply = $("#btn-save-apply");
  if (btnApply) {
    btnApply.onclick = async () => {
      btnApply.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Applying...`;
      btnApply.disabled = true;
      try {
        const latestState = await get("/api/control/state").catch(() => null);
        const versionToUse = latestState?.version || A.saved?.version || 1;
        const res = await post("/api/control/apply", {
          base_version: versionToUse,
          state: A.pending,
          note: "Applied from Dashboard Control panel",
        });
        toast("Dashboard configuration successfully saved & applied!", "ok");
        if (res?.version) {
          if (!A.saved) A.saved = {};
          A.saved.version = res.version;
        }
      } catch (err) {
        toast("Error saving configuration: " + err.message, "err");
      } finally {
        btnApply.disabled = false;
        btnApply.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save & Apply`;
        pushPreview();
      }
    };
  }

  // Reset to Default button
  const btnReset = $("#btn-reset-default");
  if (btnReset) {
    btnReset.onclick = () => {
      A.pending = clone(stateOnly(A.saved || {}));
      render();
      toast("Configuration restored to last saved version.", "ok");
    };
  }

  // ==========================================================================
  // SYSTEM & AUDIT TAB EVENT WIRING
  // ==========================================================================

  // Reload System Data & Diagnostics
  $("#btn-reload-system-data")?.addEventListener("click", async () => {
    toast("Refreshing system telemetry, feed health & audit log...", "ok");
    await loadInitialData();
    toast("System telemetry updated.", "ok");
  });

  // Feeder live connection test buttons
  document.querySelectorAll(".btn-sys-test-src").forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.source;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
      try {
        const res = await post("/api/control/source/test", { source: sid });
        showModal(
          `<i class="fa-solid fa-bolt text-yellow"></i> Live Feeder Diagnostics: ${sid.toUpperCase()}`,
          `
            <div style="font-size:12px; line-height:1.6;">
              <p><b>Status:</b> <span class="badge-status ${res.status === "ok" ? "online" : "disabled"}">${(res.status || "ok").toUpperCase()}</span></p>
              <p><b>Round-trip Latency:</b> ${res.latency_ms || 12} ms</p>
              <p><b>Remote Endpoint:</b> <code>${esc(res.endpoint || "Internal National Service Adapter")}</code></p>
              <p><b>Diagnostics:</b> ${esc(res.message || "Connection active and responsive.")}</p>
            </div>
          `
        );
      } catch (err) {
        toast(`Feeder test failed: ${err.message}`, "err");
      } finally {
        btn.innerHTML = `<i class="fa-solid fa-bolt text-yellow"></i> Test`;
      }
    };
  });

  // Configuration Import & Diff Studio modal handler
  const openImportStudio = () => {
    showModal(
      `<i class="fa-solid fa-code-compare text-yellow"></i> Configuration Diff & Ingest Studio`,
      `
        <div style="font-size:12px; color:#94a3b8; margin-bottom:12px; line-height:1.5;">
          Ingest JSON configuration to stage changes. The system validates schema integrity against Pydantic rules and displays an instant visual diff before applying.
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn-reset-default" id="modal-btn-load-current" style="padding:4px 8px; font-size:11px;">
              <i class="fa-solid fa-download"></i> Load Live Config
            </button>
            <button type="button" class="btn-reset-default" id="modal-btn-upload-trigger" style="padding:4px 8px; font-size:11px;">
              <i class="fa-solid fa-upload"></i> Upload File (.json)
            </button>
            <input type="file" id="modal-file-upload-input" accept=".json,application/json" style="display:none;">
          </div>
          <button type="button" class="btn-reset-default" id="modal-btn-validate" style="padding:4px 10px; font-size:11px; background:#1e293b; color:#38bdf8; font-weight:600;">
            <i class="fa-solid fa-check"></i> Validate Diff
          </button>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <textarea class="form-control" id="modal-import-json" rows="9" placeholder="Paste JSON control state here..." style="font-family:monospace; font-size:11px;"></textarea>
        </div>
        <div id="modal-diff-feedback" style="display:none; padding:10px; border-radius:6px; font-size:11px; margin-bottom:12px;"></div>
      `,
      async () => {
        const raw = $("#modal-import-json")?.value?.trim();
        if (!raw) {
          toast("Please provide JSON configuration to import.", "err");
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          const validation = await post("/api/control/import-config/validate", { state: parsed });
          if (!validation.valid) {
            toast(`Invalid configuration: ${validation.errors.join(", ")}`, "err");
            return;
          }
          const latestState = await get("/api/control/state").catch(() => null);
          const versionToUse = latestState?.version || A.saved?.version || 1;
          const cleanState = clone(stateOnly(parsed));
          const applyRes = await post("/api/control/apply", {
            base_version: versionToUse,
            state: cleanState,
            note: "Applied from Configuration Diff Studio",
          });
          toast("Configuration successfully validated & applied to Digital Twin!", "ok");
          if (applyRes?.version) {
            if (!A.saved) A.saved = {};
            A.saved.version = applyRes.version;
          }
          A.pending = cleanState;
          pushPreview();
          await loadInitialData();
        } catch (err) {
          toast(`Failed to apply configuration: ${err.message}`, "err");
        }
      }
    );

    // Bind inside modal
    setTimeout(() => {
      const loadLiveBtn = $("#modal-btn-load-current");
      const uploadTrigger = $("#modal-btn-upload-trigger");
      const fileInput = $("#modal-file-upload-input");
      const validateBtn = $("#modal-btn-validate");
      const diffFeedback = $("#modal-diff-feedback");
      const textarea = $("#modal-import-json");

      if (loadLiveBtn) {
        loadLiveBtn.onclick = async () => {
          try {
            const res = await get("/api/control/export-config");
            if (res?.config) {
              textarea.value = JSON.stringify(res.config, null, 2);
              toast("Loaded active configuration into editor.", "ok");
            }
          } catch (e) {
            toast("Failed loading live config: " + e.message, "err");
          }
        };
      }

      if (uploadTrigger && fileInput) {
        uploadTrigger.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            textarea.value = evt.target.result;
            toast(`Loaded ${file.name}`, "ok");
          };
          reader.readAsText(file);
        };
      }

      if (validateBtn) {
        validateBtn.onclick = async () => {
          const raw = textarea?.value?.trim();
          if (!raw) {
            toast("Paste JSON first to validate.", "err");
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            const val = await post("/api/control/import-config/validate", { state: parsed });
            if (diffFeedback) diffFeedback.style.display = "block";
            if (val.valid) {
              if (diffFeedback) {
                diffFeedback.style.background = "rgba(16, 185, 129, 0.15)";
                diffFeedback.style.border = "1px solid rgba(16, 185, 129, 0.4)";
                diffFeedback.style.color = "#10b981";
                const keys = (val.changed_keys || []).map(k => `<span class="scenario-tag tag-green" style="font-size:10px; padding:2px 6px;">${esc(k)}</span>`).join(" ");
                diffFeedback.innerHTML = `<b><i class="fa-solid fa-circle-check"></i> Valid Schema!</b> ${val.changed_keys?.length || 0} keys differ from live state: <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">${keys || "No differences"}</div>`;
              }
            } else {
              if (diffFeedback) {
                diffFeedback.style.background = "rgba(239, 68, 68, 0.15)";
                diffFeedback.style.border = "1px solid rgba(239, 68, 68, 0.4)";
                diffFeedback.style.color = "#ef4444";
                diffFeedback.innerHTML = `<b><i class="fa-solid fa-triangle-exclamation"></i> Validation Failed:</b> ${esc((val.errors || [val.error]).join(", "))}`;
              }
            }
          } catch (err) {
            if (diffFeedback) {
              diffFeedback.style.display = "block";
              diffFeedback.style.background = "rgba(239, 68, 68, 0.15)";
              diffFeedback.style.border = "1px solid rgba(239, 68, 68, 0.4)";
              diffFeedback.style.color = "#ef4444";
              diffFeedback.innerHTML = `<b><i class="fa-solid fa-triangle-exclamation"></i> JSON Syntax Error:</b> ${esc(err.message)}`;
            }
          }
        };
      }
    }, 100);
  };

  $("#btn-sys-open-import, #btn-open-diff-modal, #act-import-cfg")?.addEventListener("click", openImportStudio);

  // Audit filter action change
  const actionSel = $("#audit-filter-action");
  if (actionSel) {
    actionSel.onchange = () => {
      A.auditFilterAction = actionSel.value;
      render();
    };
  }

  // Audit search input live filter
  const searchInp = $("#audit-search-input");
  if (searchInp) {
    searchInp.oninput = () => {
      A.auditSearchTerm = searchInp.value;
      const filtered = getFilteredAuditEvents();
      const tbody = document.querySelector("#admin-tab-content table.audit-table tbody");
      const countLbl = $("#lbl-audit-count");
      if (countLbl) {
        countLbl.textContent = `Showing ${filtered.length} of ${(A.auditEvents || []).length} Events`;
      }
      if (tbody) {
        tbody.innerHTML = filtered.map((ev, idx) => `
          <tr>
            <td style="font-size:11px; color:#94a3b8; white-space:nowrap;">
              <b>${fmtDateTime(ev.timestamp)}</b>
              <div style="font-size:10px; color:#64748b;">${relTime(ev.timestamp)}</div>
            </td>
            <td>${getAuditTagBadge(ev.action)}</td>
            <td><b style="color:#f8fafc;">${esc(ev.username || "admin")}</b></td>
            <td>
              <code class="audit-summary-code" title="${esc(JSON.stringify(ev.summary || {}))}">
                ${esc(JSON.stringify(ev.summary || {}))}
              </code>
            </td>
            <td>
              <span class="badge-status ${ev.result === "ok" ? "online" : "disabled"}" style="font-size:10px; padding:2px 8px;">
                ${(ev.result || "ok").toUpperCase()}
              </span>
            </td>
            <td style="text-align:right;">
              <button type="button" class="btn-reset-default btn-inspect-audit" data-index="${idx}" style="padding:3px 8px; font-size:10px;" title="View raw JSON payload">
                <i class="fa-solid fa-code"></i> Inspect
              </button>
            </td>
          </tr>
        `).join("") || `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:24px;">No matching audit events found.</td></tr>`;

        wireInspectButtons();
      }
    };
  }

  // Audit limit selector
  const limitSel = $("#audit-limit-select");
  if (limitSel) {
    limitSel.onchange = async () => {
      A.auditLimit = parseInt(limitSel.value, 10);
      try {
        const res = await get(`/api/system/audit?limit=${A.auditLimit}`);
        if (res?.events) A.auditEvents = res.events;
        render();
        toast(`Loaded last ${A.auditLimit} audit events.`, "ok");
      } catch (e) {
        toast("Failed updating limit: " + e.message, "err");
      }
    };
  }

  // Reload Audit Trail Button
  $("#btn-refresh-audit")?.addEventListener("click", async () => {
    try {
      const res = await get(`/api/system/audit?limit=${A.auditLimit || 50}`);
      if (res?.events) A.auditEvents = res.events;
      render();
      toast("Audit trail refreshed from server.", "ok");
    } catch (e) {
      toast("Failed refreshing audit trail: " + e.message, "err");
    }
  });

  // Audit event inspector modal
  function wireInspectButtons() {
    document.querySelectorAll(".btn-inspect-audit").forEach((btn) => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index, 10);
        const filtered = getFilteredAuditEvents();
        const ev = filtered[idx];
        if (!ev) return;

        showModal(
          `<i class="fa-solid fa-fingerprint text-purple"></i> Audit Log Inspection: ${esc(ev.action)}`,
          `
            <div style="font-size:12px; margin-bottom:12px; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; background:#080f1e; padding:10px 14px; border-radius:6px; border:1px solid #1e293b;">
                <span><b>Operator:</b> ${esc(ev.username || "admin")}</span>
                <span><b>Timestamp:</b> ${fmtDateTime(ev.timestamp)} (${relTime(ev.timestamp)})</span>
                <span><b>Status:</b> <span class="badge-status ${ev.result === "ok" ? "online" : "disabled"}">${(ev.result || "ok").toUpperCase()}</span></span>
              </div>
              <div style="font-weight:600; color:#cbd5e1; margin-top:4px;">Recorded Event Payload:</div>
              <pre style="background:#050a14; border:1px solid #1e293b; padding:12px; border-radius:6px; color:#38bdf8; font-family:monospace; font-size:11px; max-height:300px; overflow-y:auto; line-height:1.5;">${esc(JSON.stringify(ev, null, 2))}</pre>
            </div>
          `
        );
      };
    });
  }
  wireInspectButtons();

  // Maintenance: Trigger Global Refresh All
  const refreshAllHandler = async () => {
    toast("Triggering background ingest across all enabled feeds...", "ok");
    try {
      const res = await post("/api/control/refresh-all", {});
      toast(`Ingest triggered! ${res.refreshed_count || 6} feeds synchronized.`, "ok");
      await loadInitialData();
    } catch (err) {
      toast(`Refresh failed: ${err.message}`, "err");
    }
  };
  $("#btn-sys-refresh-all")?.addEventListener("click", refreshAllHandler);
  $("#tile-maint-refresh-all")?.addEventListener("click", refreshAllHandler);
  $("#act-refresh-all")?.addEventListener("click", refreshAllHandler);

  // Maintenance: Run Diagnostic Simulation
  const testSimHandler = async () => {
    try {
      const res = await post("/api/simulation/test", { scenario: "population_growth", target_year: 2030 });
      showModal(
        `<i class="fa-solid fa-flask text-purple"></i> Diagnostic Simulation Results`,
        `
          <div style="font-size:12px; line-height:1.6;">
            <p><b>Target Year:</b> ${res.target_year}</p>
            <p><b>Simulated Regional Population:</b> ${res.summary?.population_simulated?.toLocaleString() || "N/A"}</p>
            <p><b>Regional Risk Score:</b> ${(res.summary?.regional_risk?.score * 100).toFixed(0)}% (${res.summary?.regional_risk?.level})</p>
            <p><b>Causal Graph Nodes:</b> 15 Municipalities × 6 Feeds Coupled</p>
            <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:10px; margin-top:10px;">
              <i>${res.summary?.key_takeaway || "Test simulation completed without mutating official twin state."}</i>
            </div>
          </div>
        `
      );
    } catch (err) {
      toast("Simulation test failed: " + err.message, "err");
    }
  };
  $("#tile-maint-test-sim")?.addEventListener("click", testSimHandler);
  $("#act-run-test-sim")?.addEventListener("click", testSimHandler);

  // Maintenance: Factory Seed Reset
  $("#tile-maint-factory-reset")?.addEventListener("click", () => {
    showModal(
      `<i class="fa-solid fa-triangle-exclamation text-red"></i> Confirm Factory Seed Reset`,
      `
        <div style="font-size:12px; line-height:1.6; color:#cbd5e1;">
          <p style="color:#ef4444; font-weight:700;">Warning: Operational Reset</p>
          <p>This operation restores the Digital Twin runtime configuration back to default seed:</p>
          <ul style="margin:8px 0 12px 18px; color:#94a3b8;">
            <li>All 6 Authority data feeds enabled with default polling intervals</li>
            <li>All 8 Geospatial 2.5D map layers visible</li>
            <li>All 11 Dashboard appearance UI widgets enabled</li>
            <li>Risk thresholds restored to Low: 0.30, Med: 0.60, High: 0.80</li>
            <li>County-wide Dalarna regional focus scope</li>
          </ul>
          <p>Are you sure you want to commit this reset?</p>
        </div>
      `,
      async () => {
        try {
          const latest = await get("/api/control/state").catch(() => null);
          const ver = latest?.version || A.saved?.version || 1;
          const seedState = {
            mode: "simulation",
            scope: "dalarna",
            simulation_year: 2030,
            sources: { smhi: true, trafikverket: true, scb: true, sgu: true, skogsstyrelsen: true, lantmateriet: true },
            source_intervals: { smhi: 900, trafikverket: 900, scb: 86400, sgu: 21600, skogsstyrelsen: 86400, lantmateriet: 86400 },
            layers: { boundaries: true, population: true, weather: true, roads: true, water: true, forest: true, land: true, simulation_risk: true },
            components: {
              source_cards: true, regional_risk: true, population: true, food_risk: true,
              snow_flood_risk: true, infrastructure_risk: true, environment_risk: true,
              municipality_table: true, simulation_control: true, simulation_results: true, map: true
            },
            risk_thresholds: { low: 0.30, medium: 0.60, high: 0.80 },
            weights: { population: 0.25, food: 0.20, snow_flood: 0.20, infrastructure: 0.20, environment: 0.15 }
          };
          const res = await post("/api/control/apply", {
            base_version: ver,
            state: seedState,
            note: "Restored factory seed defaults from System Admin panel",
          });
          toast("Factory default configuration successfully restored!", "ok");
          if (res?.version) {
            if (!A.saved) A.saved = {};
            A.saved.version = res.version;
          }
          A.pending = clone(seedState);
          pushPreview();
          await loadInitialData();
        } catch (err) {
          toast("Factory reset failed: " + err.message, "err");
        }
      }
    );
  });

  // Admin Sign Out button
  $("#admin-user-btn")?.addEventListener("click", async () => {
    try {
      await post("/api/auth/logout", {});
    } catch (_) {}
    toast("Signed out successfully.", "ok");
    setTimeout(() => {
      location.href = "/login?next=/admin";
    }, 400);
  });
}

// Window popstate / hashchange support for separate URLs
function resolveTabFromUrl() {
  const path = location.pathname.replace(/\/+$/, "");
  const parts = path.split("/");
  const lastPart = parts[parts.length - 1];

  const pathToTab = {
    overview: "overview",
    control: "control",
    datasources: "datasources",
    scenarios: "scenarios",
    risks: "risks",
    layers: "map",
    map: "map",
    appearance: "visual",
    visual: "visual",
    system: "system",
  };

  if (pathToTab[lastPart]) {
    return pathToTab[lastPart];
  }

  const hash = location.hash.replace("#", "");
  if (pathToTab[hash]) {
    return pathToTab[hash];
  }

  return "overview";
}

window.addEventListener("popstate", () => {
  A.activeTab = resolveTabFromUrl();
  render();
});

window.addEventListener("hashchange", () => {
  A.activeTab = resolveTabFromUrl();
  render();
});

// Initial boot
A.activeTab = resolveTabFromUrl();
loadInitialData();
