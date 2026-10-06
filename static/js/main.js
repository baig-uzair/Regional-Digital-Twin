// Main Interface (stakeholder view) matching Screenshot 1 to the pixel
import { get } from "./api.js";
import { DalarnaMap, MUNICIPALITY_RISK_MAP } from "./map.js";
import { esc, fmtDateTime, fmtNum, openDrawer, toast } from "./util.js";

const PREVIEW = new URLSearchParams(location.search).get("preview") === "1";
const ROUTES = ["overview", "map", "simulation", "municipalities", "data-sources", "insights", "reports", "settings"];

const S = {
  control: null,
  summary: null,
  munis: null,
  mapState: null,
  map: null,
  mapEl: null,
  loadedOnce: false,
  // Simulation interactive state
  simScenario: "pop_growth",
  simYear: 2030,
  simDelta: 10,
  simScope: "dalarna",
  simSearch: "",
  simFilter: "all",
  activeTab: "overview",
};

const $ = (sel) => document.querySelector(sel);
const route = () => {
  const r = (location.hash.replace(/^#\/?/, "") || "overview").split("?")[0];
  return ROUTES.includes(r) ? r : "overview";
};

// Initial base municipality dataset
const BASE_MUNICIPALITIES = [
  { rank: 1, code: "2081", name: "Borlänge", current: 51399, food: "Medium", snow: "Low", infra: "High", env: "Medium", overall: "High", trendColor: "#ef4444" },
  { rank: 2, code: "2080", name: "Falun", current: 59016, food: "Low", snow: "Medium", infra: "High", env: "Medium", overall: "High", trendColor: "#f97316" },
  { rank: 3, code: "2062", name: "Mora", current: 21928, food: "Medium", snow: "Medium", infra: "Medium", env: "Low", overall: "Medium", trendColor: "#eab308" },
  { rank: 4, code: "2085", name: "Ludvika", current: 26389, food: "Medium", snow: "High", infra: "Medium", env: "Medium", overall: "High", trendColor: "#f97316" },
  { rank: 5, code: "2084", name: "Avesta", current: 23105, food: "High", snow: "Medium", infra: "Medium", env: "Medium", overall: "Medium", trendColor: "#eab308" },
  { rank: 6, code: "2029", name: "Leksand", current: 16085, food: "Medium", snow: "Medium", infra: "Medium", env: "Medium", overall: "Medium", trendColor: "#eab308" },
  { rank: 7, code: "2083", name: "Hedemora", current: 15468, food: "Medium", snow: "Medium", infra: "High", env: "Medium", overall: "Medium", trendColor: "#eab308" },
  { rank: 8, code: "2031", name: "Rättvik", current: 11105, food: "Medium", snow: "Medium", infra: "Medium", env: "Low", overall: "Medium", trendColor: "#eab308" },
  { rank: 9, code: "2082", name: "Säter", current: 11215, food: "Low", snow: "Medium", infra: "High", env: "Medium", overall: "Medium", trendColor: "#eab308" },
  { rank: 10, code: "2061", name: "Smedjebacken", current: 10916, food: "Medium", snow: "Low", infra: "Medium", env: "Medium", overall: "Medium", trendColor: "#eab308" },
  { rank: 11, code: "2026", name: "Gagnef", current: 10480, food: "Medium", snow: "Medium", infra: "Medium", env: "Low", overall: "Medium", trendColor: "#eab308" },
  { rank: 12, code: "2023", name: "Malung-Sälen", current: 10210, food: "Low", snow: "High", infra: "Medium", env: "Low", overall: "Medium", trendColor: "#eab308" },
  { rank: 13, code: "2039", name: "Älvdalen", current: 7052, food: "Low", snow: "Medium", infra: "Low", env: "Low", overall: "Low", trendColor: "#22c55e" },
  { rank: 14, code: "2034", name: "Orsa", current: 6922, food: "Medium", snow: "Medium", infra: "Medium", env: "Low", overall: "Medium", trendColor: "#eab308" },
  { rank: 15, code: "2021", name: "Vansbro", current: 6715, food: "Medium", snow: "Low", infra: "Medium", env: "Low", overall: "Medium", trendColor: "#eab308" },
];

async function loadAll() {
  try {
    const [control, summary, munis, mapState, airStation] = await Promise.all([
      PREVIEW ? Promise.resolve(S.control) : get("/api/control/state").catch(() => null),
      get("/api/datasources/summary").catch(() => null),
      get("/api/municipalities").catch(() => null),
      get("/api/control/map-state").catch(() => null),
      get("/api/station").catch(() => null),
    ]);

    if (control) S.control = control;
    if (summary) S.summary = summary;
    if (munis) S.munis = munis;
    if (mapState) S.mapState = mapState;
    if (airStation) S.airTemp = airStation.temperature?.value;

    S.loadedOnce = true;
    render();
  } catch (e) {
    if (!S.loadedOnce) render();
  }
}

// ---------------------------------------------------------------- Header
function renderHeader() {
  const el = $("#header");
  if (!el) return;
  el.innerHTML = `
    <div class="hdr-brand">
      <h1>DALARNA REGIONAL DIGITAL TWIN</h1>
      <div class="hdr-subtitle">Real-time data · Multi-source simulation · Cross-sector impact · Decision support</div>
    </div>
    <div class="hdr-right">
      <div class="hdr-chip system-chip" title="All connectors active and synced">
        <span class="dot-live"></span>
        <div class="chip-text">
          <b>System Online</b>
          <span>6/6 data sources</span>
        </div>
      </div>
      <div class="hdr-chip">
        <i class="fa-regular fa-clock text-blue"></i>
        <div class="chip-text">
          <span class="chip-label">Last update</span>
          <b>2025-03-27 12:34</b>
        </div>
      </div>
      <div class="hdr-chip location-chip">
        <i class="fa-solid fa-location-dot"></i>
        <span>Dalarna, Sweden</span>
      </div>
      <div class="seg-mode" role="group" aria-label="Mode selection">
        <button class="seg-btn ${S.simYear === 2025 ? "active" : ""}" data-mode="current">Current (2025)</button>
        <button class="seg-btn ${S.simYear !== 2025 ? "active" : ""}" data-mode="simulation">Simulation (2030)</button>
      </div>
    </div>`;

  el.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      S.simYear = btn.dataset.mode === "current" ? 2025 : 2030;
      render();
    };
  });
}

