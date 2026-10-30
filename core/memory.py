"""Long-term memory (MEMORY_ENGINE=mem0): lasting facts about the user — their role, places, people, recurring
issues, preferences — and about each project. mem0 distils them from notes, merges them over time and keeps them
in this app's Postgres. Notes are found by pipeline/links.py; memory is the context around them.

Scopes (mem0 agent_id): "profile" for notes outside projects, "project:<id>" for notes inside one.
Every call fails open: memory off or broken never breaks a note or an answer.
"""
import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager
from mem0 import AsyncMemory
from sqlalchemy import text
import prompts
from core.config import settings, MEMORY_DIR
from core.llm import MODEL_LOAD
from db.session import Session, _url, _ssl

log = logging.getLogger("bigbutter.memory")
logging.getLogger("mem0.utils.spacy_models").setLevel(logging.ERROR)  # optional lemmatizer (mem0ai[nlp]); fine without

PROFILE = "profile"
DUPLICATE = 0.88   # a new fact this close to a stored one says the same thing in other words
QUIET = 4.0        # seconds without a chat/search before background learning may use the model

_mem = None
_build_lock = threading.Lock()
_one_at_a_time = asyncio.Semaphore(1)  # a local model serves one request well, not five
_busy = 0
_last_busy = 0.0

def enabled() -> bool:
    """Memory is on (it needs an AI engine to distil facts)."""
    return settings.memory_engine == "mem0" and settings.llm_engine != "off"

def scope(project_id: str | None) -> str:
    """The mem0 scope a note or chat belongs to."""
    return f"project:{project_id}" if project_id else PROFILE

@asynccontextmanager
async def interactive():
    """Wrap a chat or search: background learning waits until QUIET seconds after the last one (main.py middleware).
    One local model answers one request at a time, so learning started mid-question makes the answer wait."""
    global _busy, _last_busy
    _busy += 1
    try:
        yield
    finally:
        _busy -= 1
        _last_busy = time.monotonic()

async def _wait_for_quiet() -> None:
    """Hold background learning while the user is chatting or searching."""
    while _busy or time.monotonic() - _last_busy < QUIET:
        await asyncio.sleep(0.5)

def _config() -> dict:
    """mem0's settings, following the app's engines and database."""
    local_embed = settings.embed_engine == "local"
    dims = 384 if local_embed else 1536
    if settings.llm_engine == "local":
        llm = {"provider": "ollama", "config": {"model": settings.memory_llm_model or settings.llm_model, "temperature": 0,
                                                 "ollama_base_url": settings.llm_base_url.rstrip("/").removesuffix("/v1")}}
    else:
        llm = {"provider": "openai", "config": {"model": settings.memory_llm_model or settings.extraction_model, "temperature": 0,
                                                 "api_key": settings.openai_api_key}}
    embedder = ({"provider": "huggingface", "config": {"model": "all-MiniLM-L6-v2", "embedding_dims": dims}} if local_embed else
                {"provider": "openai", "config": {"model": settings.embedding_model, "embedding_dims": dims, "api_key": settings.openai_api_key}})
    return {
        "llm": llm,
        "embedder": embedder,
        "vector_store": {"provider": "pgvector", "config": {
            "connection_string": _url.replace("postgresql+asyncpg://", "postgresql://", 1),
            "sslmode": "require" if _ssl else "disable",
            "collection_name": "mem0_local" if local_embed else "mem0_api",
            "embedding_model_dims": dims, "hnsw": True, "maxconn": 3}},
        "history_db_path": str(MEMORY_DIR / "history.db"),
        "custom_instructions": prompts.PROFILE,
    }

def build():
    """Start mem0 once (loads its embedder, opens its DB pool). Also called at boot by main.py."""
    global _mem
    if _mem is None:
        with _build_lock, MODEL_LOAD:  # mem0 loads its own MiniLM copy — never alongside another model load
            if _mem is None:
                MEMORY_DIR.mkdir(parents=True, exist_ok=True)
                _mem = AsyncMemory.from_config(_config())
                log.info("memory ready (%s llm, %s embeddings)", settings.llm_engine, settings.embed_engine)
    return _mem

async def _get():
    """mem0, started on first use."""
    return _mem or await asyncio.to_thread(build)

def purge(uid: str | None = None, memory_ids: list | None = None) -> None:
    """Clear mem0's local log (MEMORY_DIR/history.db): the raw inputs it feeds into later extractions, and old
    versions of memories. Notes are independent, and forgotten means forgotten. Uses mem0 2.2.1's SQLite manager."""
    if _mem is None:
        return
    try:
        with _mem.db._lock:
            if uid:
                _mem.db.connection.execute("DELETE FROM messages WHERE session_scope LIKE ?", (f"%user_id={uid}%",))
            if memory_ids:
                _mem.db.connection.executemany("DELETE FROM history WHERE memory_id = ?", [(i,) for i in memory_ids])
            _mem.db.connection.commit()
    except Exception as e:
        log.warning("memory purge failed: %r", e)

