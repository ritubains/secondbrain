"""Notes: save (typed or transcribed — the same request), list, read, edit, delete, search. Saving replies at once;
the pipeline (pipeline/ingest.py) fills in the rest in the background, and the page polls enrich_state. Text that is
an instruction ("create project X and put this note in it") is carried out instead (pipeline/commands.py).
A note's bucket is its category, filed by the AI (pipeline/clusters.py)."""
import base64
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from chat import retrieve
from core import buckets as bk
from core import memory, storage
from core.auth import current_user
from core.text import is_uuid
from db.queries import NOTE_COLUMNS, note_row
from db.session import get_session
from pipeline import clusters, commands, entities, links, topics
from pipeline.ingest import ingest

router = APIRouter()
log = logging.getLogger("bigbutter.notes")

class NoteIn(BaseModel):
    raw_text: str
    source: str = "typed"           # "voice" when it came from a recording
    recording_ids: List[str] = []   # the voice clips behind it (POST /voice/transcribe)
    project_id: Optional[str] = None

class NoteUpdate(BaseModel):
    raw_text: Optional[str] = None  # new text → the pipeline runs again
    title: Optional[str] = None
    tags: Optional[list[str]] = None
    place: Optional[str] = None     # the place the note is about; "" = none
    project_id: Optional[str] = None  # "" = no project
    pinned: Optional[bool] = None
    starred: Optional[bool] = None  # important
    done: Optional[bool] = None

async def _own_project(s: AsyncSession, uid: str, pid: Optional[str]) -> Optional[str]:
    """The project id if it's one of this user's, None for no project; 404 for anything else."""
    if not pid:
        return None
    if not is_uuid(pid) or not (await s.execute(text("SELECT 1 FROM projects WHERE id = :p AND user_id = :u"), {"p": pid, "u": uid})).first():
        raise HTTPException(404, "no such project")
    return pid

@router.post("/notes")
async def create(n: NoteIn, tasks: BackgroundTasks, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Save a note — typed, or the transcript of a recording — and link its voice clips. The pipeline runs after the
    reply. When the text is (or includes) an instruction, that's done first: the reply has "did" (what was done), and
    "id" is None when there was no note in it."""
    if not n.raw_text.strip():
        raise HTTPException(422, "empty note")
    pid = await _own_project(s, uid, n.project_id)
    return await save_text(s, uid, n.raw_text, n.source, n.recording_ids, pid, lambda nid: tasks.add_task(ingest, uid, nid))

async def save_text(s: AsyncSession, uid: str, raw: str, source: str, clips: list, pid: Optional[str], run) -> dict:
    """Carry out any instruction in the text, then save what's left as a note with its clips → the note (with "did"),
    or {"id": None, "did": [...]} when it was only an instruction. run(note_id) starts the pipeline. Shared by typed
    notes and voice notes transcribed in the background (routes/voice.py)."""
    asked = await commands.understand(s, uid, raw)
    did, mine = [], {}
    if asked:
        mine, did = await commands.carry_out(s, uid, asked)
        if not asked["note"]:
            await s.commit()
            return {"id": None, "did": did}
        raw, pid = asked["note"], mine.get("project_id") or pid
    clips = [i for i in dict.fromkeys(clips) if is_uuid(i)][:20]
    row = (await s.execute(text(
        "INSERT INTO notes (user_id, raw_text, source, project_id, pinned, starred, enrich_state) "
        "VALUES (:u, :t, :src, :p, :pin, :star, 'pending') RETURNING id"),
        {"u": uid, "t": raw.strip(), "src": "voice" if clips else source, "p": pid,
         "pin": bool(mine.get("pinned")), "star": bool(mine.get("starred"))})).first()
    nid = str(row[0])
    if clips:
        await s.execute(text("UPDATE recordings SET note_id = :n, status = 'attached' WHERE user_id = :u AND note_id IS NULL "
                             "AND id = ANY(CAST(:ids AS uuid[]))"), {"n": nid, "u": uid, "ids": clips})
    await s.commit()
    run(nid)
    return {**await _one(s, uid, nid), "did": did}

def _cursor(r: dict) -> str:
    """Opaque "next batch" position (keeps created_at's microseconds, which a JS Date would round)."""
    return base64.urlsafe_b64encode(f"{r['created_at'].isoformat()}|{r['id']}".encode()).decode().rstrip("=")

def _uncursor(c: str) -> tuple:
    """The position inside a cursor, or 400."""
    try:
        at, nid = base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)).decode().split("|", 1)
        when = datetime.fromisoformat(at)
        if when.tzinfo is None or not is_uuid(nid):
            raise ValueError
        return when, nid
    except Exception:
        raise HTTPException(400, "bad cursor")