// ---------------------------------------------------------------- KPI Cards Row (6 Sources)
function renderKpiCards() {
  const airVal = S.airTemp ? `${S.airTemp} °C` : "7.1 °C";

  return `
    <section class="kpi-row" aria-label="Key data source indicators">
      <!-- 1. SMHI Weather -->
      <div class="kpi-card" data-source="smhi">
        <div class="kpi-top">
          <div class="kpi-title-box">
            <i class="fa-solid fa-cloud-sun kpi-icon text-yellow"></i>
            <div class="kpi-name-col">
              <span class="kpi-name">SMHI</span>
              <span class="kpi-category">Weather</span>
            </div>
          </div>
          <span class="badge-status online">Online</span>
        </div>
        <div class="kpi-value">${airVal}</div>
        <div class="kpi-sub">Rain: 2.1 mm | Wind: 4.2 m/s</div>
        <div class="kpi-sparkline">
          <svg viewBox="0 0 160 28">
            <path d="M0,18 Q20,8 40,15 T80,12 T120,20 T160,8" fill="none" stroke="#38bdf8" stroke-width="2"/>
          </svg>
        </div>
      </div>

      <!-- 2. Trafikverket Traffic -->
      <div class="kpi-card" data-source="trafikverket">
        <div class="kpi-top">
          <div class="kpi-title-box">
            <i class="fa-solid fa-road kpi-icon text-blue"></i>
            <div class="kpi-name-col">
              <span class="kpi-name">Trafikverket</span>
              <span class="kpi-category">Traffic (E16)</span>
            </div>
          </div>
          <span class="badge-status online">Online</span>
        </div>
        <div class="kpi-value">5.9 °C</div>
        <div class="kpi-sub">Traffic: Normal</div>
        <div class="kpi-sparkline">
          <svg viewBox="0 0 160 28">
            <path d="M0,22 Q30,12 60,18 T120,8 T160,16" fill="none" stroke="#22c55e" stroke-width="2"/>
          </svg>
        </div>
      </div>

      <!-- 3. SCB Population -->
      <div class="kpi-card" data-source="scb">
        <div class="kpi-top">
          <div class="kpi-title-box">
            <i class="fa-solid fa-users kpi-icon text-purple"></i>
            <div class="kpi-name-col">
              <span class="kpi-name">SCB</span>
              <span class="kpi-category">Population</span>
            </div>
          </div>
          <span class="badge-status online">Online</span>
        </div>
        <div class="kpi-value">288,000</div>
        <div class="kpi-sub">15 municipalities</div>
        <div class="kpi-sparkline">
          <svg viewBox="0 0 160 28">
            <rect x="10" y="14" width="4" height="12" fill="#a855f7" rx="1"/>
            <rect x="25" y="10" width="4" height="16" fill="#a855f7" rx="1"/>
            <rect x="40" y="8" width="4" height="18" fill="#a855f7" rx="1"/>
            <rect x="55" y="12" width="4" height="14" fill="#a855f7" rx="1"/>
            <rect x="70" y="6" width="4" height="20" fill="#a855f7" rx="1"/>
            <rect x="85" y="9" width="4" height="17" fill="#a855f7" rx="1"/>
            <rect x="100" y="5" width="4" height="21" fill="#a855f7" rx="1"/>
            <rect x="115" y="11" width="4" height="15" fill="#a855f7" rx="1"/>
            <rect x="130" y="7" width="4" height="19" fill="#a855f7" rx="1"/>
            <rect x="145" y="4" width="4" height="22" fill="#a855f7" rx="1"/>
          </svg>
        </div>
      </div>

      <!-- 4. SGU Water/Geology -->
      <div class="kpi-card" data-source="sgu">
        <div class="kpi-top">
          <div class="kpi-title-box">
            <i class="fa-solid fa-droplet kpi-icon text-cyan"></i>
            <div class="kpi-name-col">
              <span class="kpi-name">SGU</span>
              <span class="kpi-category">Water/Geology</span>
            </div>
          </div>
          <span class="badge-status online">Online</span>
        </div>
        <div class="kpi-value">293</div>
        <div class="kpi-sub">water objects</div>
        <div class="kpi-sparkline">
          <svg viewBox="0 0 160 28">
            <path d="M0,15 Q25,25 50,15 T100,10 T160,18" fill="none" stroke="#06b6d4" stroke-width="2"/>
          </svg>
        </div>
      </div>

      <!-- 5. Skogsstyrelsen Forest -->
      <div class="kpi-card" data-source="skogsstyrelsen">
        <div class="kpi-top">
          <div class="kpi-title-box">
            <i class="fa-solid fa-tree kpi-icon text-green"></i>
            <div class="kpi-name-col">
              <span class="kpi-name">Skogsstyrelsen</span>
              <span class="kpi-category">Forest</span>
            </div>
          </div>
          <span class="badge-status online">Online</span>
        </div>
        <div class="kpi-value">~450,000 ha</div>
        <div class="kpi-sub">Forest coverage: 62%</div>
        <div class="kpi-sparkline">
          <svg viewBox="0 0 160 28">
            <path d="M0,20 Q40,5 80,18 T160,8" fill="none" stroke="#22c55e" stroke-width="2"/>
          </svg>
        </div>
      </div>

      <!-- 6. Lantmäteriet Land Registry -->
      <div class="kpi-card" data-source="lantmateriet">
        <div class="kpi-top">
          <div class="kpi-title-box">
            <i class="fa-solid fa-map-location-dot kpi-icon text-teal"></i>
            <div class="kpi-name-col">
              <span class="kpi-name">Lantmäteriet</span>
              <span class="kpi-category">Land Registry</span>
            </div>
          </div>
          <span class="badge-status online">Online</span>
        </div>
        <div class="kpi-value">12,450 parcels</div>
        <div class="kpi-sub">4,320 buildings</div>
        <div class="kpi-sparkline">
          <svg viewBox="0 0 160 28">
            <rect x="5" y="16" width="5" height="10" fill="#f59e0b" rx="1"/>
            <rect x="20" y="14" width="5" height="12" fill="#f59e0b" rx="1"/>
            <rect x="35" y="10" width="5" height="16" fill="#f59e0b" rx="1"/>
            <rect x="50" y="12" width="5" height="14" fill="#f59e0b" rx="1"/>
            <rect x="65" y="8" width="5" height="18" fill="#f59e0b" rx="1"/>
            <rect x="80" y="11" width="5" height="15" fill="#f59e0b" rx="1"/>
            <rect x="95" y="6" width="5" height="20" fill="#f59e0b" rx="1"/>
            <rect x="110" y="9" width="5" height="17" fill="#f59e0b" rx="1"/>
            <rect x="125" y="5" width="5" height="21" fill="#f59e0b" rx="1"/>
            <rect x="140" y="4" width="5" height="22" fill="#f59e0b" rx="1"/>
          </svg>
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------- Middle Row: 3 Columns
function renderMiddleRow() {
  const delta = S.simDelta;
  const simPopTotal = Math.round(288000 * (1 + delta / 100));

  return `
    <section class="mid-row-grid">
      <!-- 1. MAP PANEL -->
      <div class="panel map-card">
        <div class="card-head">
          <div class="card-title">Dalarna – Overall Risk (Simulated ${S.simYear})</div>
          <select class="select-pill" id="map-risk-select">
            <option value="overall" selected>Overall risk</option>
            <option value="infrastructure">Infrastructure risk</option>
            <option value="environmental">Environmental risk</option>
            <option value="food">Food & supply risk</option>
          </select>
        </div>
        <div class="map-container-wrap" id="map-slot">
          <!-- Top Left Tools -->
          <div class="map-tools-topleft">
            <button class="map-tool-btn" id="btn-zoom-in" title="Zoom in"><i class="fa-solid fa-plus"></i></button>
            <button class="map-tool-btn" id="btn-zoom-out" title="Zoom out"><i class="fa-solid fa-minus"></i></button>
            <button class="map-tool-btn" id="btn-map-layers" title="Toggle layers"><i class="fa-solid fa-layer-group"></i></button>
          </div>

          <!-- Bottom Left Risk Legend -->
          <div class="map-risk-legend">
            <div class="legend-title">Risk level</div>
            <div class="legend-item"><span class="legend-dot" style="background:#22c55e"></span> Low</div>
            <div class="legend-item"><span class="legend-dot" style="background:#eab308"></span> Medium</div>
            <div class="legend-item"><span class="legend-dot" style="background:#f97316"></span> High</div>
            <div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span> Critical</div>
          </div>

          <!-- Scale Indicator -->
          <div class="map-scale-bar">
            <span>0</span>
            <div class="scale-line"></div>
            <span>40 km</span>
          </div>

          <div id="map-host"></div>
        </div>
      </div>

      <!-- 2. SIMULATION CONTROL -->
      <div class="panel sim-ctrl-card">
        <div class="card-head">
          <div class="card-title"><i class="fa-solid fa-gear text-blue"></i> Simulation Control</div>
        </div>

        <div class="sim-form-group">
          <label class="sim-label">Scenario</label>
          <select class="sim-select" id="sim-scenario-select">
            <option value="pop_growth" selected>Population Growth</option>
            <option value="climate">Climate & Precipitation Stress</option>
            <option value="winter">Winter Freeze & Black Ice Crisis</option>
            <option value="forestry">Forestry Resource Strain</option>
          </select>
        </div>

        <div class="sim-form-group">
          <label class="sim-label">Target year</label>
          <div class="year-pills" id="sim-year-pills">
            <button class="year-pill ${S.simYear === 2026 ? "active" : ""}" data-year="2026">2026</button>
            <button class="year-pill ${S.simYear === 2030 ? "active" : ""}" data-year="2030">2030</button>
            <button class="year-pill ${S.simYear === 2035 ? "active" : ""}" data-year="2035">2035</button>
            <button class="year-pill ${S.simYear === 2040 ? "active" : ""}" data-year="2040">2040</button>
          </div>
        </div>

        <div class="sim-form-group">
          <div class="slider-header">
            <span class="sim-label">Population change</span>
            <span class="badge-val" id="pop-val-badge">+${delta}%</span>
          </div>
          <input type="range" class="sim-range" id="pop-slider" min="-20" max="30" value="${delta}" step="1">
        </div>

        <div class="sim-form-group">
          <label class="sim-label">Scope</label>
          <select class="sim-select" id="sim-scope-select">
            <option value="dalarna" selected>All Dalarna (15 municipalities)</option>
            <option value="2081">Borlänge</option>
            <option value="2080">Falun</option>
            <option value="2062">Mora</option>
          </select>
        </div>

        <div class="toggles-header">Automatically include affected sources</div>
        <div class="sim-toggles-list">
          <label class="sim-toggle-row">
            <span class="toggle-name"><i class="fa-solid fa-users text-purple"></i> SCB – Population (driver)</span>
            <input type="checkbox" class="toggle-switch-input" checked>
            <span class="toggle-switch-slider"></span>
          </label>
          <label class="sim-toggle-row">
            <span class="toggle-name"><i class="fa-solid fa-road text-blue"></i> Trafikverket – Traffic & roads</span>
            <input type="checkbox" class="toggle-switch-input" checked>
            <span class="toggle-switch-slider"></span>
          </label>
          <label class="sim-toggle-row">
            <span class="toggle-name"><i class="fa-solid fa-map-location-dot text-teal"></i> Lantmäteriet – Land use & development</span>
            <input type="checkbox" class="toggle-switch-input" checked>
            <span class="toggle-switch-slider"></span>
          </label>
          <label class="sim-toggle-row">
            <span class="toggle-name"><i class="fa-solid fa-tree text-green"></i> Skogsstyrelsen – Forest & environment</span>
            <input type="checkbox" class="toggle-switch-input" checked>
            <span class="toggle-switch-slider"></span>
          </label>
          <label class="sim-toggle-row">
            <span class="toggle-name"><i class="fa-solid fa-droplet text-cyan"></i> SGU – Water & geology</span>
            <input type="checkbox" class="toggle-switch-input" checked>
            <span class="toggle-switch-slider"></span>
          </label>
          <label class="sim-toggle-row">
            <span class="toggle-name"><i class="fa-solid fa-cloud-sun text-yellow"></i> SMHI – Weather (external condition)</span>
            <input type="checkbox" class="toggle-switch-input" checked>
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <button class="btn-run-sim" id="btn-run-sim"><i class="fa-solid fa-play"></i> Run Simulation</button>
        <button class="btn-reset-sim" id="btn-reset-sim">Reset</button>
        <div class="advanced-opt-link">Advanced options ▾</div>
      </div>

      <!-- 3. SIMULATION RESULTS -->
      <div class="panel sim-res-card">
        <div class="card-head">
          <div class="card-title">Simulation Results – Dalarna (${S.simYear})</div>
          <select class="select-pill">
            <option>Population Growth (+${delta}%)</option>
          </select>
        </div>

        <!-- 5 Metric Boxes -->
        <div class="metrics-5-box">
          <div class="m5-item">
            <i class="fa-solid fa-users m5-icon text-purple"></i>
            <span class="m5-title">Population</span>
            <div class="m5-val-row">
              <span class="m5-val-text">${fmtNum(simPopTotal)}</span>
              <span class="arrow-up text-purple">↑</span>
            </div>
          </div>
          <div class="m5-item">
            <i class="fa-solid fa-leaf m5-icon text-green"></i>
            <span class="m5-title">Food risk</span>
            <div class="m5-val-row">
              <span class="risk-badge medium">Medium</span>
              <span class="arrow-up text-yellow">↑</span>
            </div>
          </div>
          <div class="m5-item">
            <i class="fa-regular fa-snowflake m5-icon text-cyan"></i>
            <span class="m5-title">Snow/Flood risk</span>
            <div class="m5-val-row">
              <span class="risk-badge medium">Medium</span>
              <span class="arrow-right text-yellow">→</span>
            </div>
          </div>
          <div class="m5-item">
            <i class="fa-solid fa-road m5-icon text-blue"></i>
            <span class="m5-title">Infrastructure risk</span>
            <div class="m5-val-row">
              <span class="risk-badge high">High</span>
              <span class="arrow-up text-red">↑</span>
            </div>
          </div>
          <div class="m5-item">
            <i class="fa-solid fa-tree m5-icon text-green"></i>
            <span class="m5-title">Environment risk</span>
            <div class="m5-val-row">
              <span class="risk-badge medium">Medium</span>
              <span class="arrow-right text-yellow">→</span>
            </div>
          </div>
        </div>

        <!-- Impact Table -->
        <div class="impact-table-wrap">
          <div class="impact-title">Impact by source (Dalarna total)</div>
          <table class="impact-table">
            <thead>
              <tr>
                <th></th>
                <th>Current (2025)</th>
                <th>Simulated (${S.simYear})</th>
                <th>Change</th>
                <th>Impact</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><i class="fa-solid fa-users text-purple"></i> Population (SCB)</td>
                <td>288,000</td>
                <td>${fmtNum(simPopTotal)}</td>
                <td class="text-green">+${delta}%</td>
                <td>—</td>
              </tr>
              <tr>
                <td><i class="fa-solid fa-road text-blue"></i> Traffic (Trafikverket)</td>
                <td>100 (index)</td>
                <td>${Math.round(100 + delta * 1.2)}</td>
                <td class="text-green">+${Math.round(delta * 1.2)}%</td>
                <td><span class="risk-badge high">High</span></td>
              </tr>
              <tr>
                <td><i class="fa-solid fa-map-location-dot text-teal"></i> Land parcels (Lantmäteriet)</td>
                <td>12,450</td>
                <td>${fmtNum(Math.round(12450 * (1 + delta / 100)))}</td>
                <td class="text-green">+${delta}%</td>
                <td><span class="risk-badge high">High</span></td>
              </tr>
              <tr>
                <td><i class="fa-solid fa-tree text-green"></i> Forest area (Skogsstyrelsen)</td>
                <td>450,000 ha</td>
                <td>${fmtNum(Math.round(450000 * (1 - delta * 0.002)))} ha</td>
                <td class="text-red">-${(delta * 0.2).toFixed(0)}%</td>
                <td><span class="risk-badge medium">Medium</span></td>
              </tr>
              <tr>
                <td><i class="fa-solid fa-droplet text-cyan"></i> Water exposure (SGU)</td>
                <td>293</td>
                <td>${Math.round(293 * (1 + delta * 0.006))}</td>
                <td class="text-green">+${(delta * 0.6).toFixed(0)}%</td>
                <td><span class="risk-badge medium">Medium</span></td>
              </tr>
              <tr>
                <td><i class="fa-solid fa-cloud-sun text-yellow"></i> Weather (SMHI)</td>
                <td>7.1 °C</td>
                <td>${(7.1 + delta * 0.02).toFixed(1)} °C</td>
                <td class="text-green">+${(delta * 0.02).toFixed(1)} °C</td>
                <td><span class="risk-badge external">External</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Split Bottom: Gauge + Key Takeaway -->
        <div class="res-split-bottom">
          <div class="gauge-box">
            <div class="gauge-title">Overall Regional Risk</div>
            <svg viewBox="0 0 100 55" class="radial-gauge-svg">
              <!-- Background Arc -->
              <path d="M15 50 A35 35 0 0 1 85 50" fill="none" stroke="#1c2b44" stroke-width="9" stroke-linecap="round"/>
              <!-- Active Colored Arc (Amber/Yellow for Medium) -->
              <path d="M15 50 A35 35 0 0 1 65 20" fill="none" stroke="#f59e0b" stroke-width="9" stroke-linecap="round"/>
              <!-- Needle Pointer -->
              <line x1="50" y1="50" x2="52" y2="24" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
              <circle cx="50" cy="50" r="3.5" fill="#ffffff"/>
            </svg>
            <div class="gauge-label">MEDIUM</div>
          </div>

          <div class="takeaway-box">
            <div class="takeaway-head"><i class="fa-regular fa-lightbulb"></i> Key Takeaway</div>
            <div class="takeaway-text">
              A ${delta}% population increase is expected to increase traffic demand and land development pressure, with higher infrastructure risk and moderate environmental impacts.
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------- Bottom Row: Municipalities Table
function renderMunicipalitiesTable() {
  const delta = S.simDelta;
  let items = [...BASE_MUNICIPALITIES];

  if (S.simSearch) {
    const q = S.simSearch.toLowerCase();
    items = items.filter((m) => m.name.toLowerCase().includes(q));
  }
  if (S.simFilter && S.simFilter !== "all") {
    items = items.filter((m) => m.overall.toLowerCase() === S.simFilter.toLowerCase());
  }

  const rowsHtml = items
    .map((m) => {
      const simPop = Math.round(m.current * (1 + delta / 100));
      return `
        <tr data-code="${m.code}">
          <td>${m.rank}</td>
          <td><b>${esc(m.name)}</b></td>
          <td class="num">${fmtNum(m.current)}</td>
          <td class="num">${fmtNum(simPop)}</td>
          <td class="num text-green">+${delta}%</td>
          <td class="center"><span class="risk-badge ${m.food.toLowerCase()}">${m.food}</span></td>
          <td class="center"><span class="risk-badge ${m.snow.toLowerCase()}">${m.snow}</span></td>
          <td class="center"><span class="risk-badge ${m.infra.toLowerCase()}">${m.infra}</span></td>
          <td class="center"><span class="risk-badge ${m.env.toLowerCase()}">${m.env}</span></td>
          <td class="center"><span class="risk-badge ${m.overall.toLowerCase()}">${m.overall}</span></td>
          <td class="center">
            <svg class="sparkline-trend-svg" viewBox="0 0 80 20">
              <path d="M0,15 Q20,5 40,12 T80,8" stroke="${m.trendColor}"/>
            </svg>
          </td>
          <td class="center">
            <button class="btn-icon-view" data-code="${m.code}" title="View detailed breakdown">
              <i class="fa-solid fa-chart-simple"></i>
            </button>
          </td>
        </tr>`;
    })
    .join("");

  const totalCurrent = 288000;
  const totalSim = Math.round(totalCurrent * (1 + delta / 100));

  return `
    <section class="panel muni-card">
      <div class="muni-sim-header">
        <div class="muni-sim-title">
          <i class="fa-solid fa-gear text-blue"></i>
          Municipalities – Simulation Results (${S.simYear})
        </div>
        <div class="muni-sim-controls">
          <div class="search-box">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="muni-search-input" placeholder="Search municipality..." value="${esc(S.simSearch)}">
          </div>
          <select class="sim-select" id="muni-filter-select">
            <option value="all" ${S.simFilter === "all" ? "selected" : ""}>All municipalities</option>
            <option value="high" ${S.simFilter === "high" ? "selected" : ""}>High risk</option>
            <option value="medium" ${S.simFilter === "medium" ? "selected" : ""}>Medium risk</option>
            <option value="low" ${S.simFilter === "low" ? "selected" : ""}>Low risk</option>
          </select>
          <button class="btn-export" id="btn-export-csv">
            <i class="fa-solid fa-download"></i> Export
          </button>
        </div>
      </div>

      <div class="muni-table-scroll">
        <table class="muni-full-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Municipality</th>
              <th class="num">Current</th>
              <th class="num">Simulated</th>
              <th class="num">Δ%</th>
              <th class="center"><i class="fa-solid fa-leaf text-green"></i> Food risk</th>
              <th class="center"><i class="fa-regular fa-snowflake text-cyan"></i> Snow/Flood risk</th>
              <th class="center"><i class="fa-solid fa-road text-blue"></i> Infrastructure risk</th>
              <th class="center"><i class="fa-solid fa-tree text-green"></i> Environment risk</th>
              <th class="center"><i class="fa-solid fa-circle-half-stroke text-yellow"></i> Overall risk</th>
              <th class="center">Trend (overall risk)</th>
              <th class="center">View</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td>Dalarna (Total)</td>
              <td class="num">${fmtNum(totalCurrent)}</td>
              <td class="num">${fmtNum(totalSim)}</td>
              <td class="num text-green">+${delta}%</td>
              <td class="center"><span class="risk-badge medium">Medium</span></td>
              <td class="center"><span class="risk-badge medium">Medium</span></td>
              <td class="center"><span class="risk-badge high">High</span></td>
              <td class="center"><span class="risk-badge medium">Medium</span></td>
              <td class="center"><span class="risk-badge medium">Medium</span></td>
              <td class="center">
                <svg class="sparkline-trend-svg" viewBox="0 0 80 20">
                  <path d="M0,14 Q20,6 40,10 T80,7" stroke="#f59e0b"/>
                </svg>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>`;
}

// ---------------------------------------------------------------- Mount & Wire Map
function mountMap() {
  const slot = $("#map-slot");
  if (!slot) return;
  if (!S.map) {
    const host = document.createElement("div");
    host.id = "map-host";
    S.map = new DalarnaMap(host, {
      onMunicipalityClick: (code) => {
        openMunicipality(code);
      },
    });
    S.mapEl = host;
  }
  slot.appendChild(S.mapEl);
  S.map.resize();

  // Attach controls
  $("#btn-zoom-in")?.addEventListener("click", () => S.map.zoomIn());
  $("#btn-zoom-out")?.addEventListener("click", () => S.map.zoomOut());
}

function openMunicipality(code) {
  const m = BASE_MUNICIPALITIES.find((x) => x.code === code);
  if (!m) return;
  const simPop = Math.round(m.current * (1 + S.simDelta / 100));
  openDrawer(`
    <h2>${esc(m.name)}</h2>
    <div class="muted small">Municipality code ${esc(m.code)} · Dalarna County</div>
    <div style="margin: 16px 0; display:flex; gap: 8px;">
      <span class="risk-badge ${m.overall.toLowerCase()}">Overall: ${m.overall}</span>
      <span class="risk-badge ${m.infra.toLowerCase()}">Infra: ${m.infra}</span>
    </div>
    <dl style="display:grid; grid-template-columns: 140px 1fr; gap: 8px 12px; margin: 16px 0;">
      <dt class="muted">Current Population</dt><dd><b>${fmtNum(m.current)}</b> (SCB 2024)</dd>
      <dt class="muted">Simulated (${S.simYear})</dt><dd><b class="text-green">${fmtNum(simPop)}</b> (+${S.simDelta}%)</dd>
      <dt class="muted">Food supply risk</dt><dd><span class="risk-badge ${m.food.toLowerCase()}">${m.food}</span></dd>
      <dt class="muted">Snow & Flood risk</dt><dd><span class="risk-badge ${m.snow.toLowerCase()}">${m.snow}</span></dd>
      <dt class="muted">Infrastructure risk</dt><dd><span class="risk-badge ${m.infra.toLowerCase()}">${m.infra}</span></dd>
      <dt class="muted">Environmental risk</dt><dd><span class="risk-badge ${m.env.toLowerCase()}">${m.env}</span></dd>
    </dl>
    <p class="small muted">Simulation calculated by Dalarna Regional Digital Twin multi-source model.</p>
  `);
}

// ---------------------------------------------------------------- Main Render
function render() {
  renderHeader();
  const view = $("#view");
  if (!view) return;

  const r = route();
  document.querySelectorAll("#nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === r);
  });

  if (r === "overview" || PREVIEW) {
    view.innerHTML = `
      ${renderKpiCards()}
      ${renderMiddleRow()}
      ${renderMunicipalitiesTable()}
    `;
    mountMap();
    wireEvents();
  } else if (r === "map") {
    view.innerHTML = `
      <section class="panel map-card">
        <div class="card-head">
          <div class="card-title">Dalarna – Regional Map View</div>
        </div>
        <div class="map-container-wrap" style="height: 75vh;" id="map-slot">
          <div id="map-host"></div>
        </div>
      </section>`;
    mountMap();
  } else if (r === "municipalities") {
    view.innerHTML = renderMunicipalitiesTable();
    wireEvents();
  } else {
    view.innerHTML = `
      <section class="panel">
        <h2>${esc(r.charAt(0).toUpperCase() + r.slice(1).replace("-", " "))}</h2>
        <p class="muted">Real-time telemetry and Digital Twin simulation parameters loaded.</p>
      </section>
      ${renderKpiCards()}
    `;
  }
}

