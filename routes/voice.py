# voice routes: shhh... listening (with permission).
"""Voice → text, with the audio kept in S3 (core/storage.py).

Flow (Whisper upload tier, notes/page.tsx):
  stop recording → POST /voice/transcribe (audio + duration_ms)
    ├ _store_clip():  S3 upload → INSERT recordings row (s3_url, presigned_url, uploaded_at …)
    └ Whisper on the same bytes                       ← both run in parallel
  → {transcript, recording_id} → draft → Save (POST /notes) links the clip to the note
  → BackgroundTask _finalize writes status + transcript onto the row.
Failure rules: upload fails → no row, transcript still returned (recording_id null);
row insert fails → uploaded object deleted; Whisper fails but audio stored → 502 with
recording_id so the UI offers Retry (POST /voice/recordings/{id}/retry reads it back).
After that a recording is just text: it's saved with POST /notes like a typed note and goes through the same pipeline.

Save-and-go (the default from the Record button): POST /voice/notes stores the clip and answers at once with a job id;
transcribing, saving (or carrying out a spoken instruction) and the pipeline run in the background, and the page
follows the job with GET /voice/jobs/{id} until the note is there.
"""
import asyncio
import logging
import os
import tempfile
import uuid
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Request, Response, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text as sql  # alias: `text` would clash with transcript variables
from sqlalchemy.ext.asyncio import AsyncSession
from core import storage
from core.auth import current_user
from core.config import settings
from core.llm import Unavailable
from core.text import is_uuid
from core.transcribe import available, transcribe
from db.session import Session, engine, get_session
from pipeline.entities import spelling_hint
from pipeline.ingest import ingest
from routes.notes import save_text

router = APIRouter(prefix="/voice")
log = logging.getLogger("bigbutter.voice")

@router.get("/status")
async def status(uid: str = Depends(current_user)):
    # Report which voice/AI engines are configured so the UI picks a tier without guessing.
    return {"openai": bool(settings.openai_api_key), "wispr": bool(settings.wispr_api_key),
            "transcribe": settings.transcribe_engine, "embed": settings.embed_engine, "llm": settings.llm_engine,
            "storage": storage.enabled()}

# Used by: transcribe_audio() + retry() — Whisper needs a file, so bytes go via a temp file.
async def _transcribe_bytes(data: bytes, ext: str, words: str = "") -> tuple:
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:  # whisper needs a file path
        tmp.write(data)
        path = tmp.name
    try:
        return await transcribe(path, words)
    finally:
        os.unlink(path)  # temp copy never outlives the request

# Used by: transcribe_audio (row insert), _finalize — single-statement writes.
async def _exec(q: str, p: dict) -> None:
    # One autocommit statement = one round trip. Neon is ~300ms away, so the voice hot
    # path pays for one trip (hidden behind Whisper) instead of BEGIN/INSERT/COMMIT.
    async with engine.connect() as c:
        c = await c.execution_options(isolation_level="AUTOCOMMIT")
        await c.execute(sql(q), p)

# Used by: transcribe_audio via BackgroundTasks (after the response is sent).
async def _finalize(rid: str, ok: bool, words: str, engine_name: str, err: str) -> None:
    # After the response: settle status/transcript. Never downgrades a clip the user already saved (note_id set).
    try:
        await _exec("UPDATE recordings SET status=CASE WHEN note_id IS NULL THEN :st ELSE status END, "
                    "transcript=:t, engine=:e, error=:er WHERE id=CAST(:i AS uuid)",
                    {"st": "transcribed" if ok else "failed", "t": words, "e": engine_name, "er": err, "i": rid})
    except Exception as e:  # row stays 'uploading' (all URL fields already set); still linkable
        log.warning("finalize failed rid=%s: %r", rid, e)

# Used by: retry() — ownership check before touching a clip.
async def _own_recording(s: AsyncSession, uid: str, rid: str):
    # Recording row owned by this user, or None (bad uuid / other user's / missing).
    if not is_uuid(rid):
        return None
    return (await s.execute(sql("SELECT id, s3_key, note_id, presigned_url, presigned_expires_at FROM recordings "
                                "WHERE id=CAST(:i AS uuid) AND user_id=:u"),
                            {"i": rid, "u": uid})).mappings().first()

async def _read_clip(req: Request, audio: UploadFile) -> tuple:
    """The uploaded clip → (bytes, mime, file extension, None), or (…, (status code, error)) when it can't be used:
    empty, over AUDIO_MAX_MB, or a type we can't transcribe."""
    limit = settings.audio_max_mb * 1024 * 1024
    if int(req.headers.get("content-length") or 0) > limit + 64 * 1024:  # declared too big → refuse before reading (+form overhead)
        return b"", "", "", (413, "too_large")
    data = await audio.read(limit + 1)  # never hold more than the limit (+1 byte to detect overflow) in memory
    if not data:
        return b"", "", "", (400, "empty_audio")
    if len(data) > limit:
        return b"", "", "", (413, "too_large")
    mime = (audio.content_type or "audio/webm").split(";")[0].strip().lower()  # drop ";codecs=opus"
    ext = storage.AUDIO_EXT.get(mime)
    if not ext:
        return b"", "", "", (415, "unsupported_audio")
    return data, mime, ext, None

