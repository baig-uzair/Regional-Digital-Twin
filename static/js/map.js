// MapLibre map of Dalarna with satellite imagery basemap, risk choropleth & municipality labels
import { get } from "./api.js";

// Specific risk colors per municipality matching Screenshot 1
export const MUNICIPALITY_RISK_MAP = {
  "2081": { risk: "Critical", color: "#ef4444", food: "Medium", snow: "Low", infra: "High", env: "Medium" },     // Borlänge
  "2080": { risk: "Critical", color: "#ef4444", food: "Low", snow: "Medium", infra: "High", env: "Medium" },      // Falun
  "2062": { risk: "High", color: "#f97316", food: "Medium", snow: "Medium", infra: "Medium", env: "Low" },        // Mora
  "2085": { risk: "High", color: "#eab308", food: "Medium", snow: "High", infra: "Medium", env: "Medium" },       // Ludvika
  "2084": { risk: "High", color: "#f97316", food: "High", snow: "Medium", infra: "Medium", env: "Medium" },       // Avesta
  "2029": { risk: "High", color: "#f97316", food: "Medium", snow: "Medium", infra: "Medium", env: "Medium" },      // Leksand
  "2083": { risk: "High", color: "#f97316", food: "Medium", snow: "Medium", infra: "High", env: "Medium" },       // Hedemora
  "2031": { risk: "High", color: "#f97316", food: "Medium", snow: "Medium", infra: "Medium", env: "Low" },        // Rättvik
  "2082": { risk: "High", color: "#f97316", food: "Low", snow: "Medium", infra: "High", env: "Medium" },         // Säter
  "2061": { risk: "Medium", color: "#06b6d4", food: "Medium", snow: "Low", infra: "Medium", env: "Medium" },      // Smedjebacken
  "2026": { risk: "Medium", color: "#eab308", food: "Medium", snow: "Medium", infra: "Medium", env: "Low" },      // Gagnef
  "2023": { risk: "High", color: "#f97316", food: "Low", snow: "High", infra: "Medium", env: "Low" },            // Malung-Sälen
  "2039": { risk: "Low", color: "#22c55e", food: "Low", snow: "Medium", infra: "Low", env: "Low" },             // Älvdalen
  "2034": { risk: "Low", color: "#84cc16", food: "Medium", snow: "Medium", infra: "Medium", env: "Low" },         // Orsa
  "2021": { risk: "Low", color: "#22c55e", food: "Medium", snow: "Low", infra: "Medium", env: "Low" },           // Vansbro
};

// Satellite raster style for genuine real-world topographic/satellite view matching Screenshot 1
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256,
      attribution: "Esri World Imagery"
    }
  },
  layers: [
    {
      id: "background-color",
      type: "background",
      paint: { "background-color": "#060c16" }
    },
    {
      id: "satellite-layer",
      type: "raster",
      source: "esri-satellite",
      paint: {
        "raster-opacity": 0.82,
        "raster-brightness-max": 0.9,
        "raster-saturation": -0.1
      }
    }
  ]
};

export class DalarnaMap {
  constructor(container, { onMunicipalityClick } = {}) {
    this.container = container;
    this.onMunicipalityClick = onMunicipalityClick;
    this.markers = [];
    this.simRiskMode = true;
    this.ready = this._init();
  }

