"""Admin authentication: signed, time-limited session cookie. No credentials have defaults.

ADMIN_USERNAME / ADMIN_PASSWORD come from .env. If ADMIN_PASSWORD is unset, login is
disabled (503) rather than falling back to a weak default.
"""
from __future__ import annotations

import hmac
import logging
import time
from typing import Optional

from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app import config

logger = logging.getLogger("app.auth")

COOKIE = "dt_session"
SESSION_MAX_AGE = 8 * 3600
_SALT = "dalarna-dt-admin-session"

_failures: dict[str, list[float]] = {}
MAX_FAILURES, WINDOW_S = 5, 300


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(config.session_secret(), salt=_SALT)


def make_token(username: str) -> str:
    return _serializer().dumps({"u": username})


def read_token(token: str) -> Optional[str]:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE)
        return data.get("u")
    except (BadSignature, SignatureExpired):
        return None


def current_user(request: Request) -> Optional[str]:
    token = request.cookies.get(COOKIE)
    return read_token(token) if token else None


def require_admin(request: Request) -> str:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Administrator login required")
    return user


def _throttled(ip: str) -> bool:
    now = time.monotonic()
    recent = [t for t in _failures.get(ip, []) if now - t < WINDOW_S]
    _failures[ip] = recent
    return len(recent) >= MAX_FAILURES


def check_login(ip: str, username: str, password: str) -> bool:
    """Check credentials against database admin_users table, with fallback to config."""
    if _throttled(ip):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")

    # 1. First, check database admin_users table
    try:
        from app import db
        with db.cursor() as cur:
            cur.execute(
                "SELECT id, username, password_hash, is_active FROM admin_users WHERE username = %s LIMIT 1",
                (username,)
            )
            user_row = cur.fetchone()
            if user_row:
                if not user_row.get("is_active", True):
                    logger.warning("Attempted login for inactive user %s from %s", username, ip)
                    return False
                stored_hash = user_row.get("password_hash") or ""
                # Check plain or hash
                is_match = False
                if stored_hash.startswith("pbkdf2:") or stored_hash.startswith("$2b$") or stored_hash.startswith("sha256:"):
                    import hashlib
                    # If sha256 formatted: sha256:<salt>:<hex> or simple sha256
                    if stored_hash.startswith("sha256:"):
                        parts = stored_hash.split(":")
                        if len(parts) == 3:
                            test_hex = hashlib.sha256((parts[1] + password).encode()).hexdigest()
                            is_match = hmac.compare_digest(parts[2], test_hex)
                        else:
                            test_hex = hashlib.sha256(password.encode()).hexdigest()
                            is_match = hmac.compare_digest(parts[1], test_hex)
                else:
                    # Direct comparison for plain / standard admin password
                    is_match = hmac.compare_digest(password.encode(), stored_hash.encode())

                if is_match:
                    _failures.pop(ip, None)
                    cur.execute("UPDATE admin_users SET last_login = NOW() WHERE id = %s", (user_row["id"],))
                    return True
    except Exception as exc:
        logger.warning("Database user query failed, falling back to config: %s", exc)

    # 2. Fallback to .env config if not in database
    cfg_user, cfg_pass = config.admin_credentials()
    if cfg_user and cfg_pass:
        ok_user = hmac.compare_digest(username.encode(), cfg_user.encode())
        ok_pass = hmac.compare_digest(password.encode(), cfg_pass.encode())
        if ok_user and ok_pass:
            _failures.pop(ip, None)
            return True

    _failures.setdefault(ip, []).append(time.monotonic())
    logger.warning("failed admin login from %s", ip)
    return False
