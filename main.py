"""The API: notes in (typed or spoken), one pipeline that structures and connects them, a chatbot over them,
projects, people/places/words, Home, and long-term memory. Run: uvicorn main:app --reload --port 8000"""
import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from core import memory, storage
from core.auth import check_secret, hash_password
from core.config import is_prod, settings
from core.llm import minilm
from core.transcribe import load_local as load_whisper
from db.session import Session
from routes.auth import router as auth_routes
from routes.chat import router as chat_routes
from routes.graph import router as graph_routes
from routes.home import router as home_routes
from routes.notes import router as notes_routes
from routes.people import router as people_routes
from routes.profile import router as profile_routes
from routes.projects import router as projects_routes
from routes.todos import router as todos_routes
from routes.topics import router as topics_routes
from routes.voice import router as voice_routes

# One log format for our modules and uvicorn's; LOG_LEVEL=debug|info|warning.
logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bigbutter")

def _warm_models() -> None:
    """Load the on-device models in a thread at boot, so the first note or question doesn't wait ~20 s for them."""
    started, ready = time.perf_counter(), []
    steps = [("minilm", settings.embed_engine == "local", minilm),
             ("whisper", settings.transcribe_engine == "local", load_whisper),
             ("ollama", settings.llm_engine == "local", _wake_ollama),
             ("memory", memory.enabled(), memory.build)]
    for name, wanted, load in steps:
        if not wanted:
            continue
        try:
            load()
            ready.append(name)
        except Exception as e:
            log.warning("warm-up: %s skipped (%r)", name, e)
    log.info("warm-up done in %.1fs (%s)", time.perf_counter() - started, ", ".join(ready) or "nothing local")

def _wake_ollama() -> None:
    """An empty prompt loads the local model into memory."""
    base = settings.llm_base_url.rstrip("/").removesuffix("/v1")
    httpx.post(f"{base}/api/generate", json={"model": settings.llm_model, "prompt": ""}, timeout=60)

async def _ensure_login_user() -> None:
    """Create or update the APP_USER_EMAIL account, so login works with no manual steps."""
    if not (settings.app_user_email and settings.app_user_password):
        return
    email = settings.app_user_email.strip().lower()
    async with Session() as s:
        await s.execute(text("INSERT INTO users (email, password_hash) VALUES (:e, :h) ON CONFLICT (email) DO UPDATE SET password_hash = :h"),
                        {"e": email, "h": hash_password(settings.app_user_password)})
        await s.commit()
    log.info("login user ready: %s", email)

async def _warm_db() -> None:
    """Open a pooled connection now (Neon's TLS handshake takes seconds), not on the first request."""
    try:
        async with Session() as s:
            await s.execute(text("SELECT 1"))
    except Exception as e:
        log.warning("warm-up: db skipped (%r)", e)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Boot: login user, storage check, model warm-up in the background; then serve."""
    await _ensure_login_user()
    if storage.half_configured():
        log.warning("S3 is partly configured (needs S3_BUCKET + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY): voice audio stays on local disk")
    log.info("voice storage: %s", "s3://" + settings.s3_bucket if storage.s3() else storage.local_root() if storage.enabled() else "off")
    threading.Thread(target=_warm_models, name="warm-models", daemon=True).start()
    asyncio.create_task(_warm_db())
    yield

check_secret()  # ENV=prod with a weak JWT_SECRET refuses to boot (sessions could be forged)
app = FastAPI(title="bigbutter api", lifespan=lifespan, **({"docs_url": None, "redoc_url": None, "openapi_url": None} if is_prod() else {}))
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def user_first(request: Request, call_next):
    """While someone chats or searches, background memory learning waits (one local model, one request at a time)."""
    if request.url.path in ("/chat", "/search"):
        async with memory.interactive():
            return await call_next(request)
    return await call_next(request)

for router in (auth_routes, notes_routes, voice_routes, chat_routes, projects_routes, todos_routes, topics_routes, people_routes, graph_routes,
               home_routes, profile_routes):
    app.include_router(router)

@app.get("/health")
def health():
    """Liveness: the process is up (no dependencies checked, so it never flaps on a database blip)."""
    return {"ok": True}

@app.get("/ready")
async def ready(resp: Response):
    """Readiness: the database answers."""
    try:
        async with Session() as s:
            await s.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception as e:
        log.warning("readiness: db unreachable (%r)", e)
        resp.status_code = 503
        return {"ok": False}
