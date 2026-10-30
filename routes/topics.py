"""Topics: every subject the user's notes keep coming back to, with all its notes. A note can be in several topics.
The pipeline puts notes in topics; the user can rename, merge or delete topics, add or remove a topic on a note,
and turn a topic into a project."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.auth import current_user
from core.text import is_uuid, key
from core.when import BEFORE, RECENT, trend
from db.queries import NOTE_COLUMNS, note_row
from db.session import get_session
from pipeline import topics

router = APIRouter()

class TopicName(BaseModel):
    name: str

class Merge(BaseModel):
    into: str            # the topic that stays

class ToProject(BaseModel):
    project_id: Optional[str] = None   # an existing project; none = a new project named after the topic

TOPIC_COLUMNS = (
    "t.id, t.name, t.origin, t.parent_id, t.updated_at, count(nt.note_id) AS notes, max(n.created_at) AS last, "
    f"count(*) FILTER (WHERE n.created_at > now() - interval '{RECENT} days') AS recent, "
    f"count(*) FILTER (WHERE n.created_at <= now() - interval '{RECENT} days' AND n.created_at > now() - interval '{RECENT + BEFORE} days') AS before")

def _topic(r) -> dict:
    """A topic row → dict with its trend."""
    d = dict(r, id=str(r["id"]), parent_id=str(r["parent_id"]) if r["parent_id"] else None)
    d["trend"] = trend(d.pop("recent"), d.pop("before"))
    return d

async def _get(s: AsyncSession, uid: str, tid: str) -> dict:
    """The user's topic, or 404."""
    row = (await s.execute(text(
        f"SELECT {TOPIC_COLUMNS} FROM topics t LEFT JOIN note_topics nt ON nt.topic_id = t.id LEFT JOIN notes n ON n.id = nt.note_id "
        "WHERE t.id = :t AND t.user_id = :u GROUP BY t.id"), {"t": tid, "u": uid})).mappings().first() if is_uuid(tid) else None
    if not row:
        raise HTTPException(404)
    return _topic(row)

@router.get("/topics")
async def list_topics(uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Every topic with how many notes, when last, and whether it's growing — most notes first."""
    rows = (await s.execute(text(
        f"SELECT {TOPIC_COLUMNS} FROM topics t LEFT JOIN note_topics nt ON nt.topic_id = t.id LEFT JOIN notes n ON n.id = nt.note_id "
        "WHERE t.user_id = :u GROUP BY t.id ORDER BY count(nt.note_id) DESC, max(n.created_at) DESC NULLS LAST"), {"u": uid})).mappings().all()
    return {"topics": [_topic(r) for r in rows]}

@router.get("/topics/{tid}")
async def read_topic(tid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """A topic with all its notes (newest first), the people and places in them, and topics that go with it."""
    topic = await _get(s, uid, tid)
    topic["note_list"] = [note_row(r) for r in (await s.execute(text(
        f"SELECT {NOTE_COLUMNS} FROM notes n JOIN note_topics nt ON nt.note_id = n.id WHERE nt.topic_id = :t ORDER BY n.created_at DESC"),
        {"t": tid})).mappings().all()]
    topic["entities"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT e.id, e.name, e.kind, count(*) AS notes FROM note_topics nt JOIN note_entities ne ON ne.note_id = nt.note_id "
        "JOIN entities e ON e.id = ne.entity_id WHERE nt.topic_id = :t AND e.kind <> 'term' GROUP BY e.id ORDER BY notes DESC LIMIT 10"),
        {"t": tid})).mappings().all()]
    topic["related"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT o.id, o.name, count(*) AS notes FROM note_topics a JOIN note_topics b ON b.note_id = a.note_id AND b.topic_id <> a.topic_id "
        "JOIN topics o ON o.id = b.topic_id WHERE a.topic_id = :t GROUP BY o.id ORDER BY notes DESC LIMIT 6"), {"t": tid})).mappings().all()]
    return topic

