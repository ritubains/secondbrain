"""Find the notes a question is about, most relevant first, judged the way notes are connected (pipeline/links.py:
meaning, names and words, on the user's own scale). Inside a project its relevant notes come first; a question that
names a time span ("this week") looks only there and takes that span's notes; one that names a topic takes the
topic's notes.

With `room` (characters, for the chat): the notes the question matches directly also bring the notes connected to
them. A note reached that way counts as much as both steps together (the question's score for the first note times
the connection's) and must pass the same line as any other; the notes then go in best first until they fill the room
(which bounds them, it isn't a target). Without `room` (the search box): the notes found directly, all of them."""
from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.llm import Unavailable, embed
from core.when import window
from db.queries import notes_by_id
from pipeline import entities, links

# Text as its words, lower case, one space around each ("Election-strategy!" → " election strategy "), so a name is
# found in a question only as whole words.
WORDS = "(' ' || trim(regexp_replace(lower({}), '[^[:alnum:]]+', ' ', 'g')) || ' ')"

async def find(s: AsyncSession, uid: str, question: str, project_id: str | None = None, room: int | None = None) -> list:
    """The notes that answer a question, best first, each with why it was picked."""
    known = await entities.recognize(s, uid, question)
    try:
        vec = await embed(question)
    except Unavailable:
        vec = None
    days = window(question)
    since = datetime.now(timezone.utc) - timedelta(days=days) if days else None
    hits = await links.related_to_question(s, uid, vec, [e["id"] for e in known], words=question, since=since)
    if project_id and hits:
        in_project = {str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM notes WHERE user_id = :u AND project_id = :p AND id = ANY(CAST(:ids AS uuid[]))"),
            {"u": uid, "p": project_id, "ids": [h["id"] for h in hits]})).all()}
        hits.sort(key=lambda h: (h["id"] not in in_project, -h["score"]))
    picked = {h["id"]: _why(h) for h in hits}
    for nid, name in await _topic_notes(s, uid, question):  # "my election strategy notes": the whole topic
        picked.setdefault(nid, f"in topic {name}")
    if days or project_id:  # "what happened this week?": the notes of that span (or project), newest first
        for nid in await _recent(s, uid, project_id, since):
            picked.setdefault(nid, "recent")
    if room is not None:
        picked = await _fill(s, uid, picked, {h["id"]: h["score"] for h in hits}, room)
    notes = await notes_by_id(s, uid, list(picked))
    for n in notes:
        n["why"] = picked[n["id"]]
    return notes

async def _fill(s: AsyncSession, uid: str, found: dict, direct: dict, room: int) -> dict:
    """The notes found, in order, then the notes connected to the direct matches (`direct`: id → score) that still
    pass when reached through them, best first, until their text fills `room`."""
    out: dict = {}
    used = 0
    for nid, why in found.items():
        if used >= room:
            return out
        out[nid] = why
        used += await _size(s, nid)
    through: dict = {}  # id → (score through the best direct match, why)
    for nid, score in direct.items():
        for c in await links.related_to_note(s, uid, nid):
            chained = score * c["score"]
            if c["id"] not in found and chained >= links.CONNECTED and chained > through.get(c["id"], (0.0, ""))[0]:
                through[c["id"]] = (chained, "connected" + (f" via {', '.join(c['shared'][:2])}" if c["shared"] else ""))
    for cid, (_, why) in sorted(through.items(), key=lambda x: -x[1][0]):
        if used >= room:
            break
        out[cid] = why
        used += await _size(s, cid)
    return out

async def _size(s: AsyncSession, nid: str) -> int:
    """How many characters a note takes in the chat's context (its title and text)."""
    return (await s.execute(text("SELECT length(title) + length(raw_text) FROM notes WHERE id = :n"), {"n": nid})).scalar() or 0

async def _topic_notes(s: AsyncSession, uid: str, question: str) -> list:
    """Notes of the topics a question names ("election strategy" in "what's my election strategy?"): [(id, topic)]."""
    rows = (await s.execute(text(
        "SELECT t.name, nt.note_id FROM topics t JOIN note_topics nt ON nt.topic_id = t.id JOIN notes n ON n.id = nt.note_id "
        f"WHERE t.user_id = :u AND {WORDS.format('t.name')} <> ' ' AND {WORDS.format(':q')} LIKE '%' || {WORDS.format('t.name')} || '%' "
        "ORDER BY n.created_at DESC"), {"u": uid, "q": question})).all()
    return [(str(note_id), name) for name, note_id in rows]

def _why(hit: dict) -> str:
    """A short reason a note matched: the names it shares, or that it's close in meaning or wording."""
    if hit["shared"]:
        return "mentions " + ", ".join(hit["shared"][:3])
    return "similar in meaning" if hit["meaning"] >= hit["words"] else "matching words"

async def _recent(s: AsyncSession, uid: str, project_id: str | None, since: datetime | None) -> list:
    """Ids of the notes in a project and/or time span, newest first."""
    rows = (await s.execute(text(
        "SELECT id FROM notes WHERE user_id = :u AND (CAST(:p AS uuid) IS NULL OR project_id = CAST(:p AS uuid)) "
        "AND (CAST(:since AS timestamptz) IS NULL OR created_at >= :since) ORDER BY created_at DESC"),
        {"u": uid, "p": project_id, "since": since})).all()
    return [str(r[0]) for r in rows]