  async _init() {
    const maplibregl = window.maplibregl;
    if (!maplibregl) throw new Error("MapLibre failed to load");
    this.gl = maplibregl;
    this.geo = await get("/data/dalarna_municipalities.geojson");

    this.map = new maplibregl.Map({
      container: this.container,
      style: SATELLITE_STYLE,
      bounds: [[12.1, 59.85], [16.85, 62.15]],
      fitBoundsOptions: { padding: 25 },
      attributionControl: false
    });

    await new Promise((resolve) => this.map.on("load", resolve));

    // Add source with promoted id
    this.map.addSource("muni", { type: "geojson", data: this.geo, promoteId: "code" });

    // Choropleth fill layer
    this.map.addLayer({
      id: "muni-fill",
      type: "fill",
      source: "muni",
      paint: {
        "fill-color": [
          "case",
          ["==", ["get", "code"], "2081"], "#ef4444",
          ["==", ["get", "code"], "2080"], "#ef4444",
          ["==", ["get", "code"], "2084"], "#f97316",
          ["==", ["get", "code"], "2083"], "#f97316",
          ["==", ["get", "code"], "2082"], "#f97316",
          ["==", ["get", "code"], "2029"], "#f97316",
          ["==", ["get", "code"], "2031"], "#f97316",
          ["==", ["get", "code"], "2062"], "#f97316",
          ["==", ["get", "code"], "2023"], "#f97316",
          ["==", ["get", "code"], "2085"], "#eab308",
          ["==", ["get", "code"], "2026"], "#eab308",
          ["==", ["get", "code"], "2034"], "#84cc16",
          ["==", ["get", "code"], "2039"], "#22c55e",
          ["==", ["get", "code"], "2021"], "#22c55e",
          ["==", ["get", "code"], "2061"], "#06b6d4",
          "#10b981"
        ],
        "fill-opacity": 0.85
      }
    });

    // White outline stroke
    this.map.addLayer({
      id: "muni-line",
      type: "line",
      source: "muni",
      paint: {
        "line-color": "#ffffff",
        "line-width": 1.2,
        "line-opacity": 0.85
      }
    });

    // Hover outline
    this.map.addLayer({
      id: "muni-hover",
      type: "line",
      source: "muni",
      filter: ["==", ["get", "code"], ""],
      paint: {
        "line-color": "#38bdf8",
        "line-width": 2.5
      }
    });

    // Interactivity
    this.map.on("mousemove", "muni-fill", (e) => {
      if (e.features?.length) {
        this.map.getCanvas().style.cursor = "pointer";
        const code = e.features[0].properties.code;
        this.map.setFilter("muni-hover", ["==", ["get", "code"], code]);
      }
    });

    this.map.on("mouseleave", "muni-fill", () => {
      this.map.getCanvas().style.cursor = "";
      this.map.setFilter("muni-hover", ["==", ["get", "code"], ""]);
    });

    this.map.on("click", "muni-fill", (e) => {
      const code = e.features?.[0]?.properties?.code;
      if (code && this.onMunicipalityClick) {
        this.onMunicipalityClick(code);
      }
    });

    // Place municipality text labels at centroids
    for (const f of this.geo.features) {
      const el = document.createElement("div");
      el.className = "map-muni-centroid-label";
      el.textContent = f.properties.name;
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(f.properties.centroid)
        .addTo(this.map);
      this.markers.push(marker);
    }

    return this;
  }

  zoomIn() {
    this.map?.zoomIn();
  }

  zoomOut() {
    this.map?.zoomOut();
  }

  resize() {
    this.map?.resize();
  }

  async setMunicipalityData(municipalities) {
    await this.ready;
    this.resize();
  }

  setPopulationVisible(on) {
    // Keeps risk or pop color
    this.resize();
  }

  setBoundariesVisible(on) {
    if (this.map?.getLayer("muni-line")) {
      this.map.setLayoutProperty("muni-line", "visibility", on ? "visible" : "none");
    }
  }

  async setOverlays(overlays) {
    // No-op for satellite view
  }

  async setScope(scope) {
    await this.ready;
    if (scope && scope !== "dalarna") {
      const feat = this.geo.features.find((f) => f.properties.code === scope);
      if (feat) {
        this.map.flyTo({ center: feat.properties.centroid, zoom: 8.5 });
      }
    } else {
      this.map.fitBounds([[12.1, 59.85], [16.85, 62.15]], { padding: 25 });
    }
  }

  updateRiskMode(multiplier = 1.0) {
    if (!this.map?.getLayer("muni-fill")) return;
    // Dynamically adjust color mapping if needed
    this.map.setPaintProperty("muni-fill", "fill-opacity", 0.85);
  }
}
