"""Telemetry & Simulation endpoints for real-time monitoring and what-if scenarios.

Serves live SMHI air temperature, Trafikverket road weather, and real-time frost risk prediction
matching both the student cockpit (root index.html) and modular dashboard requirements.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from connectors import smhi, trafikverket
from connectors.common import ConnectorError, ConnectorSkipped

logger = logging.getLogger("app.telemetry")

router = APIRouter(prefix="/api", tags=["telemetry"])

AIR_STATION_ID = "urn:ngsi-ld:WeatherObserved:Dalarna:SMHI:105260"
AIR_LON, AIR_LAT = 15.5133, 60.4219

ROAD_STATION_ID = "urn:ngsi-ld:RoadWeatherObserved:Dalarna:Trafikverket:E16"
ROAD_LON, ROAD_LAT = 15.3850, 60.5050


def calculate_frost_risk(t_air: float, t_road: float, cooling_rate_per_hour: float = 0.0) -> dict:
    """Decision engine for road frost / black-ice risk assessment."""
    predicted_road_temp_1h = round(t_road + cooling_rate_per_hour, 2)

    # 1. Verglas noir / Verglas par rayonnement : Sol negatif avec air positif
    if t_road <= 0.0 and t_air > 0.0:
        status = "DANGER_BLACK_ICE"
        label = "🔴 DANGER CRITIQUE : Verglas par rayonnement (Sol gelé / Air > 0)"
        color = "#dc2626"
        action = "Déclenchement immédiat du salage prioritaire d'urgence."

    # 2. Gel généralisé : Sol et air négatifs
    elif t_road <= 0.0 and t_air <= 0.0:
        status = "GENERAL_FREEZING"
        label = "🟣 ALERTE : Gel généralisé de la chaussée"
        color = "#9333ea"
        action = "Salage préventif et réduction de la vitesse recommandée."

    # 3. Risque imminent : Chaussée proche de 0°C ET refroidissement effectif vers le gel
    elif (t_road <= 1.5 and cooling_rate_per_hour < -0.5) or (0.0 < t_road <= 3.0 and predicted_road_temp_1h <= 0.0):
        status = "WARNING_IMMINENT_FROST"
        label = f"🟡 VIGILANCE : Risque de gel imminent (Prévu à 1h: {predicted_road_temp_1h}°C)"
        color = "#d97706"
        action = "Pré-mobilisation des équipes techniques de Dalarna."

    # 4. Conditions normales / Saison estivale
    else:
        status = "NORMAL"
        label = "🟢 SÉCURISÉ : Aucun risque de gel détecté"
        color = "#16a34a"
        action = "Conditions normales. Aucune intervention requise."

    return {
        "status": status,
        "label": label,
        "color": color,
        "action": action,
        "current_air_temp": round(t_air, 1),
        "current_road_temp": round(t_road, 1),
        "predicted_road_temp_1h": predicted_road_temp_1h,
        "cooling_rate_per_hour": round(cooling_rate_per_hour, 2),
    }


def _get_live_air_temp() -> tuple[float, Optional[datetime], str]:
    """Fetch live air temperature from real SMHI Open Data API."""
    try:
        obs = smhi.fetch_observation()
        return obs.temperature, obs.observed_at, "live"
    except Exception as exc:
        logger.warning("SMHI live fetch failed: %s; using fallback temperature", exc)
        return 10.7, datetime.now(timezone.utc), "fallback"


def _get_live_road_temp(air_temp: float) -> tuple[float, str, bool, Optional[str]]:
    """Fetch live road temperature from Trafikverket if configured, else thermodynamic model."""
    try:
        records = trafikverket.fetch_records()
        if records:
            first = records[0]
            road_temp = first.attributes.get("road_surface_temperature_c")
            if road_temp is not None:
                road_ice = bool(first.attributes.get("road_ice", False))
                precip = first.attributes.get("precipitation")
                return float(road_temp), "live", road_ice, precip
    except (ConnectorSkipped, ConnectorError) as exc:
        logger.debug("Trafikverket not live (%s); using thermodynamic road model", exc)
    except Exception as exc:
        logger.warning("Trafikverket unexpected error: %s", exc)

    # Road surface thermodynamic model: typically ~1.2 C below air temperature in shaded / clear conditions
    road_temp = round(air_temp - 1.2, 1)
    return road_temp, "modeled", (road_temp <= 0.0), None


class WhatIfRequest(BaseModel):
    simulated_road_temp: float = 0.0
    simulated_air_temp: float = 19.5


# --- 1. Air Weather Station (SMHI) ---
@router.get("/station")
@router.get("/station-air")
@router.get("/air-weather")
def get_station_air():
    temp, observed_at, origin = _get_live_air_temp()
    return {
        "id": AIR_STATION_ID,
        "type": "WeatherObserved",
        "station_name": "SMHI Borlänge Flygplats",
        "temperature": {"value": temp, "unitCode": "CEL"},
        "location": {"type": "Point", "coordinates": [AIR_LON, AIR_LAT]},
        "observed_at": observed_at.isoformat() if observed_at else None,
        "data_origin": origin,
        "source": "SMHI",
    }


# --- 2. Road Weather Station (Trafikverket / Model) ---
@router.get("/road-weather")
@router.get("/road-station")
@router.get("/station-road")
@router.get("/road")
def get_station_road():
    air_temp, _, _ = _get_live_air_temp()
    road_temp, origin, road_ice, precip = _get_live_road_temp(air_temp)
    return {
        "id": ROAD_STATION_ID,
        "type": "RoadWeatherObserved",
        "station_name": "Trafikverket E16 Mellsta",
        "temperature": {"value": road_temp, "unitCode": "CEL"},
        "road_surface_temperature_c": road_temp,
        "air_temperature_c": air_temp,
        "road_ice": road_ice,
        "precipitation": precip,
        "location": {"type": "Point", "coordinates": [ROAD_LON, ROAD_LAT]},
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "data_origin": origin,
        "source": "Trafikverket",
    }


# --- 3. Real-time Frost Risk Prediction ---
@router.get("/simulation/predict")
def get_simulation_predict():
    air_temp, _, _ = _get_live_air_temp()
    road_temp, _, _, _ = _get_live_road_temp(air_temp)
    cooling_rate = -0.3 if road_temp <= 2.0 else 0.0
    return calculate_frost_risk(air_temp, road_temp, cooling_rate)


# --- 4. What-If Simulation Scenario ---
@router.post("/simulation/what-if")
def post_simulation_what_if(req: WhatIfRequest):
    sim_cooling = -1.5 if req.simulated_road_temp <= 2.0 else -0.1
    return calculate_frost_risk(req.simulated_air_temp, req.simulated_road_temp, sim_cooling)