async def _store_clip(uid: str, rid: str, key: str, data: bytes, mime: str, duration_ms: int) -> bool:
    """Upload the clip, then write its row with every mandatory field (row exists ⇔ object exists). → whether it was
    kept (False when storage is off)."""
    if not key:
        return False
    await run_in_threadpool(storage.put_audio, key, data, mime)
    try:
        url, exp = storage.presign_get(key)  # local signing, no network
        await _exec("INSERT INTO recordings (id, user_id, s3_key, mime, size_bytes, duration_ms, "
                    "s3_url, presigned_url, presigned_expires_at, uploaded_at) "
                    "VALUES (CAST(:i AS uuid), :u, :k, :m, :b, :d, :su, :pu, :pe, now())",
                    {"i": rid, "u": uid, "k": key, "m": mime, "b": len(data), "d": max(0, min(duration_ms, 3_600_000)),
                     "su": storage.object_url(key), "pu": url, "pe": exp})
    except Exception:
        await run_in_threadpool(storage.delete, [key])  # object without a row → remove it
        raise
    return True

# Used by: Tier-2 voice (upload) in notes/page.tsx startUpload/stopRecorder.
# Flow: mic → MediaRecorder → POST here (audio + duration_ms) → S3 upload ∥ Whisper from the same
# bytes → {transcript, recording_id} → editable draft → Save links the recording (POST /notes).
# S3 off → same as before (transcript only, recording_id null). Failure rules: module docstring.
@router.post("/transcribe")
async def transcribe_audio(req: Request, resp: Response, tasks: BackgroundTasks, audio: UploadFile = File(...),
                           duration_ms: int = Form(0), uid: str = Depends(current_user)):
    """Store the clip in S3 and transcribe it at the same time; returns text + recording id."""
    if not available():
        resp.status_code = 501  # keyless → frontend shows "not configured", keeps Tier-3 browser dictation
        return {"error": "not_configured"}
    data, mime, ext, problem = await _read_clip(req, audio)
    if problem:
        resp.status_code = problem[0]
        return {"error": problem[1]}
    rid = str(uuid.uuid4())
    key = storage.audio_key(uid, rid, ext) if storage.enabled() else ""
    # Store chain (S3 ~0.1s → row ~0.3s) runs alongside Whisper; the row lands before the response so Save can link it.
    st, tx = await asyncio.gather(_store_clip(uid, rid, key, data, mime, duration_ms), _transcribe_bytes(data, ext, await spelling_hint(uid)), return_exceptions=True)
    stored = st is True
    ok = not isinstance(tx, BaseException)
    words, engine_name = tx if ok else ("", "")
    if key and not stored:
        log.warning("recording not kept rid=%s: %r", rid, st)  # transcript still returned
    if stored:  # settle status/transcript after responding
        tasks.add_task(_finalize, rid, ok, words, engine_name, "" if ok else type(tx).__name__)
    if ok:
        return {"transcript": words, "engine": engine_name, "recording_id": rid if stored else None}
    log.warning("transcribe failed rid=%s stored=%s: %r", rid, stored, tx)
    if isinstance(tx, Unavailable) and not stored:
        resp.status_code = 501
        return {"error": "not_configured"}
    resp.status_code = 502  # recording_id set → audio safe in S3 → UI offers Retry
    return {"error": "transcribe_failed", "recording_id": rid if stored else None}

