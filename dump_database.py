"""Database Backup Utility for Dalarna Regional Digital Twin.

Dumps all table DDL schemas and live data rows from PostgreSQL / TimescaleDB into a single .sql file.
Usage:
    python dump_database.py [output_file.sql]
"""
import sys
import json
from datetime import datetime, timezone
from pathlib import Path
from app import db

def dump_sql(target_path: str = "dalarna_database_dump.sql"):
    out_file = Path(target_path)
    print(f"Starting PostgreSQL database dump for Dalarna Digital Twin...")

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

    with open(out_file, "w", encoding="utf-8") as f:
        f.write("-- ==========================================================================\n")
        f.write("-- Dalarna Regional Digital Twin - Full Database Backup Dump\n")
        f.write(f"-- Generated At: {datetime.now(timezone.utc).isoformat()}\n")
        f.write("-- Database: PostgreSQL / TimescaleDB (dalarna_dt)\n")
        f.write("-- ==========================================================================\n\n")
        f.write("BEGIN;\n\n")

        # 1. Schemas
        for schema_file in db.SCHEMA_FILES:
            fpath = db.DB_DIR / schema_file
            if fpath.exists():
                f.write(f"-- --------------------------------------------------------------------------\n")
                f.write(f"-- DDL Schema: {schema_file}\n")
                f.write(f"-- --------------------------------------------------------------------------\n")
                f.write(fpath.read_text(encoding="utf-8"))
                f.write("\n\n")
                print(f"  [+] Loaded DDL schema: {schema_file}")

        # 2. Rows
        total_rows = 0
        with db.transaction() as conn:
            with conn.cursor() as cur:
                for tbl in tables:
                    cur.execute(f"SELECT * FROM {tbl}")
                    colnames = [desc[0] for desc in cur.description]
                    rows = cur.fetchall()
                    if rows:
                        f.write(f"-- Data: {tbl} ({len(rows)} records)\n")
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
                                elif isinstance(val, (dict, list)):
                                    json_str = json.dumps(val).replace("'", "''")
                                    vals.append(f"'{json_str}'::jsonb")
                                else:
                                    s_val = str(val).replace("'", "''")
                                    vals.append(f"'{s_val}'")
                            val_str = ", ".join(vals)
                            f.write(f'INSERT INTO "{tbl}" ({col_str}) VALUES ({val_str}) ON CONFLICT DO NOTHING;\n')
                        f.write("\n")
                        total_rows += len(rows)
                        print(f"  [+] Exported table '{tbl}': {len(rows)} rows")

        f.write("COMMIT;\n")

    size_kb = out_file.stat().st_size / 1024
    print(f"\n[OK] Database dump completed successfully: {out_file.resolve()}")
    print(f"     Total records exported: {total_rows} rows ({size_kb:.1f} KB)")

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "dalarna_database_dump.sql"
    dump_sql(path)
