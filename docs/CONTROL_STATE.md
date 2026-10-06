# Control state: schema, draft/publish flow, API contract

Describes what the code does today (`app/control.py`, `app/schemas.py`, `app/routers/control.py`, `static/js/control-room.js`). Known gaps are listed at the end.

## 1. Where the state lives

- **Saved (live) state:** table `control_state` (`db/control.sql`). Every Save & Apply inserts a new row; the row with the highest `version` is live. Nothing is updated or deleted, so the table is also the version history.
- **Registry mirror:** `source_registry.enabled` and `interval_seconds` are updated in the same transaction as the apply, because the scheduler reads the registry. Disabling a source only stops future fetches; no data row is touched.
- **Audit:** `audit_log` (user, timestamp, action, summary JSON, result) is written in the same transaction.
- **Draft (pending) state:** kept in the **admin's browser** (`sessionStorage`, key `cr_pending`, tied to the saved version it started from). It is shown only in the Preview iframe. It is never sent to the server until Save & Apply.

## 2. State shape

`GET /api/control/state` returns the saved state plus metadata:

```json
{
  "version": 12, "applied_at": "2026-10-07T10:00:00+00:00", "applied_by": "admin",
  "mode": "live",
  "scope": "dalarna",
  "active_scenario": null,
  "simulation_year": null,
  "sources": { "smhi": true, "trafikverket": true, "scb": true, "sgu": true, "skogsstyrelsen": true, "lantmateriet": true },
  "source_intervals": { "smhi": 900, "scb": 86400 },
  "layers": { "boundaries": true, "population": true, "weather": true, "roads": true, "water": true, "forest": true, "land": true, "simulation_risk": true },
  "components": { "source_cards": true, "regional_risk": true, "population": true, "food_risk": true, "snow_flood_risk": true,
                  "infrastructure_risk": true, "environment_risk": true, "municipality_table": true,
                  "simulation_control": true, "simulation_results": true, "map": true },
  "risk_thresholds": { "low": 0.3, "medium": 0.6, "high": 0.8 }
}
```

- `sources` and `source_intervals` are keyed by **registry id**, so a newly registered source appears without code changes. (Values are booleans/seconds; the spec's `{"enabled": true}` object form is not used.)
- `scope` is `"dalarna"` or one of the 15 municipality codes (2021, 2023, 2026, 2029, 2031, 2034, 2039, 2061, 2062, 2080, 2081, 2082, 2083, 2084, 2085).
- `risk_thresholds` are **upper bounds** on a 0–1 score: below `low` = LOW, below `medium` = MEDIUM, below `high` = HIGH, otherwise CRITICAL. The UI also accepts the lower-bound shape `{low:0, medium, high, critical}`.
- One `components` object serves both the *Dashboard Control* and *Appearance* tabs (no duplicate state).
- Unknown keys are rejected (`extra="forbid"`), as are unknown source ids, intervals outside 60 s – 7 days, thresholds that are not ascending within 0–1.

## 3. Draft → publish flow

1. The Control Room loads the saved state and copies it into the draft.
2. Every edit changes the draft only. The Preview (`/?preview=1`, the real Main Dashboard in compact mode) receives the draft through `postMessage` (same origin) and renders it; changed sources show "Pending OFF/ON".
3. **Save & Apply** sends `POST /api/control/apply {base_version, state}`. The server locks the table, rejects with **409** if `base_version` is not the latest, validates, inserts version N+1, syncs the registry, writes the audit row and returns the new state with `changed` (dotted paths).
4. **Reset** discards the draft. **Cancel** asks for confirmation and then discards it. A failed apply (error, 409, 422) keeps the draft.
5. Main Dashboard visitors only ever see saved state. Their Current/Simulation toggle is a per-browser session view and never writes to the server.

## 4. API contract

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/control/state` | public | Saved state |
| `POST /api/control/apply` | admin | Persist a full state; body `{base_version, state, note?}`; 409 on version conflict, 422 on validation errors |
| `POST /api/control/mode` | admin | Shortcut: `{mode, year?}` applied on top of the live state |
| `POST /api/control/source` | admin | Shortcut: `{source, enabled}` |
| `POST /api/control/map-layer` | admin | Shortcut: `{layer, visible}` |
| `GET /api/control/map-state` | public | Layer visibility and whether each layer's source is on and configured |
| `POST /api/control/source/test` | admin | Test one connector; stores nothing; returns status, `response_time_ms`, `record_count`, message |
| `POST /api/control/source/refresh` | admin | Fetch and store one source now |
| `POST /api/control/refresh-all` | admin | Refresh every enabled source; per-source results |
| `POST /api/control/source/register` | admin | Add a source to the registry (also enabled in the state) |
| `GET /api/control/export-config` | admin | `{exported_at, exported_by, config}` |
| `POST /api/control/import-config/validate` | admin | Dry run: `{valid, changed_keys, preview_state}` or `{valid:false, error}`; never changes anything |
| `GET /api/risk/config`, `POST /api/risk/config`, `POST /api/risk/calculate` | read / admin / any | Risk thresholds and classification |

Errors use one shape: `{"error": {"code", "message", "details"}}`. Validation errors carry the exact message "Please correct the highlighted value(s)." and per-field details.

## 5. Secrets

Secrets never enter the state, the registry or the browser. A source stores only the **names** of environment variables (`auth_env_vars`); values live in the server's `.env`. `tests/test_secret_scan.py` guards this.

## 6. Known gaps

- No server-side draft: the draft lives in one browser session.
- When the database is unreachable, `app/control.py` still falls back to an in-memory state instead of returning 503 (`tests/test_spec_gaps.py::test_apply_fails_when_database_is_down`).
- No endpoint to edit a source's connection details, and no generic connector for newly registered sources.
- `/api/system/audit` (the audit log) does not require login.
