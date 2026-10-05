from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app import auth, config, db, sources
from app.scheduler import scheduler

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health")
def health(user: str = Depends(auth.require_admin)):
    db_ok = db.ping()
    srcs = []
    if db_ok:
        for s in sources.summary()["sources"]:
            srcs.append({k: s[k] for k in ("id", "name", "status", "status_label", "message", "last_attempt_at", "last_success_at", "last_error")})
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
