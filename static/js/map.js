// MapLibre map of Dalarna: municipality boundaries + population choropleth + source overlays.
// All data comes from the backend; nothing is hard-coded except layer colours.
import { get } from "./api.js";
import { esc, fmtNum } from "./util.js";

const OVERLAY_COLORS = { weather: "#facc15", roads: "#fb923c", water: "#38bdf8", forest: "#22c55e", land: "#c084fc" };
const POP_COLORS = ["#16335c", "#1d4f8f", "#2a6fc4", "#4b93e6", "#8ec3ff"];
const BLANK_STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a1222" } }] };

export class DalarnaMap {
  constructor(container, { onMunicipalityClick } = {}) {
    this.container = container;
    this.onMunicipalityClick = onMunicipalityClick;
    this.overlays = {}; // layer id -> {loaded, source}
    this.markers = [];
    this.legendEl = null;
    this.ready = this._init();
  }

  async _init() {
    const maplibregl = window.maplibregl;
    if (!maplibregl) throw new Error("MapLibre failed to load");
    this.gl = maplibregl;
    this.geo = await get("/data/dalarna_municipalities.geojson");
    this.map = new maplibregl.Map({
      container: this.container,
      style: BLANK_STYLE,
      bounds: [[12.0, 59.85], [16.95, 62.05]],
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true, customAttribution: "Municipalities: Open Knowledge Sweden / Valmyndigheten" },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    this.map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    await new Promise((resolve) => this.map.on("load", resolve));

    this.map.addSource("muni", { type: "geojson", data: this.geo, promoteId: "code" });
    this.map.addLayer({ id: "muni-fill", type: "fill", source: "muni", paint: { "fill-color": "#16233d", "fill-opacity": 0.9 } });
    this.map.addLayer({ id: "muni-selected", type: "fill", source: "muni", filter: ["==", ["get", "code"], ""], paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 } });
    this.map.addLayer({ id: "muni-line", type: "line", source: "muni", paint: { "line-color": "#5b7199", "line-width": 1 } });

    this.map.on("click", "muni-fill", (e) => {
      if (this._overlayHit(e)) return;
      const code = e.features?.[0]?.properties?.code;
      if (code && this.onMunicipalityClick) this.onMunicipalityClick(code, e.lngLat);
    });
    this.map.on("mouseenter", "muni-fill", () => (this.map.getCanvas().style.cursor = "pointer"));
    this.map.on("mouseleave", "muni-fill", () => (this.map.getCanvas().style.cursor = ""));

    for (const f of this.geo.features) {
      const el = document.createElement("div");
      el.className = "muni-label";
      el.textContent = f.properties.name;
      this.markers.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(f.properties.centroid).addTo(this.map));
    }
    return this;
  }

  _overlayHit(e) {
    const ids = Object.values(this.overlays).flatMap((o) => o.layerIds || []).filter((id) => this.map.getLayer(id));
    return ids.length ? this.map.queryRenderedFeatures(e.point, { layers: ids }).length > 0 : false;
  }

  /** municipalities: [{code,name,population:{value,period,origin}|null}] */
  async setMunicipalityData(municipalities) {
    await this.ready;
    this.municipalities = municipalities;
    const values = municipalities.map((m) => m.population?.value).filter((v) => typeof v === "number").sort((a, b) => a - b);
    for (const f of this.geo.features) {
      const m = municipalities.find((x) => x.code === f.properties.code);
      f.properties.pop = m?.population?.value ?? null;
    }
    this.map.getSource("muni").setData(this.geo);
    this.breaks = [];
    if (values.length >= 5) {
      for (let i = 1; i < 5; i++) this.breaks.push(values[Math.floor((values.length * i) / 5)]);
    }
    this._applyFill();
    this._drawLegend();
  }

  setPopulationVisible(on) {
    this.populationOn = on;
    if (this.map?.getLayer("muni-fill")) {
      this._applyFill();
      this._drawLegend();
    }
  }

  _applyFill() {
    if (!this.map.getLayer("muni-fill")) return;
    let color = "#16233d";
    if (this.populationOn !== false && this.breaks?.length === 4) {
      color = ["case", ["==", ["get", "pop"], null], "#1a2238", ["step", ["get", "pop"], POP_COLORS[0], this.breaks[0], POP_COLORS[1], this.breaks[1], POP_COLORS[2], this.breaks[2], POP_COLORS[3], this.breaks[3], POP_COLORS[4]]];
    }
    this.map.setPaintProperty("muni-fill", "fill-color", color);
  }

  _drawLegend() {
    this.legendEl?.remove();
    this.legendEl = null;
    if (this.populationOn === false || !this.breaks?.length) return;
    const bounds = [0, ...this.breaks, null];
    const rows = POP_COLORS.map((c, i) => {
      const lo = bounds[i];
      const hi = bounds[i + 1];
      const label = i === 0 ? `< ${fmtNum(hi)}` : hi == null ? `≥ ${fmtNum(lo)}` : `${fmtNum(lo)} – ${fmtNum(hi)}`;
      return `<div><span class="sw" style="background:${c}"></span>${label}</div>`;
    }).join("");
    const el = document.createElement("div");
    el.className = "map-legend";
    const origins = new Set((this.municipalities || []).map((m) => m.population?.origin).filter(Boolean));
    el.innerHTML = `<b>Population</b>${rows}${origins.has("fallback") ? '<div class="small" style="color:var(--fallback)">fallback data</div>' : ""}`;
    this.container.appendChild(el);
    this.legendEl = el;
  }

  setBoundariesVisible(on) {
    this.ready.then(() => {
      this.map.setLayoutProperty("muni-line", "visibility", on ? "visible" : "none");
      this.markers.forEach((m) => (m.getElement().style.display = on ? "" : "none"));
    });
  }

  /** Focus the map on one municipality code, or the whole county when scope === "dalarna". */
  async setScope(scope) {
    await this.ready;
    this.map.setFilter("muni-selected", ["==", ["get", "code"], scope === "dalarna" ? "" : scope]);
    if (scope === "dalarna") {
      this.map.fitBounds([[12.0, 59.85], [16.95, 62.05]], { padding: 20 });
      return;
    }
    const f = this.geo.features.find((x) => x.properties.code === scope);
    if (!f) return;
    const b = new this.gl.LngLatBounds();
    const walk = (c) => (typeof c[0] === "number" ? b.extend(c) : c.forEach(walk));
    walk(f.geometry.coordinates);
    this.map.fitBounds(b, { padding: 40 });
  }

  /** states: {layerId: {visible, available, source}} for the source overlays. */
  async setOverlays(states) {
    await this.ready;
    for (const [id, st] of Object.entries(states)) {
      if (!OVERLAY_COLORS[id]) continue;
      const show = st.visible && st.available;
      if (show && !this.overlays[id]?.loaded) await this._loadOverlay(id, st.source);
      for (const lid of this.overlays[id]?.layerIds || []) {
        if (this.map.getLayer(lid)) this.map.setLayoutProperty(lid, "visibility", show ? "visible" : "none");
      }
    }
  }

  async _loadOverlay(id, source) {
    this.overlays[id] = { loaded: true, layerIds: [] };
    let fc;
    try {
      fc = await get(`/api/datasources?source=${encodeURIComponent(source)}`);
    } catch (e) {
      this.overlays[id].loaded = false;
      return;
    }
    const color = OVERLAY_COLORS[id];
    const srcId = `ov-${id}`;
    this.map.addSource(srcId, { type: "geojson", data: fc });
    const defs = [
      { id: `${srcId}-fill`, type: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": 0.22 } },
      { id: `${srcId}-line`, type: "line", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": color, "line-width": 0.8, "line-opacity": 0.55 } },
      { id: `${srcId}-pt`, type: "circle", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": color, "circle-radius": 4, "circle-stroke-color": "#0a1222", "circle-stroke-width": 1 } },
    ];
    for (const d of defs) {
      this.map.addLayer({ ...d, source: srcId });
      this.overlays[id].layerIds.push(d.id);
      this.map.on("click", d.id, (e) => this._featurePopup(e));
    }
  }

  _featurePopup(e) {
    const p = e.features?.[0]?.properties;
    if (!p) return;
    let attrs = {};
    try {
      attrs = typeof p.attributes === "string" ? JSON.parse(p.attributes) : p.attributes || {};
    } catch (_) { /* ignore */ }
    const rows = Object.entries(attrs)
      .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
      .slice(0, 6)
      .map(([k, v]) => `<div><span class="muted">${esc(k)}</span> ${esc(v)}</div>`)
      .join("");
    new this.gl.Popup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="map-popup"><b>${esc(p.source_id)}</b> · ${esc(p.dataset_id || "")}${rows}<div class="small muted">${esc(p.feature_id || "")}</div></div>`)
      .addTo(this.map);
  }

  showMunicipalityPopup(lngLat, html) {
    new this.gl.Popup({ closeButton: true }).setLngLat(lngLat).setHTML(`<div class="map-popup">${html}</div>`).addTo(this.map);
  }

  resize() {
    this.map?.resize();
  }
}
