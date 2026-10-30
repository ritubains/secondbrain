"""Passwords (bcrypt), session tokens (JWT in a cookie) and the login check every data route uses."""
import logging
import time
from typing import Optional
import bcrypt
from fastapi import HTTPException, Request
from jose import jwt
from core.config import settings, is_prod

def hash_password(pw: str) -> str:
    # Hash a plaintext password with bcrypt before storing it.
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    # Check a login password against its stored bcrypt hash. bcrypt ≥5 raises on >72-byte
    # passwords (and on a malformed hash) — that's a failed login, not a 500.
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False

# Unknown email still pays one bcrypt check, so response time doesn't reveal which emails exist.
DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt()).decode()

def check_secret() -> None:
    # Boot guard: a guessable signing key lets anyone mint a session for any user.
    weak = settings.jwt_secret in ("", "change-me", "change-me-32-chars-minimum") or len(settings.jwt_secret) < 32
    if weak and is_prod():
        raise RuntimeError("ENV=prod needs a strong JWT_SECRET (32+ chars, e.g. `openssl rand -hex 32`)")
    if weak:
        logging.getLogger("bigbutter").warning("JWT_SECRET is weak/default — fine for dev, refused when ENV=prod")

def issue_token(user_id: str) -> str:
    # Mint the session JWT that identifies this user on every request; expires after session_days.
    now = int(time.time())
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + settings.session_days * 86400},
                      settings.jwt_secret, algorithm="HS256")

def read_token(token: str) -> Optional[str]:
    # Decode the session cookie back to a user id, or None if forged/expired/never-expiring (pre-exp tokens).
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require_exp": True})["sub"]
    except Exception:
        return None

def current_user(req: Request) -> str:
    """Route dependency: the user id from the session cookie, or 401."""
    uid = read_token(req.cookies.get("session", ""))
    if not uid:
        raise HTTPException(401)
    return uid
