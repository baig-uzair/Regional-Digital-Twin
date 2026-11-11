"""FastAPI application: serves the static frontend and /api, and runs the source scheduler."""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg2
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import auth, config, control, db
from app.routers import auth as auth_router
from app.routers import control as control_router
from app.routers import data as data_router
from app.routers import risk as risk_router
from app.routers import simulation as simulation_router
from app.routers import system as system_router
from app.routers import telemetry as telemetry_router
from app.scheduler import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("app")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

bootstrap_state = {"ready": False, "error": None}


def _bootstrap() -> None:
    """Wait for the database, apply the schema, seed control state, then start the scheduler."""
    try:
        if not db.wait_for_db():
            raise RuntimeError("database not reachable after 90 s")
        db.apply_schema()
        control.seed_if_empty()
        bootstrap_state["ready"] = True
        if config.scheduler_enabled():
            scheduler.start()
        if not config.session_secret_is_persistent():
            logger.warning("SESSION_SECRET is not set: admin sessions will reset whenever the app restarts")
    except Exception as exc:  # noqa: BLE001
        bootstrap_state["error"] = str(exc)
        logger.exception("bootstrap failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.bootstrap_enabled():
        threading.Thread(target=_bootstrap, name="bootstrap", daemon=True).start()
    yield
    scheduler.stop()


app = FastAPI(title="Dalarna Digital Twin", lifespan=lifespan)


def _err(status: int, code: str, message: str, details=None, extra: dict | None = None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details}}
    if extra:
        body["error"].update(extra)
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(HTTPException)
async def http_exc(request: Request, exc: HTTPException):
    code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited", 503: "unavailable"}.get(exc.status_code, "error")
    return _err(exc.status_code, code, str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_exc(request: Request, exc: RequestValidationError):
    details = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    return _err(422, "validation_error", "Please correct the highlighted value(s).", details)


@app.exception_handler(control.VersionConflict)
async def conflict_exc(request: Request, exc: control.VersionConflict):
    return _err(409, "version_conflict", str(exc), extra={"current_version": exc.current_version})


@app.exception_handler(control.ValidationProblem)
async def problem_exc(request: Request, exc: control.ValidationProblem):
    return _err(422, "validation_error", str(exc))


@app.exception_handler(psycopg2.Error)
async def db_exc(request: Request, exc: psycopg2.Error):
    logger.error("database error on %s: %s", request.url.path, exc)
    return _err(503, "database_unavailable", "The database is not available right now.")


@app.exception_handler(Exception)
async def unhandled_exc(request: Request, exc: Exception):
    logger.exception("unhandled error on %s", request.url.path)
    return _err(500, "internal_error", "Something went wrong on the server.")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")  # the admin Preview iframes this origin
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(auth_router.router)
app.include_router(control_router.router)
app.include_router(data_router.router)
app.include_router(risk_router.router)
app.include_router(simulation_router.router)
app.include_router(system_router.router)
app.include_router(telemetry_router.router)


@app.get("/api/export")
def export_endpoint(format: str = "json"):
    return system_router.generate_export_data(format)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(path: str):
    raise HTTPException(status_code=404, detail=f"No such endpoint: /api/{path}")


ADMIN_MODULES = {"overview", "control", "datasources", "scenarios", "risks", "layers", "appearance", "system"}


@app.get("/admin", include_in_schema=False)
@app.get("/admin/{module}", include_in_schema=False)
async def admin_page(request: Request, module: str = "overview"):
    if not auth.current_user(request):
        next_url = f"/admin/{module}" if module != "overview" else "/admin"
        return RedirectResponse(f"/login?next={next_url}", status_code=303)
    return FileResponse(STATIC_DIR / "admin.html", headers={"Cache-Control": "no-store"})


@app.get("/login", include_in_schema=False)
async def login_page():
    return FileResponse(STATIC_DIR / "login.html", headers={"Cache-Control": "no-store"})


@app.get("/cockpit", include_in_schema=False)
@app.get("/cockpit.html", include_in_schema=False)
async def cockpit_page():
    root_index = Path(__file__).resolve().parent.parent / "index.html"
    return FileResponse(root_index, headers={"Cache-Control": "no-store"})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