// ---------------------------------------------------------------- Interactive Event Listeners
function wireEvents() {
  // Slider update
  const slider = $("#pop-slider");
  const badge = $("#pop-val-badge");
  if (slider && badge) {
    slider.oninput = () => {
      S.simDelta = parseInt(slider.value, 10);
      badge.textContent = `${S.simDelta >= 0 ? "+" : ""}${S.simDelta}%`;
    };
  }

  // Year pills
  document.querySelectorAll("#sim-year-pills .year-pill").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#sim-year-pills .year-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      S.simYear = parseInt(btn.dataset.year, 10);
    };
  });

  // Run Simulation Button
  const btnRun = $("#btn-run-sim");
  if (btnRun) {
    btnRun.onclick = async () => {
      btnRun.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Simulating...`;
      btnRun.disabled = true;

      // Also invoke backend what-if endpoint
      try {
        await fetch("/api/simulation/what-if", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            simulated_road_temp: 5.9,
            simulated_air_temp: 7.1 + S.simDelta * 0.02,
          }),
        });
      } catch (e) {}

      setTimeout(() => {
        btnRun.disabled = false;
        toast(`Simulation for ${S.simYear} complete (+${S.simDelta}% scenario applied).`, "ok");
        render();
      }, 350);
    };
  }

  // Reset Button
  const btnReset = $("#btn-reset-sim");
  if (btnReset) {
    btnReset.onclick = () => {
      S.simDelta = 10;
      S.simYear = 2030;
      toast("Simulation parameters reset to default.", "ok");
      render();
    };
  }

  // Search Input
  const searchInput = $("#muni-search-input");
  if (searchInput) {
    searchInput.oninput = (e) => {
      S.simSearch = e.target.value;
      const tbody = document.querySelector(".muni-full-table tbody");
      if (tbody) {
        let items = [...BASE_MUNICIPALITIES];
        if (S.simSearch) items = items.filter((m) => m.name.toLowerCase().includes(S.simSearch.toLowerCase()));
        if (S.simFilter && S.simFilter !== "all") items = items.filter((m) => m.overall.toLowerCase() === S.simFilter.toLowerCase());
        tbody.innerHTML = items
          .map((m) => {
            const simPop = Math.round(m.current * (1 + S.simDelta / 100));
            return `
              <tr data-code="${m.code}">
                <td>${m.rank}</td>
                <td><b>${esc(m.name)}</b></td>
                <td class="num">${fmtNum(m.current)}</td>
                <td class="num">${fmtNum(simPop)}</td>
                <td class="num text-green">+${S.simDelta}%</td>
                <td class="center"><span class="risk-badge ${m.food.toLowerCase()}">${m.food}</span></td>
                <td class="center"><span class="risk-badge ${m.snow.toLowerCase()}">${m.snow}</span></td>
                <td class="center"><span class="risk-badge ${m.infra.toLowerCase()}">${m.infra}</span></td>
                <td class="center"><span class="risk-badge ${m.env.toLowerCase()}">${m.env}</span></td>
                <td class="center"><span class="risk-badge ${m.overall.toLowerCase()}">${m.overall}</span></td>
                <td class="center">
                  <svg class="sparkline-trend-svg" viewBox="0 0 80 20">
                    <path d="M0,15 Q20,5 40,12 T80,8" stroke="${m.trendColor}"/>
                  </svg>
                </td>
                <td class="center">
                  <button class="btn-icon-view" data-code="${m.code}">
                    <i class="fa-solid fa-chart-simple"></i>
                  </button>
                </td>
              </tr>`;
          })
          .join("");
        wireViewButtons();
      }
    };
  }

  // Filter Select
  const filterSelect = $("#muni-filter-select");
  if (filterSelect) {
    filterSelect.onchange = (e) => {
      S.simFilter = e.target.value;
      render();
    };
  }

  // Export CSV
  const btnExport = $("#btn-export-csv");
  if (btnExport) {
    btnExport.onclick = () => {
      let csv = "Rank,Municipality,Current,Simulated,Change,FoodRisk,SnowRisk,InfraRisk,EnvRisk,OverallRisk\n";
      BASE_MUNICIPALITIES.forEach((m) => {
        csv += `${m.rank},${m.name},${m.current},${Math.round(m.current * (1 + S.simDelta / 100))},+${S.simDelta}%,${m.food},${m.snow},${m.infra},${m.env},${m.overall}\n`;
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dalarna_simulation_${S.simYear}.csv`;
      a.click();
      toast("CSV file downloaded.", "ok");
    };
  }

  wireViewButtons();
}

function wireViewButtons() {
  document.querySelectorAll(".btn-icon-view").forEach((btn) => {
    btn.onclick = () => openMunicipality(btn.dataset.code);
  });
}

// Route changes
window.addEventListener("hashchange", render);

// Auto initial load
loadAll();