@router.get("/notes")
async def list_notes(per: int = 10, sort: str = "new", bucket: Optional[str] = None, project_id: Optional[str] = None, topic_id: Optional[str] = None,
                     pinned: Optional[bool] = None, cursor: Optional[str] = None,
                     uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """One batch of notes, newest (or oldest) first, optionally in a bucket / project / topic, or pinned only."""
    per = max(1, min(per, 50))
    order = "ASC" if sort == "old" else "DESC"
    where = ["n.user_id = :u"]
    args = {"u": uid, "lim": per + 1, "b": bucket, "p": project_id, "t": topic_id}
    if bucket:
        where.append(f"coalesce(nullif(n.bucket, ''), '{bk.OTHER}') = :b")
    if project_id:
        where.append("n.project_id = CAST(:p AS uuid)")
    if topic_id and is_uuid(topic_id):
        where.append("n.id IN (SELECT note_id FROM note_topics WHERE topic_id = CAST(:t AS uuid))")
    if pinned:
        where.append("n.pinned")
    if cursor:
        args["c"], args["i"] = _uncursor(cursor)
        where.append(f"(n.created_at, n.id) {'<' if order == 'DESC' else '>'} (:c, CAST(:i AS uuid))")
    rows = (await s.execute(text(f"SELECT {NOTE_COLUMNS} FROM notes n WHERE {' AND '.join(where)} "
                                 f"ORDER BY n.created_at {order}, n.id {order} LIMIT :lim"), args)).mappings().all()
    items = [note_row(r) for r in rows[:per]]
    return {"items": items, "next_cursor": _cursor(rows[per - 1]) if len(rows) > per else None}

@router.get("/notes/stats")
async def stats(uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Totals for the sidebar and the bucket chips."""
    counts = dict((await s.execute(text(f"SELECT coalesce(nullif(bucket, ''), '{bk.OTHER}'), count(*) FROM notes WHERE user_id = :u GROUP BY 1"),
                                   {"u": uid})).all())
    # The categories are learned (pipeline/clusters.py): the ones notes are in, biggest first.
    return {"total": sum(counts.values()), "buckets": counts, "bucket_names": sorted(counts, key=lambda b: (b == bk.OTHER, -counts[b]))}

@router.get("/search")
async def search(q: str, project_id: Optional[str] = None, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The Notes search box: notes about the words typed, by meaning, entities and words — no AI call, so it's quick."""
    notes = await retrieve.find(s, uid, q[:300], project_id)
    return {"notes": notes, "matched_ids": [n["id"] for n in notes]}

async def _one(s: AsyncSession, uid: str, nid: str) -> dict:
    """A note with what the pipeline found: entities, items, connected notes (with why), voice clips."""
    row = (await s.execute(text(f"SELECT {NOTE_COLUMNS} FROM notes n WHERE n.user_id = :u AND n.id = :n"), {"u": uid, "n": nid})).mappings().first()
    if not row:
        raise HTTPException(404)
    note = note_row(row)
    note["entities"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT e.id, e.kind, e.name, e.meaning, ne.seen_as, ne.main FROM note_entities ne JOIN entities e ON e.id = ne.entity_id "
        "WHERE ne.note_id = :n ORDER BY ne.main DESC, e.kind, e.name"), {"n": nid})).mappings().all()]
    note["items"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT id, kind, text, who, topic, due_at, due_has_time, done_at FROM note_items WHERE note_id = :n AND dismissed_at IS NULL "
        "ORDER BY kind, due_at NULLS LAST"), {"n": nid})).mappings().all()]
    note["connected"] = await _connected(s, uid, nid)
    note["recordings"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT id, duration_ms, recorded_at FROM recordings WHERE note_id = :n ORDER BY recorded_at"), {"n": nid})).mappings().all()]
    return note

async def _connected(s: AsyncSession, uid: str, nid: str) -> list:
    """The notes connected to this one, closest first, with why (pipeline/links.py)."""
    hits = await links.related_to_note(s, uid, nid)
    rows = {str(r["id"]): r for r in (await s.execute(text(
        "SELECT id, title, raw_text, created_at FROM notes WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [h["id"] for h in hits]})).mappings().all()}
    return [{**h, "title": rows[h["id"]]["title"], "raw_text": rows[h["id"]]["raw_text"], "created_at": rows[h["id"]]["created_at"]} for h in hits if h["id"] in rows]

@router.get("/filing/done")
async def filing_done(uid: str = Depends(current_user)):
    """Answers once the AI has finished filing the user's notes (at once if it isn't), so the screens reload then."""
    await clusters.settled(uid)
    return {"ok": True}

@router.get("/notes/{nid}")
async def read(nid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """One note in full."""
    if not is_uuid(nid):
        raise HTTPException(404)
    return await _one(s, uid, nid)

@router.put("/notes/{nid}")
async def update(nid: str, n: NoteUpdate, tasks: BackgroundTasks, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a note. New text runs the pipeline again in the background (a title typed with it is kept);
    everything else is saved as given."""
    if not is_uuid(nid) or not (await s.execute(text("SELECT 1 FROM notes WHERE id = :n AND user_id = :u"), {"n": nid, "u": uid})).first():
        raise HTTPException(404)
    fields: dict = {}
    if n.tags is not None:
        fields["tags"] = list(dict.fromkeys(t.strip().lower() for t in n.tags if t.strip()))[:12]
    if n.title is not None and n.title.strip():
        fields["title"] = n.title.strip()[:120]
    if n.project_id is not None:
        fields["project_id"] = await _own_project(s, uid, n.project_id)
    if n.pinned is not None:
        fields["pinned"] = n.pinned
    if n.starred is not None:
        fields["starred"] = n.starred
    if n.raw_text is not None and n.raw_text.strip():
        fields["raw_text"], fields["enrich_state"], fields["formatted"] = n.raw_text.strip(), "pending", ""  # laid out again when read
    for column, value in fields.items():  # column names come from the code above, never from the request
        await s.execute(text(f"UPDATE notes SET {column} = :v, updated_at = now() WHERE id = :n"), {"v": value, "n": nid})
    if n.done is not None:
        await s.execute(text("UPDATE notes SET done_at = CASE WHEN :d THEN coalesce(done_at, now()) END WHERE id = :n"), {"d": n.done, "n": nid})
    if n.place is not None:
        await entities.set_place(s, uid, nid, n.place[:80])
    await s.commit()
    if "raw_text" in fields:
        tasks.add_task(ingest, uid, nid, fields.get("title"))
    return await _one(s, uid, nid)

@router.delete("/notes/{nid}")
async def delete(nid: str, tasks: BackgroundTasks, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a note with everything learned only from it: its links, items, clips (and audio), and memory facts."""
    if not is_uuid(nid):
        raise HTTPException(404)
    keys = (await s.execute(text("SELECT s3_key FROM recordings WHERE note_id = :n AND user_id = :u"), {"n": nid, "u": uid})).scalars().all()
    await s.execute(text("DELETE FROM notes WHERE id = :n AND user_id = :u"), {"n": nid, "u": uid})
    await entities.recount(s, uid)
    await topics.prune(s, uid)
    await s.commit()
    clusters.schedule(uid)  # the ideas regroup without it
    tasks.add_task(memory.forget_note, uid, nid)
    if keys and storage.enabled():
        try:
            await run_in_threadpool(storage.delete, list(keys))
        except Exception as e:  # the note is gone either way; the orphaned object is logged
            log.warning("audio delete failed for note %s keys=%s: %r", nid, list(keys), e)
    return {"ok": True}