# Used by: Retry on the "Couldn't transcribe — your audio is saved" notice (notes/page.tsx).
# The only normal path that reads audio back from S3.
@router.post("/recordings/{rid}/retry")
async def retry(rid: str, resp: Response, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Re-transcribe a stored clip — pulls the audio back from S3."""
    row = await _own_recording(s, uid, rid)
    if not row or not storage.enabled():
        raise HTTPException(404)
    if not available():
        resp.status_code = 501
        return {"error": "not_configured"}
    try:
        data = await run_in_threadpool(storage.get_audio, row["s3_key"])
        words, engine = await _transcribe_bytes(data, os.path.splitext(row["s3_key"])[1] or ".webm", await spelling_hint(uid))
    except Exception as e:
        log.warning("retry failed rid=%s: %r", rid, e)
        await s.execute(sql("UPDATE recordings SET error=:er WHERE id=CAST(:i AS uuid)"), {"er": type(e).__name__, "i": rid})
        await s.commit()
        resp.status_code = 502
        return {"error": "transcribe_failed", "recording_id": rid}
    await s.execute(sql("UPDATE recordings SET status=CASE WHEN note_id IS NULL THEN 'transcribed' ELSE status END, "
                        "transcript=:t, engine=:e, error='' WHERE id=CAST(:i AS uuid)"),
                    {"t": words, "e": engine, "i": rid})
    await s.commit()
    return {"transcript": words, "engine": engine, "recording_id": rid}

# Used by: Tier-1 voice (live streaming) in notes/page.tsx startWispr + lib/voice-wispr.ts.
# Flow: frontend POSTs here (empty JSON) → gets short-lived {access_token, ws_url} →
# opens WS to Wispr directly (auth → append PCM chunks → commit) → live transcript.
# Why a backend route at all: the long-lived org key (WISPR_API_KEY) must never reach
# the browser; this mints a 1-hour user-scoped client token instead. No key → 501,
# and the UI steps down to Tier-2 upload. Wispr API down → 502 provider_error.
@router.post("/token")
async def mint_token(resp: Response, uid: str = Depends(current_user)):
    """Mint a short-lived Wispr client token. Org key never leaves the backend."""
    if not settings.wispr_api_key:
        resp.status_code = 501
        return {"error": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                "https://platform-api.wisprflow.ai/api/v1/dash/generate_access_token",
                headers={"Authorization": f"Bearer {settings.wispr_api_key}"},
                json={"client_id": uid, "duration_secs": 3600},
            )
        if r.status_code != 200:
            resp.status_code = 502
            return {"error": "provider_error"}
        body = r.json()
        return {"access_token": body["access_token"], "expires_in": body.get("expires_in", 3600),
                "ws_url": settings.wispr_ws_url}
    except httpx.HTTPError:
        resp.status_code = 502
        return {"error": "provider_error"}


# Save-and-go voice notes: job id (= recording id) → {user, state: transcribing | done | failed, note_id, did, error}.
# In memory: a job lives a few seconds; after a restart the note is simply there (or the clip waits for Retry).
_jobs: dict = {}

@router.post("/notes")
async def voice_note(req: Request, resp: Response, audio: UploadFile = File(...), duration_ms: int = Form(0),
                     project_id: str = Form(""), uid: str = Depends(current_user)):
    """Save a recording as a note without waiting: store the clip, answer with a job id, and transcribe → save (or
    carry out what was asked) → read the note in the background."""
    if not available():
        resp.status_code = 501
        return {"error": "not_configured"}
    data, mime, ext, problem = await _read_clip(req, audio)
    if problem:
        resp.status_code = problem[0]
        return {"error": problem[1]}
    pid = project_id if is_uuid(project_id) else None
    rid = str(uuid.uuid4())
    key = storage.audio_key(uid, rid, ext) if storage.enabled() else ""
    await _store_clip(uid, rid, key, data, mime, duration_ms)  # kept first, so nothing said is lost even if transcribing fails
    _jobs[rid] = {"user": uid, "state": "transcribing", "note_id": None, "did": [], "error": ""}
    asyncio.create_task(_voice_job(uid, rid, data, ext, pid, stored=bool(key)))
    return {"recording_id": rid}

async def _voice_job(uid: str, rid: str, data: bytes, ext: str, pid: str | None, stored: bool) -> None:
    """Transcribe the clip, then save it like a typed note (instructions carried out), then read it."""
    job = _jobs[rid]
    try:
        words, engine_name = await _transcribe_bytes(data, ext, await spelling_hint(uid))
    except Exception as e:
        log.warning("voice note: transcribe failed rid=%s: %r", rid, e)
        if stored:
            await _finalize(rid, False, "", "", type(e).__name__)
        job.update(state="failed", error="transcribe_failed" if stored else "lost")
        return
    if stored:
        await _finalize(rid, True, words, engine_name, "")
    if not words.strip():
        job.update(state="failed", error="no_speech")
        return
    try:
        async with Session() as s:
            out = await save_text(s, uid, words, "voice", [rid] if stored else [], pid,
                                  lambda nid: asyncio.create_task(ingest(uid, nid)))
        job.update(state="done", note_id=out.get("id"), did=out.get("did") or [])
    except Exception as e:
        log.exception("voice note: save failed rid=%s", rid)
        job.update(state="failed", error=type(e).__name__)

@router.get("/jobs/{rid}")
async def voice_job(rid: str, uid: str = Depends(current_user)):
    """How a save-and-go voice note is getting on: transcribing → done (note_id, and what an instruction did) or failed."""
    job = _jobs.get(rid)
    if not job or job["user"] != uid:
        raise HTTPException(404)
    out = {k: v for k, v in job.items() if k != "user"}
    if job["state"] == "done":  # seen: forget it (a failed one stays until retried)
        _jobs.pop(rid, None)
    return out
