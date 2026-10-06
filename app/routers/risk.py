"""Risk configuration and ad-hoc calculation endpoints."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import auth, control
from simulation.engine import classify_risk

logger = logging.getLogger("app.risk")

router = APIRouter(prefix="/api/risk", tags=["risk"])


class RiskConfigUpdate(BaseModel):
    low: float = Field(default=0.30, gt=0.0, lt=1.0)
    medium: float = Field(default=0.60, gt=0.0, lt=1.0)
    high: float = Field(default=0.80, gt=0.0, lt=1.0)
    critical: float = Field(default=1.00, gt=0.0, le=1.0)


class CalculateRiskRequest(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    thresholds: Optional[dict[str, float]] = None


@router.get("/config")
def get_risk_config():
    """Retrieve current risk thresholds configuration."""
    live = control.get_live()
    th = live.get("risk_thresholds", {"low": 0.30, "medium": 0.60, "high": 0.80, "critical": 1.00})
    weights = live.get("weights", {"population": 0.25, "food": 0.20, "snow_flood": 0.20, "infrastructure": 0.20, "environment": 0.15})
    return {
        "thresholds": th,
        "weights": weights,
        "classes": ["Low", "Medium", "High", "Critical"],
    }


@router.post("/config")
def update_risk_config(body: RiskConfigUpdate, user: str = Depends(auth.require_admin)):
    """Update risk thresholds (admin only)."""
    if not (body.low < body.medium < body.high <= body.critical):
        raise control.ValidationProblem("Thresholds must be strictly ascending: 0 < low < medium < high <= critical")
    
    def mutate(state: dict) -> None:
        state["risk_thresholds"] = {
            "low": body.low,
            "medium": body.medium,
            "high": body.high,
            "critical": body.critical,
        }

    return control.patch_state(mutate, user, "risk.config_update")


@router.post("/calculate")
def calculate_risk_level(body: CalculateRiskRequest):
    """Classify a given 0..1 score against saved or custom thresholds."""
    level = classify_risk(body.score, body.thresholds)
    return {
        "score": body.score,
        "level": level,
    }
