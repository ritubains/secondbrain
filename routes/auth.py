# auth routes: login, logout, no small talk.
import time
from collections import defaultdict, deque
from fastapi import APIRouter, Response, Request, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import get_session
from core.auth import verify_password, issue_token, read_token, DUMMY_HASH
from core.config import settings, is_prod

router = APIRouter(prefix="/auth")

class LoginIn(BaseModel):
    email: str
    password: str

# Brute-force guard: 5 failed logins per IP and per email in 15 min → 429. In-memory is enough
# for one API process (a restart resets it); a success clears that email's count.
MAX_FAILS, WINDOW = 5, 15 * 60
_fails: dict = defaultdict(deque)  # "ip:<addr>" / "email:<addr>" → failure timestamps

def _recent(key: str, now: float) -> deque:
    q = _fails[key]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if not q:
        _fails.pop(key, None)  # don't keep empty keys around forever
    return q

def _cookie_args() -> dict:
    # Same attributes on set and delete, or the browser keeps the old cookie.
    return {"httponly": True, "samesite": "lax", "path": "/", "secure": is_prod()}

@router.post("/login")
async def login(body: LoginIn, req: Request, resp: Response, s: AsyncSession = Depends(get_session)):
    # Verify email+password; on success set the session cookie, else 401 (429 when rate-limited).
    now, email = time.time(), body.email.strip().lower()
    keys = [f"ip:{req.client.host if req.client else '?'}", f"email:{email}"]
    if any(len(_recent(k, now)) >= MAX_FAILS for k in keys):
        resp.status_code = 429
        return {"error": "too_many_attempts"}
    row = (await s.execute(text("SELECT id, password_hash FROM users WHERE lower(email)=:e"), {"e": email})).mappings().first()
    ok = verify_password(body.password, row["password_hash"] if row else DUMMY_HASH) and row is not None
    if not ok:
        for k in keys:
            _fails[k].append(now)
        resp.status_code = 401
        return {"error": "bad credentials"}
    _fails.pop(f"email:{email}", None)
    resp.set_cookie("session", issue_token(str(row["id"])), max_age=settings.session_days * 86400, **_cookie_args())
    return {"ok": True}

@router.post("/logout")
async def logout(resp: Response):
    # Clear the session cookie to end this browser's login.
    resp.delete_cookie("session", **_cookie_args())
    return {"ok": True}

@router.get("/me")
async def whoami(req: Request, resp: Response, s: AsyncSession = Depends(get_session)):
    # Return the logged-in user's email from the session cookie, or 401.
    uid = read_token(req.cookies.get("session", ""))
    row = (await s.execute(text("SELECT email FROM users WHERE id=:i"), {"i": uid})).mappings().first() if uid else None
    if not row:
        resp.status_code = 401
        return {"error": "unauthorized"}
    return {"email": row["email"]}
