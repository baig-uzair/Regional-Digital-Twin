// MapLibre map of Dalarna. All colours/overlays are pushed in by the caller from backend data:
// this file contains no risk values, thresholds or source lists.
import { get } from "./api.js";
import { NEUTRAL_COLOR } from "./shared.js";

const BASE_STYLE = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Esri World Imagery",
    },
  },
  layers: [
    { id: "background-color", type: "background", paint: { "background-color": "#060c16" } },
    { id: "satellite-layer", type: "raster", source: "esri-satellite", paint: { "raster-opacity": 0.55, "raster-saturation": -0.5 } },
  ],
};

const DALARNA_BOUNDS = [[12.1, 59.85], [16.85, 62.15]];

export class DalarnaMap {
  constructor(container, { onMunicipalityClick, onMove } = {}) {
    this.container = container;
    this.onMunicipalityClick = onMunicipalityClick;
    this.onMove = onMove;
    this.markers = [];
    this.overlays = new Set();
    this.ready = this._init();
  }

  async _init() {
    const gl = window.maplibregl;
    if (!gl) throw new Error("MapLibre failed to load");
    this.gl = gl;
    this.geo = await get("/data/dalarna_municipalities.geojson");
    this.map = new gl.Map({
      container: this.container,
      style: BASE_STYLE,
      bounds: DALARNA_BOUNDS,
      fitBoundsOptions: { padding: 25 },
      attributionControl: false,
    });
    await new Promise((resolve) => this.map.on("load", resolve));

    this.map.addSource("muni", { type: "geojson", data: this.geo, promoteId: "code" });
    this.map.addLayer({
      id: "muni-fill",
      type: "fill",
      source: "muni",
      paint: { "fill-color": NEUTRAL_COLOR, "fill-opacity": 0.55 },
    });
    this.map.addLayer({
      id: "muni-line",
      type: "line",
      source: "muni",
      paint: { "line-color": "#ffffff", "line-width": 1.2, "line-opacity": 0.85 },
    });
    this.map.addLayer({
      id: "muni-focus",
      type: "line",
      source: "muni",
      filter: ["==", ["get", "code"], ""],
      paint: { "line-color": "#38bdf8", "line-width": 3 },
    });
    this.map.addLayer({
      id: "muni-hover",
      type: "line",
      source: "muni",
      filter: ["==", ["get", "code"], ""],
      paint: { "line-color": "#7dd3fc", "line-width": 2 },
    });

    this.map.on("mousemove", "muni-fill", (e) => {
      if (!e.features?.length) return;
      this.map.getCanvas().style.cursor = "pointer";
      this.map.setFilter("muni-hover", ["==", ["get", "code"], e.features[0].properties.code]);
    });
    this.map.on("mouseleave", "muni-fill", () => {
      this.map.getCanvas().style.cursor = "";
      this.map.setFilter("muni-hover", ["==", ["get", "code"], ""]);
    });
    this.map.on("click", "muni-fill", (e) => {
      const code = e.features?.[0]?.properties?.code;
      if (code && this.onMunicipalityClick) this.onMunicipalityClick(code, e.lngLat);
    });
    if (window.ResizeObserver) new ResizeObserver(() => this.map.resize()).observe(this.container);
    const moved = () => this.onMove && this.onMove(this.scaleInfo());
    this.map.on("move", moved);
    this.map.on("zoom", moved);
    moved();

    for (const f of this.geo.features) {
      const el = document.createElement("div");
      el.className = "map-muni-centroid-label";
      el.textContent = f.properties.name;
      this.markers.push(new gl.Marker({ element: el, anchor: "center" }).setLngLat(f.properties.centroid).addTo(this.map));
    }
    return this;
  }

  /** Real scale bar: nice round distance for ~80 px at the current latitude/zoom. */
  scaleInfo() {
    if (!this.map) return null;
    const lat = this.map.getCenter().lat;
    const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, this.map.getZoom());
    const targetM = mPerPx * 80;
    const steps = [500, 1000, 2000, 5000, 10000, 20000, 25000, 50000, 100000];
    const nice = steps.reduce((p, c) => (Math.abs(c - targetM) < Math.abs(p - targetM) ? c : p), steps[0]);
    return { label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, widthPx: Math.round(nice / mPerPx) };
  }

  zoomIn() { this.map?.zoomIn(); }
  zoomOut() { this.map?.zoomOut(); }
  resize() { this.map?.resize(); }

  /** colors: {code: "#hex"}; missing codes use the neutral colour. opacity shows how strongly to paint. */
  async setFill(colors, opacity = 0.78) {
    await this.ready;
    const expr = ["match", ["get", "code"]];
    const entries = Object.entries(colors || {});
    if (!entries.length) {
      this.map.setPaintProperty("muni-fill", "fill-color", NEUTRAL_COLOR);
      this.map.setPaintProperty("muni-fill", "fill-opacity", 0.45);
      return;
    }
    for (const [code, color] of entries) expr.push(code, color);
    expr.push(NEUTRAL_COLOR);
    this.map.setPaintProperty("muni-fill", "fill-color", expr);
    this.map.setPaintProperty("muni-fill", "fill-opacity", opacity);
  }

  async setBoundariesVisible(on) {
    await this.ready;
    this.map.setLayoutProperty("muni-line", "visibility", on ? "visible" : "none");
    this.markers.forEach((m) => (m.getElement().style.display = on ? "" : "none"));
  }

  async setFocus(code) {
    await this.ready;
    this.map.setFilter("muni-focus", ["==", ["get", "code"], code || ""]);
  }

  /** Draw (or clear with fc=null) a GeoJSON overlay for a map layer id. */
  async setOverlay(layerId, fc, color = "#38bdf8") {
    await this.ready;
    const srcId = `ov-${layerId}`;
    for (const suffix of ["fill", "line", "circle"]) {
      if (this.map.getLayer(`${srcId}-${suffix}`)) this.map.removeLayer(`${srcId}-${suffix}`);
    }
    if (this.map.getSource(srcId)) this.map.removeSource(srcId);
    this.overlays.delete(layerId);
    if (!fc || !fc.features?.length) return 0;
    this.map.addSource(srcId, { type: "geojson", data: fc });
    this.map.addLayer({ id: `${srcId}-fill`, type: "fill", source: srcId, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": 0.3 } });
    this.map.addLayer({ id: `${srcId}-line`, type: "line", source: srcId, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": color, "line-width": 1.4 } });
    this.map.addLayer({ id: `${srcId}-circle`, type: "circle", source: srcId, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": color, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
    this.overlays.add(layerId);
    return fc.features.length;
  }

  async setScope(code) {
    await this.ready;
    const feat = code && code !== "dalarna" ? this.geo.features.find((f) => f.properties.code === code) : null;
    if (feat) this.map.flyTo({ center: feat.properties.centroid, zoom: 8.6 });
    else this.map.fitBounds(DALARNA_BOUNDS, { padding: 25 });
    this.setFocus(feat ? code : "");
  }

  async popup(lngLat, html) {
    await this.ready;
    if (this._popup) this._popup.remove();
    this._popup = new this.gl.Popup({ closeButton: true, maxWidth: "260px", className: "muni-popup" }).setLngLat(lngLat).setHTML(html).addTo(this.map);
    return this._popup.getElement();
  }
}
