// Helpers shared by the Main Dashboard and the Admin Control Room.
// Nothing here is a threshold or a source list: those always come from the backend.

export const LEVELS = ["low", "medium", "high", "critical"]; // order only; boundaries come from /api/risk/config
export const LEVEL_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
// Presentation colours for each class (not thresholds).
export const LEVEL_COLOR = { low: "#22c55e", medium: "#eab308", high: "#f97316", critical: "#ef4444" };
export const NEUTRAL_COLOR = "#334155";

export const RISK_CATS = [
  { key: "overall_risk", label: "Overall risk", short: "Overall", component: "regional_risk", icon: "fa-circle-half-stroke" },
  { key: "food_risk", label: "Food & supply risk", short: "Food / Supply", component: "food_risk", icon: "fa-leaf" },
  { key: "snow_flood_risk", label: "Snow / Flood risk", short: "Snow / Flood", component: "snow_flood_risk", icon: "fa-snowflake" },
  { key: "infrastructure_risk", label: "Infrastructure risk", short: "Infrastructure", component: "infrastructure_risk", icon: "fa-road" },
  { key: "environment_risk", label: "Environment risk", short: "Environment", component: "environment_risk", icon: "fa-tree" },
];

/** Normalise any stored threshold shape to ascending upper bounds {low, medium, high}. */
export function normalizeThresholds(th) {
  const t = th || {};
  const n = (v, d) => (typeof v === "number" && !Number.isNaN(v) ? v : d);
  // Lower-bound shape: {low:0, medium:.30, high:.60, critical:.80}
  if (t.low === 0 && typeof t.critical === "number" && t.critical < 1) {
    return { low: n(t.medium, 0.3), medium: n(t.high, 0.6), high: n(t.critical, 0.8) };
  }
  return { low: n(t.low, 0.3), medium: n(t.medium, 0.6), high: n(t.high, 0.8) };
}

export function classify(score, th) {
  const t = normalizeThresholds(th);
  if (score == null || Number.isNaN(score)) return null;
  if (score < t.low) return "low";
  if (score < t.medium) return "medium";
  if (score < t.high) return "high";
  return "critical";
}

export function bands(th) {
  const t = normalizeThresholds(th);
  return [
    { level: "low", from: 0, to: t.low },
    { level: "medium", from: t.low, to: t.medium },
    { level: "high", from: t.medium, to: t.high },
    { level: "critical", from: t.high, to: 1 },
  ];
}

export function validateThresholds(t) {
  const errs = [];
  const v = [t.low, t.medium, t.high];
  if (v.some((x) => typeof x !== "number" || Number.isNaN(x))) return ["All thresholds must be numbers."];
  if (v.some((x) => x <= 0 || x >= 1)) errs.push("Thresholds must be between 0 and 1 (exclusive).");
  if (!(t.low < t.medium && t.medium < t.high)) errs.push("Thresholds must be strictly ascending (LOW < MEDIUM < HIGH).");
  return errs;
}

export const lc = (s) => String(s ?? "").toLowerCase();

/** Icon + colour for a source, derived from its registry category so new sources look right with no code. */
export function sourceVisual(source) {
  const c = lc(source?.category) + " " + lc(source?.name);
  const table = [
    [/weather|smhi|climate/, "fa-cloud-sun", "text-yellow"],
    [/traffic|road|infrastructure|transport/, "fa-road", "text-blue"],
    [/population|statistic|demograph/, "fa-users", "text-purple"],
    [/water|geolog|hydro|ground/, "fa-droplet", "text-cyan"],
    [/forest|environment|nature/, "fa-tree", "text-green"],
    [/land|geospatial|parcel|cadastr/, "fa-map-location-dot", "text-teal"],
  ];
  for (const [re, icon, color] of table) if (re.test(c)) return { icon, color };
  return { icon: "fa-database", color: "text-blue" };
}

export const STATUS_CLASS = {
  online: "online",
  stale: "stale",
  error: "error",
  not_configured: "warn",
  disabled: "disabled",
  fallback: "warn",
  pending: "warn",
};

export function statusPill(status, label) {
  return `<span class="status-pill ${STATUS_CLASS[status] || "warn"}">${label || status}</span>`;
}

export function fmtPct(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${Number(n).toFixed(digits)}%`;
}

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function safeStore(kind = "local") {
  try {
    const s = kind === "session" ? window.sessionStorage : window.localStorage;
    const k = "__t";
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch (_) {
    return null;
  }
}

export function storeGet(kind, key, fallback = null) {
  try {
    const s = safeStore(kind);
    const v = s?.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}

export function storeSet(kind, key, value) {
  try {
    safeStore(kind)?.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* storage unavailable: UI still works without persistence */
  }
}

/** Dotted paths whose values differ between two plain objects. */
export function diffPaths(a, b, prefix = "") {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of [...keys].sort()) {
    const x = a?.[k];
    const y = b?.[k];
    const p = prefix + k;
    if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x)) out.push(...diffPaths(x, y, p + "."));
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(p);
  }
  return out;
}

export function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

let xlsxPromise = null;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => {
        xlsxPromise = null;
        reject(new Error("xlsx library unavailable"));
      };
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}
