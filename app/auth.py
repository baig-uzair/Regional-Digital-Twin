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
    """Constant-time credential check with a small per-IP failure throttle."""
    cfg_user, cfg_pass = config.admin_credentials()
    if not cfg_user or not cfg_pass:
        raise HTTPException(status_code=503, detail="Admin login is not configured (set ADMIN_USERNAME and ADMIN_PASSWORD)")
    if _throttled(ip):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")
    ok_user = hmac.compare_digest(username.encode(), cfg_user.encode())
    ok_pass = hmac.compare_digest(password.encode(), cfg_pass.encode())
    if ok_user and ok_pass:
        _failures.pop(ip, None)
        return True
    _failures.setdefault(ip, []).append(time.monotonic())
    logger.warning("failed admin login from %s", ip)
    return False
