// Small shared helpers: escaping, formatting, toasts, drawer.

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtNum(n) {
  return n == null || Number.isNaN(n) ? "—" : new Intl.NumberFormat("sv-SE").format(n);
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

export function relTime(iso) {
  if (!iso) return "never";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

export function fmtInterval(seconds) {
  if (seconds % 86400 === 0) return seconds === 86400 ? "24 hours" : `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? "1 hour" : `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} min`;
}

export function toast(message, kind = "info", ms = 5000) {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Opens a right-hand drawer with `html` (already escaped by the caller). Returns a close function. */
export function openDrawer(html) {
  closeDrawer();
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  backdrop.id = "drawer-backdrop";
  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.id = "drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.innerHTML = `<button class="btn small" id="drawer-close" style="float:right">Close</button>${html}`;
  document.body.append(backdrop, drawer);
  backdrop.addEventListener("click", closeDrawer);
  drawer.querySelector("#drawer-close").addEventListener("click", closeDrawer);
  drawer.querySelector("#drawer-close").focus();
  document.addEventListener("keydown", escClose);
  return closeDrawer;
}

function escClose(e) {
  if (e.key === "Escape") closeDrawer();
}

export function closeDrawer() {
  document.getElementById("drawer")?.remove();
  document.getElementById("drawer-backdrop")?.remove();
  document.removeEventListener("keydown", escClose);
}

export function statusBadge(status, label, suffix = "") {
  return `<span class="badge ${esc(status)}">${esc(label)}${suffix ? " " + esc(suffix) : ""}</span>`;
}
