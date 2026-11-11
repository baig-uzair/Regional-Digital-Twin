import csv
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from app import auth, config, control, db, geo, municipalities, sources
from app.scheduler import scheduler
from simulation import engine

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health")
def health(user: str = Depends(auth.require_admin)):
    db_ok = db.ping()
    srcs = []
    if db_ok:
        for s in sources.summary()["sources"]:
            srcs.append({k: s[k] for k in ("id", "name", "status", "status_label", "message", "last_attempt_at", "last_success_at", "last_error")})
    else:
        # Fallback to source registry when DB offline
        srcs = [
            {"id": s["id"], "name": s["name"], "status": "ok", "status_label": "Healthy", "message": "In-memory operational"}
            for s in sources.list_sources()
        ]
    admin_user, admin_pass = config.admin_credentials()
    return {
        "time": datetime.now(timezone.utc),
        "database": {"ok": db_ok},
        "scheduler": {"enabled": config.scheduler_enabled(), "alive": scheduler.alive},
        "sources": srcs,
        "auth": {
            "admin_login_configured": bool(admin_user and admin_pass),
            "session_secret_persistent": config.session_secret_is_persistent(),
        },
    }


@router.get("/audit")
def list_audit_logs(limit: int = Query(50, ge=1, le=200)):
    """Retrieve audit log events."""
    return {"events": control.get_audit_log(limit=limit)}


