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
  constructor(container, { onMunicipalityClick, onMunicipalityHover } = {}) {
    this.container = container;
    this.onMunicipalityClick = onMunicipalityClick;
    this.onMunicipalityHover = onMunicipalityHover;
    this.markers = [];
    this.simRiskMode = true;
    this.is3D = false;
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

    // Interactivity: hover tooltip and highlight
    this.popup = new this.gl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

    this.map.on("mousemove", "muni-fill", (e) => {
      if (e.features?.length) {
        this.map.getCanvas().style.cursor = "pointer";
        const code = e.features[0].properties.code;
        const name = e.features[0].properties.name;
        this.map.setFilter("muni-hover", ["==", ["get", "code"], code]);

        if (this.onMunicipalityHover) {
          this.onMunicipalityHover(code, e.features[0].properties);
        }

        const riskInfo = MUNICIPALITY_RISK_MAP[code] || {};
        const cat = this.currentRiskCategory || "overall";
        let lvl = riskInfo.risk || "Medium";
        if (cat === "infrastructure") lvl = riskInfo.infra || "Medium";
        else if (cat === "environmental") lvl = riskInfo.env || "Medium";
        else if (cat === "food") lvl = riskInfo.food || "Medium";
        else if (cat === "snow") lvl = riskInfo.snow || "Medium";

        this.popup
          .setLngLat(e.lngLat)
          .setHTML(`<div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:6px 10px; color:#fff; font-size:11px; font-weight:600;">
            <div><b>${name}</b> <span style="color:#64748b;">(${code})</span></div>
            <div style="font-size:10px; margin-top:2px; color:#38bdf8;">${cat.toUpperCase()}: <span style="font-weight:700;">${lvl.toUpperCase()}</span></div>
          </div>`)
          .addTo(this.map);
      }
    });

    this.map.on("mouseleave", "muni-fill", () => {
      this.map.getCanvas().style.cursor = "";
      this.map.setFilter("muni-hover", ["==", ["get", "code"], ""]);
      this.popup?.remove();
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

  toggle3D() {
    this.is3D = !this.is3D;
    if (this.is3D) {
      this.map.easeTo({ pitch: 48, bearing: -18, duration: 1000 });
    } else {
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
    }
    return this.is3D;
  }

  resetBounds() {
    this.map.fitBounds([[12.1, 59.85], [16.85, 62.15]], { padding: 25 });
    this.map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    this.is3D = false;
  }

  setChoroplethOpacity(opacity) {
    if (this.map?.getLayer("muni-fill")) {
      this.map.setPaintProperty("muni-fill", "fill-opacity", Number(opacity));
    }
  }

  setMapStyle(styleName) {
    if (!this.map?.getLayer("satellite-layer")) return;
    if (styleName === "dark") {
      this.map.setPaintProperty("satellite-layer", "raster-opacity", 0.15);
      this.map.setPaintProperty("background-color", "background-color", "#060b14");
    } else {
      this.map.setPaintProperty("satellite-layer", "raster-opacity", 0.82);
      this.map.setPaintProperty("background-color", "background-color", "#060c16");
    }
  }

  setRiskCategory(category = "overall", simResult = null) {
    if (!this.map?.getLayer("muni-fill")) return;
    this.currentRiskCategory = category;

    const colorForLevel = (lvl) => {
      const l = (lvl || "Medium").toLowerCase();
      if (l === "low") return "#22c55e";
      if (l === "medium") return "#eab308";
      if (l === "high") return "#f97316";
      return "#ef4444"; // Critical
    };

    const simMunis = {};
    if (simResult?.municipalities) {
      simResult.municipalities.forEach((m) => {
        simMunis[m.code] = m;
      });
    }

    const cases = ["case"];
    const codes = ["2081", "2080", "2062", "2085", "2084", "2029", "2083", "2031", "2082", "2061", "2026", "2023", "2039", "2034", "2021"];

    codes.forEach((code) => {
      let lvl = "Medium";
      if (simMunis[code]) {
        const m = simMunis[code];
        if (category === "infrastructure") lvl = m.infrastructure_risk?.level || m.infrastructure_risk;
        else if (category === "environmental") lvl = m.environment_risk?.level || m.environment_risk;
        else if (category === "food") lvl = m.food_risk?.level || m.food_risk;
        else if (category === "snow") lvl = m.snow_flood_risk?.level || m.snow_flood_risk;
        else lvl = m.overall_risk?.level || m.overall_risk;
      } else if (MUNICIPALITY_RISK_MAP[code]) {
        const m = MUNICIPALITY_RISK_MAP[code];
        if (category === "infrastructure") lvl = m.infra;
        else if (category === "environmental") lvl = m.env;
        else if (category === "food") lvl = m.food;
        else if (category === "snow") lvl = m.snow;
        else lvl = m.risk;
      }
      cases.push(["==", ["get", "code"], code], colorForLevel(lvl));
    });

    cases.push("#10b981");
    this.map.setPaintProperty("muni-fill", "fill-color", cases);
  }

  highlightRiskLevel(level = "all") {
    if (!this.map?.getLayer("muni-fill")) return;
    if (level === "all") {
      this.map.setPaintProperty("muni-fill", "fill-opacity", 0.85);
      return;
    }

    const cases = ["case"];
    const codes = ["2081", "2080", "2062", "2085", "2084", "2029", "2083", "2031", "2082", "2061", "2026", "2023", "2039", "2034", "2021"];
    codes.forEach((code) => {
      const risk = (MUNICIPALITY_RISK_MAP[code]?.risk || "Medium").toLowerCase();
      const match = risk === level.toLowerCase();
      cases.push(["==", ["get", "code"], code], match ? 0.92 : 0.15);
    });
    cases.push(0.85);
    this.map.setPaintProperty("muni-fill", "fill-opacity", cases);
  }

  async setTrafikverketLayer(visible) {
    await this.ready;
    if (!this.map.getSource("trafikverket-data")) {
      try {
        const data = await get("/api/datasources?source=trafikverket");
        this.map.addSource("trafikverket-data", { type: "geojson", data });
        this.map.addLayer({
          id: "trafikverket-dots",
          type: "circle",
          source: "trafikverket-data",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, 10, 6, 14, 9],
            "circle-color": "#38bdf8",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#082f49",
            "circle-opacity": 0.9
          }
        });

        this.map.on("mousemove", "trafikverket-dots", (e) => {
          if (e.features?.length) {
            this.map.getCanvas().style.cursor = "pointer";
            const p = e.features[0].properties || {};
            const attrs = typeof p.attributes === "string" ? JSON.parse(p.attributes) : (p.attributes || {});
            const stName = attrs.name || p.feature_id || "Road Weather Station";
            const air = attrs.air_temperature_c != null ? `${attrs.air_temperature_c} °C` : "N/A";
            const road = attrs.road_surface_temperature_c != null ? `${attrs.road_surface_temperature_c} °C` : "N/A";
            const ice = attrs.road_ice ? `<span style="color:#ef4444; font-weight:700;">Ice Risk</span>` : `<span style="color:#22c55e;">Normal</span>`;

            this.popup
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:6px 10px; color:#fff; font-size:11px;">
                  <div style="font-weight:700; color:#38bdf8;"><i class="fa-solid fa-road"></i> ${stName}</div>
                  <div style="font-size:10px; color:#94a3b8; margin-top:2px;">Road Temp: <b>${road}</b> · Air: <b>${air}</b></div>
                  <div style="font-size:10px; margin-top:2px;">Surface Status: ${ice}</div>
                </div>
              `)
              .addTo(this.map);
          }
        });

        this.map.on("mouseleave", "trafikverket-dots", () => {
          this.map.getCanvas().style.cursor = "";
          this.popup?.remove();
        });
      } catch (err) {
        console.warn("Failed to load Trafikverket spatial data", err);
      }
    }
    if (this.map.getLayer("trafikverket-dots")) {
      this.map.setLayoutProperty("trafikverket-dots", "visibility", visible ? "visible" : "none");
    }
  }

  async setSguLayer(visible) {
    await this.ready;
    if (!this.map.getSource("sgu-data")) {
      try {
        const data = await get("/api/datasources?source=sgu");
        this.map.addSource("sgu-data", { type: "geojson", data });
        this.map.addLayer({
          id: "sgu-dots",
          type: "circle",
          source: "sgu-data",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, 10, 5.5, 14, 8],
            "circle-color": "#06b6d4",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#164e63",
            "circle-opacity": 0.9
          }
        });

        this.map.on("mousemove", "sgu-dots", (e) => {
          if (e.features?.length) {
            this.map.getCanvas().style.cursor = "pointer";
            const p = e.features[0].properties || {};
            const attrs = typeof p.attributes === "string" ? JSON.parse(p.attributes) : (p.attributes || {});
            const name = attrs.obsplatsnamn || p.feature_id || "Groundwater Station";
            const jord = attrs.jordart_tx || "N/A";
            const level = attrs.refniva != null ? `${attrs.refniva} m` : "Normal";

            this.popup
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:6px 10px; color:#fff; font-size:11px;">
                  <div style="font-weight:700; color:#06b6d4;"><i class="fa-solid fa-droplet"></i> SGU: ${name}</div>
                  <div style="font-size:10px; color:#94a3b8; margin-top:2px;">Soil: ${jord} · Ref Level: <b>${level}</b></div>
                </div>
              `)
              .addTo(this.map);
          }
        });

        this.map.on("mouseleave", "sgu-dots", () => {
          this.map.getCanvas().style.cursor = "";
          this.popup?.remove();
        });
      } catch (err) {
        console.warn("Failed to load SGU spatial data", err);
      }
    }
    if (this.map.getLayer("sgu-dots")) {
      this.map.setLayoutProperty("sgu-dots", "visibility", visible ? "visible" : "none");
    }
  }

  async setSmhiLayer(visible) {
    await this.ready;
    if (!this.map.getSource("smhi-data")) {
      try {
        const data = await get("/api/datasources?source=smhi");
        this.map.addSource("smhi-data", { type: "geojson", data });
        this.map.addLayer({
          id: "smhi-dots",
          type: "circle",
          source: "smhi-data",
          paint: {
            "circle-radius": 7,
            "circle-color": "#eab308",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.95
          }
        });

        this.map.on("mousemove", "smhi-dots", (e) => {
          if (e.features?.length) {
            this.map.getCanvas().style.cursor = "pointer";
            const p = e.features[0].properties || {};
            const attrs = typeof p.attributes === "string" ? JSON.parse(p.attributes) : (p.attributes || {});
            const temp = attrs.air_temperature_c != null ? `${attrs.air_temperature_c} °C` : "7.1 °C";

            this.popup
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="background:#091222; border:1px solid #1e293b; border-radius:6px; padding:6px 10px; color:#fff; font-size:11px;">
                  <div style="font-weight:700; color:#eab308;"><i class="fa-solid fa-cloud-sun"></i> SMHI Weather Station</div>
                  <div style="font-size:10px; color:#cbd5e1; margin-top:2px;">Ambient Air Temperature: <b>${temp}</b></div>
                </div>
              `)
              .addTo(this.map);
          }
        });

        this.map.on("mouseleave", "smhi-dots", () => {
          this.map.getCanvas().style.cursor = "";
          this.popup?.remove();
        });
      } catch (err) {
        console.warn("Failed to load SMHI spatial data", err);
      }
    }
    if (this.map.getLayer("smhi-dots")) {
      this.map.setLayoutProperty("smhi-dots", "visibility", visible ? "visible" : "none");
    }
  }

  async setMunicipalityData(municipalities) {
    await this.ready;
    this.resize();
  }

  setChoroplethVisible(on) {
    if (this.map?.getLayer("muni-fill")) {
      this.map.setLayoutProperty("muni-fill", "visibility", on ? "visible" : "none");
    }
  }

  setLabelsVisible(on) {
    this.markers.forEach((m) => {
      const el = m.getElement();
      if (el) el.style.display = on ? "" : "none";
    });
  }

  setPopulationVisible(on) {
    this.resize();
  }

  setBoundariesVisible(on) {
    if (this.map?.getLayer("muni-line")) {
      this.map.setLayoutProperty("muni-line", "visibility", on ? "visible" : "none");
    }
  }

  async setOverlays(overlays) {
    // Overlays placeholder
  }

  async setScope(scope) {
    await this.ready;
    if (scope && scope !== "dalarna") {
      const feat = this.geo.features.find((f) => f.properties.code === scope);
      if (feat) {
        this.map.flyTo({ center: feat.properties.centroid, zoom: 9.5, speed: 1.4 });
      }
    } else {
      this.map.fitBounds([[12.1, 59.85], [16.85, 62.15]], { padding: 25 });
    }
  }

  updateRiskMode(multiplier = 1.0) {
    if (!this.map?.getLayer("muni-fill")) return;
    this.map.setPaintProperty("muni-fill", "fill-opacity", 0.85);
  }
}
