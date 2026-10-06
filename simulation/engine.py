"""Pure Python cross-sector causal simulation engine for Dalarna Regional Digital Twin.

Never touches storage or network. Deterministic, unit-testable, dependency-based.
Formula: future = current * (1 + population_change)
Propagation: Population -> Traffic demand -> Infrastructure pressure
                         -> Land development -> Forest reduction
                         -> Water exposure
SMHI Weather remains an external condition (unaffected by population growth).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

MODEL_PATH = Path(__file__).resolve().parent.parent / "config" / "simulation_model.json"


def load_model_config() -> dict[str, Any]:
    if MODEL_PATH.exists():
        try:
            return json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "model_version": "1.2.0",
        "default_thresholds": {"low": 0.30, "medium": 0.60, "high": 0.80, "critical": 1.00},
    }


def classify_risk(score: float, thresholds: Optional[dict[str, float]] = None) -> str:
    """Classify 0..1 score according to configurable thresholds."""
    th = thresholds or {"low": 0.30, "medium": 0.60, "high": 0.80, "critical": 1.00}
    t_low = float(th.get("low", 0.30))
    t_med = float(th.get("medium", 0.60))
    t_high = float(th.get("high", 0.80))

    if score < t_low:
        return "Low"
    elif score < t_med:
        return "Medium"
    elif score < t_high:
        return "High"
    else:
        return "Critical"


def run_simulation(
    scenario: str = "population_growth",
    target_year: int = 2030,
    scope: str = "dalarna",
    driver: Optional[dict[str, Any]] = None,
    excluded_sources: Optional[list[str]] = None,
    thresholds: Optional[dict[str, float]] = None,
    is_test: bool = False,
) -> dict[str, Any]:
    """Execute dependency-based simulation scenario across Dalarna and its 15 municipalities."""
    cfg = load_model_config()
    model_version = cfg.get("model_version", "1.2.0")
    excluded = set(excluded_sources or [])
    th = thresholds or cfg.get("default_thresholds", {"low": 0.30, "medium": 0.60, "high": 0.80, "critical": 1.00})

    driver_data = driver or {"population_change": 0.10}
    pop_change = float(driver_data.get("population_change", 0.10))

    dep_cfg = cfg.get("dependencies", {}).get(scenario, {})
    coeffs = dep_cfg.get("coefficients", {
        "traffic_demand": 1.2,
        "infrastructure_pressure": 0.85,
        "land_development": 1.0,
        "forest_reduction": -0.20,
        "water_exposure": 0.60,
        "weather_effect": 0.0,
    })

    # 1. Cross-Source Multipliers
    traffic_pct = pop_change * coeffs.get("traffic_demand", 1.2) if "trafikverket" not in excluded else 0.0
    land_pct = pop_change * coeffs.get("land_development", 1.0) if "lantmateriet" not in excluded else 0.0
    forest_pct = pop_change * coeffs.get("forest_reduction", -0.20) if "skogsstyrelsen" not in excluded else 0.0
    water_pct = pop_change * coeffs.get("water_exposure", 0.60) if "sgu" not in excluded else 0.0
    weather_delta = 0.0  # SMHI stays unchanged as external condition

    # 2. Municipalities Calculation
    mun_baselines = cfg.get("municipalities_baseline", {})
    mun_results = []
    total_current_pop = 0
    total_sim_pop = 0

    for code, m in mun_baselines.items():
        base_pop = int(m.get("base_pop", 10000))
        sim_pop = int(round(base_pop * (1.0 + pop_change)))
        total_current_pop += base_pop
        total_sim_pop += sim_pop

        # Specific category risk scores (0..1)
        base_infra = float(m.get("base_infra_risk", 0.50))
        infra_score = min(1.0, max(0.0, base_infra + (traffic_pct * 0.85)))
        
        base_food = float(m.get("base_food_risk", 0.40))
        food_score = min(1.0, max(0.0, base_food + (pop_change * 0.30)))

        base_flood = float(m.get("base_flood_risk", 0.45))
        flood_score = min(1.0, max(0.0, base_flood + (water_pct * 0.20)))

        base_env = float(m.get("base_env_risk", 0.35))
        env_score = min(1.0, max(0.0, base_env + abs(forest_pct) * 0.40))

        # Overall risk: weighted combination
        overall_score = round(0.30 * infra_score + 0.25 * food_score + 0.25 * flood_score + 0.20 * env_score, 3)

        mun_results.append({
            "code": code,
            "name": m.get("name"),
            "current_population": base_pop,
            "simulated_population": sim_pop,
            "population_change_pct": round(pop_change * 100, 1),
            "food_risk": {"score": round(food_score, 2), "level": classify_risk(food_score, th)},
            "snow_flood_risk": {"score": round(flood_score, 2), "level": classify_risk(flood_score, th)},
            "infrastructure_risk": {"score": round(infra_score, 2), "level": classify_risk(infra_score, th)},
            "environment_risk": {"score": round(env_score, 2), "level": classify_risk(env_score, th)},
            "overall_risk": {"score": overall_score, "level": classify_risk(overall_score, th)},
        })

    # Sort so top municipalities Borlänge, Falun, Mora appear first
    priority_order = ["2081", "2080", "2062", "2085", "2084"]
    mun_results.sort(key=lambda x: priority_order.index(x["code"]) if x["code"] in priority_order else 99)

    # 3. Regional Totals & Cross-Sector Impacts
    pop_pct_str = f"+{int(round(pop_change * 100))}%" if pop_change >= 0 else f"{int(round(pop_change * 100))}%"
    traffic_pct_str = f"+{int(round(traffic_pct * 100))}%" if traffic_pct >= 0 else f"{int(round(traffic_pct * 100))}%"
    land_pct_str = f"+{int(round(land_pct * 100))}%" if land_pct >= 0 else f"{int(round(land_pct * 100))}%"
    forest_pct_str = f"{int(round(forest_pct * 100))}%"
    water_pct_str = f"+{int(round(water_pct * 100))}%" if water_pct >= 0 else f"{int(round(water_pct * 100))}%"

    impact_by_source = [
        {
            "id": "scb",
            "name": "Population (SCB)",
            "role": "Driver",
            "current": "288,000",
            "simulated": f"{total_sim_pop:,}",
            "change": pop_pct_str,
            "impact": "Driver",
            "status": "included" if "scb" not in excluded else "excluded",
        },
        {
            "id": "trafikverket",
            "name": "Traffic (Trafikverket)",
            "role": "Infrastructure Demand",
            "current": "100 (index)",
            "simulated": f"{int(round(100 * (1 + traffic_pct)))}",
            "change": traffic_pct_str,
            "impact": "High" if traffic_pct >= 0.10 else "Medium",
            "status": "included" if "trafikverket" not in excluded else "excluded",
        },
        {
            "id": "lantmateriet",
            "name": "Land parcels (Lantmäteriet)",
            "role": "Development Pressure",
            "current": "12,450",
            "simulated": f"{int(round(12450 * (1 + land_pct))):,}",
            "change": land_pct_str,
            "impact": "High" if land_pct >= 0.10 else "Medium",
            "status": "included" if "lantmateriet" not in excluded else "excluded",
        },
        {
            "id": "skogsstyrelsen",
            "name": "Forest area (Skogsstyrelsen)",
            "role": "Environmental Balance",
            "current": "450,000 ha",
            "simulated": f"{int(round(450000 * (1 + forest_pct))):,} ha",
            "change": forest_pct_str,
            "impact": "Medium",
            "status": "included" if "skogsstyrelsen" not in excluded else "excluded",
        },
        {
            "id": "sgu",
            "name": "Water exposure (SGU)",
            "role": "Hydrogeological Exposure",
            "current": "293",
            "simulated": f"{int(round(293 * (1 + water_pct)))}",
            "change": water_pct_str,
            "impact": "Medium",
            "status": "included" if "sgu" not in excluded else "excluded",
        },
        {
            "id": "smhi",
            "name": "Weather (SMHI)",
            "role": "External Condition",
            "current": "7.1 °C",
            "simulated": "7.1 °C",
            "change": "+0.0 °C",
            "impact": "External",
            "status": "external",
        },
    ]

    # Overall regional score average
    avg_overall_score = round(sum(m["overall_risk"]["score"] for m in mun_results) / len(mun_results), 3)
    regional_risk_level = classify_risk(avg_overall_score, th)

    run_id = f"sim-{uuid.uuid4().hex[:8]}"

    key_takeaway = (
        f"A {int(round(pop_change * 100))}% population increase is expected to increase traffic demand "
        "and land development pressure, with higher infrastructure risk and moderate environmental impacts."
    )

    return {
        "run_id": run_id,
        "is_test": is_test,
        "simulated": True,
        "scenario": scenario,
        "target_year": target_year,
        "scope": scope,
        "model_version": model_version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "population_current": total_current_pop,
            "population_simulated": total_sim_pop,
            "population_change_pct": round(pop_change * 100, 1),
            "regional_risk": {
                "score": avg_overall_score,
                "level": regional_risk_level,
            },
            "category_risks": {
                "food_risk": "Medium",
                "snow_flood_risk": "Medium",
                "infrastructure_risk": "High" if pop_change >= 0.08 else "Medium",
                "environment_risk": "Medium",
            },
            "key_takeaway": key_takeaway,
        },
        "impact_by_source": impact_by_source,
        "municipalities": mun_results,
        "assumptions": {
            "formula": "future = current * (1 + rate)",
            "driver": driver_data,
            "coefficients": coeffs,
            "thresholds": th,
            "note": "SMHI treated as external boundary condition. Zero database overwriting.",
        },
    }
