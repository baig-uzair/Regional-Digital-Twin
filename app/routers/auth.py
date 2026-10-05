from fastapi import APIRouter, HTTPException, Request, Response

from app import auth, control
from app.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    if not auth.check_login(ip, body.username, body.password):
        control.log_failure(body.username[:50] or "?", "auth.login", {"ip": ip}, "denied")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    response.set_cookie(
        auth.COOKIE,
        auth.make_token(body.username),
        max_age=auth.SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    return {"user": body.username}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE, path="/")
    return {"user": None}


@router.get("/me")
def me(request: Request):
    return {"user": auth.current_user(request)}