@router.post("/topics")
async def create_topic(body: TopicName, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """A topic the user names (it then attracts notes about it as they're read)."""
    name = " ".join(body.name.split())[:60]
    if not key(name):
        raise HTTPException(422, "a topic needs a name")
    tid = (await s.execute(text("INSERT INTO topics (user_id, name, key, origin) VALUES (:u, :n, :k, 'you') "
                                "ON CONFLICT (user_id, level, key) DO UPDATE SET origin = 'you' RETURNING id"), {"u": uid, "n": name, "k": key(name)})).scalar()
    await s.commit()
    return await _get(s, uid, str(tid))

@router.put("/topics/{tid}")
async def rename_topic(tid: str, body: TopicName, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Rename a topic (it's then the user's, kept even with no notes)."""
    await _get(s, uid, tid)
    name = " ".join(body.name.split())[:60]
    if not key(name):
        raise HTTPException(422, "a topic needs a name")
    if (await s.execute(text("SELECT 1 FROM topics WHERE user_id = :u AND key = :k AND id <> :t AND level = (SELECT level FROM topics WHERE id = :t)"),
                        {"u": uid, "k": key(name), "t": tid})).first():
        raise HTTPException(409, "another topic has that name — merge them instead")
    await topics.rename(s, uid, tid, name)
    await s.commit()
    return await _get(s, uid, tid)

@router.post("/topics/{tid}/merge")
async def merge_topic(tid: str, m: Merge, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Two topics are the same subject: move this one's notes into `into`, then delete this one."""
    gone, kept = await _get(s, uid, tid), await _get(s, uid, m.into)
    if gone["id"] == kept["id"]:
        raise HTTPException(422, "that's the same topic")
    await s.execute(text("INSERT INTO note_topics (note_id, topic_id, by_you) SELECT note_id, :k, by_you FROM note_topics WHERE topic_id = :g "
                         "ON CONFLICT DO NOTHING"), {"k": kept["id"], "g": gone["id"]})
    await s.execute(text("DELETE FROM topics WHERE id = :g"), {"g": gone["id"]})
    await s.commit()
    return await _get(s, uid, kept["id"])

@router.delete("/topics/{tid}")
async def delete_topic(tid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a topic (its notes stay)."""
    await _get(s, uid, tid)
    await s.execute(text("DELETE FROM topics WHERE id = :t"), {"t": tid})
    await s.commit()
    return {"ok": True}

@router.post("/notes/{nid}/topics")
async def add_note_topic(nid: str, body: TopicName, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Put a note in a topic by name — an existing one if it matches, else a new one. Kept when the note is read again."""
    if not is_uuid(nid) or not (await s.execute(text("SELECT 1 FROM notes WHERE id = :n AND user_id = :u"), {"n": nid, "u": uid})).first():
        raise HTTPException(404)
    if not key(body.name):
        raise HTTPException(422, "a topic needs a name")
    topic = await topics.find_or_create(s, uid, " ".join(body.name.split())[:60])
    await s.execute(text("INSERT INTO note_topics (note_id, topic_id, by_you) VALUES (:n, :t, true) "
                         "ON CONFLICT (note_id, topic_id) DO UPDATE SET by_you = true"), {"n": nid, "t": topic["id"]})
    await s.commit()
    return topic

@router.delete("/notes/{nid}/topics/{tid}")
async def remove_note_topic(nid: str, tid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Take a note out of a topic."""
    if is_uuid(nid) and is_uuid(tid):
        await s.execute(text("DELETE FROM note_topics nt USING notes n WHERE nt.note_id = n.id AND n.user_id = :u AND nt.note_id = :n AND nt.topic_id = :t"),
                        {"u": uid, "n": nid, "t": tid})
        await topics.prune(s, uid)
        await s.commit()
    return {"ok": True}

@router.post("/topics/{tid}/project")
async def topic_to_project(tid: str, body: ToProject, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Put all of a topic's notes into a project — an existing one, or a new one named after the topic. → {project_id}"""
    topic = await _get(s, uid, tid)
    pid = body.project_id
    if pid:
        if not is_uuid(pid) or not (await s.execute(text("SELECT 1 FROM projects WHERE id = :p AND user_id = :u"), {"p": pid, "u": uid})).first():
            raise HTTPException(404, "no such project")
    else:
        pid = str((await s.execute(text("INSERT INTO projects (user_id, name, description) VALUES (:u, :n, :d) RETURNING id"),
                                   {"u": uid, "n": topic["name"], "d": f"Notes on {topic['name']}"})).scalar())
    await s.execute(text("UPDATE notes SET project_id = :p WHERE user_id = :u AND id IN (SELECT note_id FROM note_topics WHERE topic_id = :t)"),
                    {"p": pid, "u": uid, "t": tid})
    await s.execute(text("UPDATE projects SET updated_at = now() WHERE id = :p"), {"p": pid})
    await s.commit()
    return {"project_id": pid}
