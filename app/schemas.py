"""Pydantic models for the control state and request bodies."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app import geo


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Layers(Strict):
    boundaries: bool = True
    population: bool = True
    weather: bool = True
    roads: bool = True
    water: bool = True
    forest: bool = True
    land: bool = True
    simulation_risk: bool = True


class Components(Strict):
    source_cards: bool = True
    regional_risk: bool = True
    population: bool = True
    food_risk: bool = True
    snow_flood_risk: bool = True
    infrastructure_risk: bool = True
    environment_risk: bool = True
    municipality_table: bool = True
    simulation_control: bool = True
    simulation_results: bool = True
    map: bool = True


class RiskThresholds(Strict):
    """Upper bound of each class on the 0..1 score; anything >= `high` is CRITICAL."""

    low: float = 0.30
    medium: float = 0.60
    high: float = 0.80

    @model_validator(mode="after")
    def _ordered(self):
        if not (0.0 < self.low < self.medium < self.high < 1.0):
            raise ValueError("thresholds must satisfy 0 < low < medium < high < 1")
        return self


class ControlState(Strict):
    mode: Literal["live", "simulation"] = "live"
    scope: str = "dalarna"
    sources: dict[str, bool] = Field(default_factory=dict)
    source_intervals: dict[str, int] = Field(default_factory=dict)  # seconds, per source id
    layers: Layers = Field(default_factory=Layers)
    components: Components = Field(default_factory=Components)
    risk_thresholds: RiskThresholds = Field(default_factory=RiskThresholds)
    active_scenario: Optional[str] = None
    simulation_year: Optional[int] = Field(default=None, ge=2000, le=2100)

    @field_validator("scope")
    @classmethod
    def _scope(cls, v: str) -> str:
        if v != "dalarna" and v not in geo.codes():
            raise ValueError("scope must be 'dalarna' or one of the 15 municipality codes")
        return v

    @field_validator("source_intervals")
    @classmethod
    def _intervals(cls, v: dict[str, int]) -> dict[str, int]:
        for k, secs in v.items():
            if not 60 <= secs <= 7 * 86400:
                raise ValueError(f"interval for {k} must be between 60 s and 7 days")
        return v


class ApplyRequest(Strict):
    base_version: int = Field(ge=1)
    state: ControlState
    note: Optional[str] = Field(default=None, max_length=300)


class ModeRequest(Strict):
    mode: Literal["live", "simulation"]
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    base_version: Optional[int] = Field(default=None, ge=1)


class SourceToggleRequest(Strict):
    source: str
    enabled: bool
    base_version: Optional[int] = Field(default=None, ge=1)


class MapLayerRequest(Strict):
    layer: str
    visible: bool
    base_version: Optional[int] = Field(default=None, ge=1)


class LoginRequest(Strict):
    username: str = Field(max_length=100)
    password: str = Field(max_length=200)
