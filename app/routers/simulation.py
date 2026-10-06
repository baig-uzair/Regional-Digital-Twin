"""Simulation routes: Scenarios, execution, test runs, and result retrieval."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import auth
from simulation.engine import run_simulation

logger = logging.getLogger("app.simulation")

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

_RESULTS_CACHE: dict[str, dict[str, Any]] = {}
_LATEST_OFFICIAL: Optional[dict[str, Any]] = None


class RunSimulationRequest(BaseModel):
    scenario: str = Field(default="population_growth")
    target_year: int = Field(default=2030, ge=2020, le=2100)
    scope: str = Field(default="dalarna")
    driver: Optional[dict[str, Any]] = Field(default_factory=lambda: {"population_change": 0.10})
    excluded_sources: Optional[list[str]] = Field(default_factory=list)


DEFAULT_SCENARIOS = [
    {
        "id": "population_growth",
        "name": "Population Growth (+10% by 2030)",
        "driver_source": "SCB",
        "target_year": 2030,
        "scope": "dalarna",
        "driver": {"population_change": 0.10},
        "description": "Baseline regional demographic growth across 15 municipalities.",
    },
    {
        "id": "rapid_urbanization",
        "name": "Rapid Urbanization (+18% by 2035)",
        "driver_source": "SCB",
        "target_year": 2035,
        "scope": "dalarna",
        "driver": {"population_change": 0.18},
        "description": "Concentrated expansion in Borlänge, Falun, and regional corridors.",
    },
    {
        "id": "climate_freeze_thaw",
        "name": "Severe Winter Freeze-Thaw",
        "driver_source": "Trafikverket",
        "target_year": 2026,
        "scope": "dalarna",
        "driver": {"road_temp_delta": -3.5, "freeze_cycles": 14},
        "description": "Infrastructure stress and black-ice risk on high-traffic routes (E16).",
    },
]


@router.get("/scenarios")
def list_scenarios():
    """List available simulation scenarios."""
    return {"scenarios": DEFAULT_SCENARIOS}


@router.post("/run")
def execute_simulation(body: RunSimulationRequest):
    """Execute scenario and persist as latest official result."""
    global _LATEST_OFFICIAL
    result = run_simulation(
        scenario=body.scenario,
        target_year=body.target_year,
        scope=body.scope,
        driver=body.driver,
        excluded_sources=body.excluded_sources,
        is_test=False,
    )
    _RESULTS_CACHE[result["run_id"]] = result
    _LATEST_OFFICIAL = result
    logger.info("Executed simulation %s (scenario: %s, year: %d)", result["run_id"], body.scenario, body.target_year)
    return result


@router.post("/test")
def test_simulation(body: RunSimulationRequest, user: str = Depends(auth.require_admin)):
    """Run safe test simulation: does not update the official latest result."""
    result = run_simulation(
        scenario=body.scenario,
        target_year=body.target_year,
        scope=body.scope,
        driver=body.driver,
        excluded_sources=body.excluded_sources,
        is_test=True,
    )
    _RESULTS_CACHE[result["run_id"]] = result
    logger.info("Executed safe test simulation %s by admin %s", result["run_id"], user)
    return result


@router.get("/result/latest")
def get_latest_result():
    """Retrieve latest official simulation result."""
    global _LATEST_OFFICIAL
    if _LATEST_OFFICIAL is None:
        # Generate default 2030 result if not yet run
        _LATEST_OFFICIAL = run_simulation("population_growth", 2030, "dalarna", {"population_change": 0.10})
        _RESULTS_CACHE[_LATEST_OFFICIAL["run_id"]] = _LATEST_OFFICIAL
    return _LATEST_OFFICIAL


@router.get("/result/{run_id}")
def get_result_by_id(run_id: str):
    """Retrieve specific simulation run result by ID."""
    res = _RESULTS_CACHE.get(run_id)
    if res is None:
        raise HTTPException(status_code=404, detail=f"Simulation result '{run_id}' not found")
    return res
