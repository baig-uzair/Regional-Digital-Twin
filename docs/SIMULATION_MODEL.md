# Simulation model

Describes `simulation/engine.py` and `config/simulation_model.json` (model version 1.2.0) as they are today. The engine is pure Python: it never reads or writes the database, so a simulation cannot overwrite live data. Results are **scenarios (what-if estimates), not forecasts from any agency**, and the UI labels every simulated value `SIMULATED`.

## 1. Dependency chain

```
driver (population change)  ->  traffic demand        -> infrastructure pressure
                            ->  land development       -> (development pressure)
                            ->  forest reduction       -> environmental pressure
                            ->  water / supply exposure-> snow/flood and food exposure
                                                           -> overall regional risk

SMHI weather: external condition. Never changed by the scenario.
```

Each downstream source gets **its own coefficient**, so changes differ in size per source (population +10% gives traffic +12%, land +10%, forest -2%, water +6% with the default coefficients). A source switched off in the request (`excluded_sources`) contributes nothing and is shown as "excluded"; its stored data is untouched.

## 2. Coefficients (config/simulation_model.json, scenario `population_growth`)

| Key | Default | Meaning |
|---|---|---|
| `traffic_demand` | 1.2 | traffic change = population change × 1.2 (Trafikverket) |
| `infrastructure_pressure` | 0.85 | infrastructure score += traffic change × 0.85 |
| `land_development` | 1.0 | land change = population change × 1.0 (Lantmäteriet) |
| `forest_reduction` | -0.20 | forest change = population change × -0.20 (Skogsstyrelsen) |
| `water_exposure` | 0.60 | water change = population change × 0.60 (SGU) |
| `weather_effect` | 0.0 | SMHI is not changed |

## 3. Per-municipality formulas (15 municipalities from `municipalities_baseline`)

Let `p` = population change (e.g. 0.10).

- Population: `simulated = round(base_pop × (1 + p))`
- Infrastructure score = `clamp(base_infra + traffic_change × 0.85, 0, 1)`
- Food score = `clamp(base_food + p × 0.30, 0, 1)`
- Snow/Flood score = `clamp(base_flood + water_change × 0.20, 0, 1)`
- Environment score = `clamp(base_env + |forest_change| × 0.40, 0, 1)`
- Overall = `0.30 × infrastructure + 0.25 × food + 0.25 × flood + 0.20 × environment`
- Regional score = mean of the 15 overall scores.

Levels come from the thresholds (default LOW < 0.30 ≤ MEDIUM < 0.60 ≤ HIGH < 0.80 ≤ CRITICAL). The Main Dashboard re-classifies from the scores with the live saved thresholds, so labels follow the Control Room settings.

## 4. Request and result

`POST /api/simulation/run` (also `/api/simulation/test`, admin only, which never replaces the official latest result):

```json
{"scenario": "population_growth", "target_year": 2030, "scope": "dalarna",
 "driver": {"population_change": 0.10}, "excluded_sources": []}
```

The result contains `run_id`, `scenario`, `target_year`, `scope`, `model_version`, `timestamp`, `simulated: true`, `is_test`, `summary` (population, regional risk, key takeaway), `impact_by_source` (6 rows, SMHI marked `external`), `municipalities` (15 rows with scores and levels) and `assumptions` (formula, driver, coefficients, thresholds, note).

## 5. Known deviations from the spec (documented as xfail tests in tests/test_spec_gaps.py)

1. **Years are ignored.** The spec formula is `future = current × (1 + rate)^years`; the engine multiplies by `(1 + p)` once, so 2026 and 2040 give the same result.
2. **Saved risk thresholds are not used** when labelling results inside the API (the config file's defaults are).
3. **Excluding the driver source (`scb`)** does not remove the population effect.
4. **Scenarios without a population driver** (e.g. `climate_freeze_thaw`) still apply +10% population, and their own driver (`road_temp_delta`) is not modelled.
5. **Baselines are literals** in the JSON (municipality population and base risk scores) and the "current" values in `impact_by_source` (288,000, 12,450, 450,000 ha, 293, 7.1 °C) are hard-coded text, not read from stored source data.
6. **Results live in process memory**; the `simulation_runs` table is not used, so they are lost on restart.
7. `weights` in the JSON are not read; the overall-risk weights are constants in the code.
8. Only three scenarios exist, defined in code; there is no scenario create/update endpoint.