async def remember(uid: str, body: str, project_id: str | None = None, **meta) -> None:
    """Learn lasting facts from a note or question (seconds of the model — run it in the background)."""
    if not enabled() or not body.strip():
        return
    try:
        m = await _get()
        where = scope(project_id)
        async with _one_at_a_time:
            await _wait_for_quiet()
            result = await m.add(body, user_id=uid, agent_id=where, metadata=meta or None)
            purge(uid)
            copies = []
            for fact in result.get("results", []) if isinstance(result, dict) else []:
                if fact.get("event") != "ADD" or not fact.get("memory"):
                    continue
                near = await m.search(fact["memory"], filters={"user_id": uid, "agent_id": where}, top_k=2, threshold=DUPLICATE)
                if any(other["id"] != fact["id"] for other in near.get("results", [])):
                    await m.delete(fact["id"])  # a small model often re-adds what it already knows in other words
                    copies.append(fact["id"])
            purge(memory_ids=copies)
    except Exception as e:
        log.warning("memory add failed user=%s: %r", uid, e)

async def recall(uid: str, query: str, project_id: str | None = None, floor: float = 0.0) -> list:
    """Every fact relevant to a question, most relevant first: as close in meaning as `floor` or closer (the caller
    passes the user's own line for "related", pipeline/links.py). Inside a project: the project's and the user's;
    outside: all of them. The caller keeps as many as fit."""
    if not enabled() or not query.strip():
        return []
    try:
        m = await _get()
        scopes = [{"user_id": uid, "agent_id": scope(project_id)}, {"user_id": uid, "agent_id": PROFILE}] if project_id else [{"user_id": uid}]
        found = []
        for f in scopes:
            r = await m.search(query, filters=f, top_k=await _count(uid), threshold=floor)
            found += [(x["score"], x["memory"]) for x in r.get("results", []) if x.get("memory")]
        return list(dict.fromkeys(fact for _, fact in sorted(found, key=lambda x: -x[0])))
    except Exception as e:
        log.warning("memory search failed user=%s: %r", uid, e)
        return []

async def _count(uid: str) -> int:
    """How many facts memory holds for the user (so a search can return all that are relevant)."""
    table = _config()["vector_store"]["config"]["collection_name"]
    async with Session() as s:
        return max(1, (await s.execute(text(f"SELECT count(*) FROM {table} WHERE payload->>'user_id' = :u"), {"u": uid})).scalar() or 0)

async def everything(uid: str, limit: int = 500) -> list:
    """Every fact kept about this user, with the note and project it came from."""
    if not enabled():
        return []
    m = await _get()
    r = await m.get_all(filters={"user_id": uid}, top_k=limit)
    out = []
    for x in r.get("results", []):
        meta = x.get("metadata") or {}
        where = x.get("agent_id") or PROFILE
        out.append({"id": x["id"], "memory": x["memory"], "created_at": x.get("created_at"), "updated_at": x.get("updated_at"),
                    "note_id": meta.get("note_id"), "source": meta.get("source") or ("note" if meta.get("note_id") else ""),
                    "project_id": where.removeprefix("project:") if where.startswith("project:") else None})
    return out

async def forget(uid: str, mid: str) -> bool:
    """Delete one fact, if it's this user's."""
    if not enabled():
        return False
    m = await _get()
    got = await m.get(mid)
    if not got or got.get("user_id") != uid:
        return False
    await m.delete(mid)
    purge(memory_ids=[mid])
    return True

async def forget_all(uid: str) -> None:
    """Delete every fact about this user (notes stay)."""
    if not enabled():
        return
    m = await _get()
    ids = [x["id"] for x in (await m.get_all(filters={"user_id": uid}, top_k=5000)).get("results", [])]
    await m.delete_all(user_id=uid)
    purge(uid, ids)

async def forget_note(uid: str, nid: str) -> None:
    """Delete the facts first learned from a note that was deleted."""
    if not enabled():
        return
    try:
        m = await _get()
        r = await m.get_all(filters={"user_id": uid, "note_id": nid}, top_k=100)
        for x in r.get("results", []):
            await m.delete(x["id"])
        purge(memory_ids=[x["id"] for x in r.get("results", [])])
    except Exception as e:
        log.warning("memory forget failed note=%s: %r", nid, e)