def generate_export_data(format_type: str = "json") -> Response:
    """Generate export in JSON, CSV, XLSX, or GeoJSON format."""
    now_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    munis = municipalities.all_municipalities()
    src_summary = sources.summary()
    ctrl_state = control.get_live()
    latest_sim = engine.get_latest_simulation()

    if format_type == "json":
        data = {
            "title": "Dalarna Regional Digital Twin Export",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "region": "Dalarna County (SE-W / Län 20)",
            "municipality_count": len(munis),
            "municipalities": munis,
            "data_sources": src_summary.get("sources", []),
            "control_state": ctrl_state,
            "simulation": latest_sim,
        }
        return JSONResponse(
            content=jsonable_encoder(data),
            headers={"Content-Disposition": f'attachment; filename="dalarna_digital_twin_{now_str}.json"'},
        )

    if format_type == "geojson":
        features = geo.geojson_data().get("features", [])
        data = {
            "type": "FeatureCollection",
            "name": "Dalarna Municipalities",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": features,
        }
        return JSONResponse(
            content=data,
            headers={"Content-Disposition": f'attachment; filename="dalarna_municipalities_{now_str}.geojson"'},
        )

    if format_type == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Municipality_Code", "Name", "Population", "Period", "Data_Origin", "Risk_Category", "Risk_Score", "Simulated_Population"])

        # Map simulation result per municipality if available
        sim_munis = {}
        if latest_sim and "municipalities" in latest_sim:
            sim_munis = {m["code"]: m for m in latest_sim["municipalities"]}

        for m in munis:
            code = m.get("code", "")
            name = m.get("name", "")
            pop_info = m.get("population") or {}
            pop_val = pop_info.get("value", "")
            pop_period = pop_info.get("period", "")
            pop_origin = pop_info.get("origin", "")
            sim_info = sim_munis.get(code, {})
            risk_cat = sim_info.get("risk_category", "LOW")
            risk_score = sim_info.get("risk_score", 0.25)
            sim_pop = sim_info.get("simulated_population", pop_val)

            writer.writerow([code, name, pop_val, pop_period, pop_origin, risk_cat, risk_score, sim_pop])

        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8-sig")),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="dalarna_municipalities_{now_str}.csv"'},
        )

    if format_type == "xlsx":
        try:
            import openpyxl
            from openpyxl.styles import Alignment, Font, PatternFill

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Municipalities"

            # Headers
            headers = ["Code", "Municipality", "Baseline Population", "Period", "Origin", "Risk Rating", "Risk Score", "Simulated Population"]
            ws.append(headers)

            header_fill = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")
            header_font = Font(color="FFFFFF", bold=True)
            for col_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=1, column=col_idx)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center")

            sim_munis = {}
            if latest_sim and "municipalities" in latest_sim:
                sim_munis = {m["code"]: m for m in latest_sim["municipalities"]}

            for row_idx, m in enumerate(munis, start=2):
                code = m.get("code", "")
                name = m.get("name", "")
                pop_info = m.get("population") or {}
                pop_val = pop_info.get("value", 0)
                pop_period = pop_info.get("period", "")
                pop_origin = pop_info.get("origin", "")
                sim_info = sim_munis.get(code, {})
                risk_cat = sim_info.get("risk_category", "LOW")
                risk_score = sim_info.get("risk_score", 0.25)
                sim_pop = sim_info.get("simulated_population", pop_val)

                ws.append([code, name, pop_val, str(pop_period), pop_origin, risk_cat, risk_score, sim_pop])

            # Sheet 2: Data Sources
            ws_sources = wb.create_sheet(title="Data Sources")
            src_headers = ["ID", "Name", "Status", "Total Records", "Health"]
            ws_sources.append(src_headers)
            for col_idx in range(1, len(src_headers) + 1):
                cell = ws_sources.cell(row=1, column=col_idx)
                cell.fill = header_fill
                cell.font = header_font

            for s in src_summary.get("sources", []):
                ws_sources.append([
                    s.get("id"),
                    s.get("name"),
                    s.get("status_label", "OK"),
                    s.get("total_records", 0),
                    s.get("message", "Operational"),
                ])

            bio = io.BytesIO()
            wb.save(bio)
            bio.seek(0)

            return StreamingResponse(
                bio,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="dalarna_digital_twin_{now_str}.xlsx"'},
            )
        except Exception as exc:
            # Fallback to CSV if openpyxl error
            return generate_export_data("csv")

    if format_type == "sql":
        output = io.StringIO()
        output.write("-- ==========================================================================\n")
        output.write("-- Dalarna Regional Digital Twin - Full Database Backup Dump\n")
        output.write(f"-- Generated At: {datetime.now(timezone.utc).isoformat()}\n")
        output.write("-- Database: PostgreSQL / TimescaleDB (dalarna_dt)\n")
        output.write("-- ==========================================================================\n\n")
        output.write("BEGIN;\n\n")

        # 1. DDL Schemas from db directory
        for schema_file in db.SCHEMA_FILES:
            fpath = db.DB_DIR / schema_file
            if fpath.exists():
                output.write(f"-- --------------------------------------------------------------------------\n")
                output.write(f"-- DDL Schema: {schema_file}\n")
                output.write(f"-- --------------------------------------------------------------------------\n")
                output.write(fpath.read_text(encoding="utf-8"))
                output.write("\n\n")

        # 2. Live Data rows
        tables = [
            "admin_users",
            "source_registry",
            "regional_datasources",
            "regional_telemetry",
            "control_state",
            "scenarios",
            "simulation_runs",
            "source_runs",
            "audit_log",
        ]
        try:
            with db.transaction() as conn:
                with conn.cursor() as cur:
                    for tbl in tables:
                        cur.execute(f"SELECT * FROM {tbl}")
                        colnames = [desc[0] for desc in cur.description]
                        rows = cur.fetchall()
                        if rows:
                            output.write(f"-- Data: {tbl} ({len(rows)} records)\n")
                            col_str = ", ".join(f'"{c}"' for c in colnames)
                            for row in rows:
                                vals = []
                                for val in row:
                                    if val is None:
                                        vals.append("NULL")
                                    elif isinstance(val, (int, float)):
                                        vals.append(str(val))
                                    elif isinstance(val, bool):
                                        vals.append("TRUE" if val else "FALSE")
                                    elif isinstance(val, dict) or isinstance(val, list):
                                        json_str = json.dumps(val).replace("'", "''")
                                        vals.append(f"'{json_str}'::jsonb")
                                    else:
                                        s_val = str(val).replace("'", "''")
                                        vals.append(f"'{s_val}'")
                                val_str = ", ".join(vals)
                                output.write(f'INSERT INTO "{tbl}" ({col_str}) VALUES ({val_str}) ON CONFLICT DO NOTHING;\n')
                            output.write("\n")
        except Exception as e:
            output.write(f"-- Error dumping live rows: {e}\n")

        output.write("COMMIT;\n")
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8")),
            media_type="application/sql",
            headers={"Content-Disposition": f'attachment; filename="dalarna_database_{now_str}.sql"'},
        )

    raise HTTPException(status_code=400, detail=f"Unsupported export format '{format_type}'. Supported: json, csv, xlsx, geojson, sql")


@router.get("/export")
def export_system_data(format: str = Query("json", pattern="^(json|csv|xlsx|geojson|sql)$")):
    return generate_export_data(format)
