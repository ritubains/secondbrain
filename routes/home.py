"""Home: what needs you and what's moving, built from the structured data the pipeline stores.

  coming_up    events in the next three weeks (and ones just passed, not ticked off)
  waiting      promises not yet kept, oldest first
  recurring    issues raised in more than one note, by subject
  moving       people, places and terms coming up more lately, and ones gone quiet
  topics       the subjects with the most notes lately
  picked_up    notes written lately that connect to one written before then: continue where you left off
  projects     the most recently active projects, and recent conversations
  briefing     a few plain sentences written from the above (in the background; the page never waits)
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import prompts
from core.auth import current_user
from core.llm import Unavailable, chat
from core.text import is_uuid, no_dashes
from core.when import BEFORE, RECENT, trend
from db.session import get_session
from pipeline import links

router = APIRouter()

UPCOMING_DAYS = 21   # how far ahead "Coming up" looks

class ItemsUpdate(BaseModel):
    ids: List[str]
    done: Optional[bool] = None       # promise kept / event happened / task done
    dismissed: Optional[bool] = None  # hide it

_briefings: dict = {}   # facts → text, so one set of facts is written once
_writing: set = set()

@router.get("/home")
async def home(uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Everything Home shows, in one request."""
    now = datetime.now(timezone.utc)
    data = {
        "overview": await _overview(s, uid, now),
        "coming_up": await _coming_up(s, uid, now),
        "waiting": await _waiting(s, uid, now),
        "recurring": await _recurring(s, uid),
        "moving": await _moving(s, uid),
        "topics": await _topics(s, uid),
        "picked_up": await _picked_up(s, uid),
        "projects": await _projects(s, uid),
        "conversations": await _conversations(s, uid),
    }
    data["briefing"], data["briefing_pending"] = _briefing(_facts(data))
    return data

@router.patch("/items")
async def update_items(u: ItemsUpdate, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Tick off or hide promises, issues, events and tasks."""
    ids = [i for i in u.ids if is_uuid(i)][:50]
    if not ids:
        raise HTTPException(422, "no ids")
    if u.done is not None:
        await s.execute(text("UPDATE note_items SET done_at = CASE WHEN :d THEN coalesce(done_at, now()) END "
                             "WHERE user_id = :u AND id = ANY(CAST(:ids AS uuid[]))"), {"d": u.done, "u": uid, "ids": ids})
    if u.dismissed is not None:
        await s.execute(text("UPDATE note_items SET dismissed_at = CASE WHEN :d THEN coalesce(dismissed_at, now()) END "
                             "WHERE user_id = :u AND id = ANY(CAST(:ids AS uuid[]))"), {"d": u.dismissed, "u": uid, "ids": ids})
    await s.commit()
    return {"ok": True}

async def _overview(s: AsyncSession, uid: str, now: datetime) -> dict:
    """The numbers: notes this month vs the month before, open promises, events this week, people and places."""
    r = (await s.execute(text(
        "SELECT (SELECT count(*) FROM notes WHERE user_id = :u) AS notes, "
        "(SELECT count(*) FROM notes WHERE user_id = :u AND created_at > :m1) AS notes_month, "
        "(SELECT count(*) FROM notes WHERE user_id = :u AND created_at <= :m1 AND created_at > :m2) AS notes_prev, "
        "(SELECT count(*) FROM note_items WHERE user_id = :u AND kind = 'promise' AND done_at IS NULL AND dismissed_at IS NULL) AS open_promises, "
        "(SELECT count(*) FROM note_items WHERE user_id = :u AND kind = 'event' AND done_at IS NULL AND dismissed_at IS NULL "
        " AND due_at BETWEEN :now AND :week) AS upcoming_7d, "
        "(SELECT count(*) FROM entities WHERE user_id = :u AND kind IN ('person', 'official', 'group')) AS people, "
        "(SELECT count(*) FROM entities WHERE user_id = :u AND kind = 'place') AS places"),
        {"u": uid, "now": now, "week": now + timedelta(days=7), "m1": now - timedelta(days=30), "m2": now - timedelta(days=60)})).mappings().first()
    return dict(r)

async def _coming_up(s: AsyncSession, uid: str, now: datetime) -> list:
    """Dated things ahead (and the last two days' unticked ones), soonest first, with the place and note."""
    rows = (await s.execute(text(
        "SELECT i.id, i.text, i.due_at, i.due_has_time, i.note_id, n.title, "
        " (SELECT e.name FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = n.id AND e.kind = 'place' "
        "  ORDER BY ne.main DESC LIMIT 1) AS place "
        "FROM note_items i JOIN notes n ON n.id = i.note_id WHERE i.user_id = :u AND i.kind = 'event' AND i.done_at IS NULL "
        "AND i.dismissed_at IS NULL AND i.due_at BETWEEN :from AND :to ORDER BY i.due_at LIMIT 12"),
        {"u": uid, "from": now - timedelta(days=2), "to": now + timedelta(days=UPCOMING_DAYS)})).mappings().all()
    return [dict(r, id=str(r["id"]), note_id=str(r["note_id"])) for r in rows]

async def _waiting(s: AsyncSession, uid: str, now: datetime) -> list:
    """Promises not yet kept, oldest first, with who they were made to and how many days ago."""
    rows = (await s.execute(text(
        "SELECT i.id, i.text, i.who, i.note_id, n.title, n.created_at, "
        " (SELECT e.name FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = n.id AND e.kind = 'place' "
        "  ORDER BY ne.main DESC LIMIT 1) AS place "
        "FROM note_items i JOIN notes n ON n.id = i.note_id WHERE i.user_id = :u AND i.kind = 'promise' AND i.done_at IS NULL "
        "AND i.dismissed_at IS NULL ORDER BY n.created_at LIMIT 10"), {"u": uid})).mappings().all()
    return [dict(r, id=str(r["id"]), note_id=str(r["note_id"]), days=(now - r["created_at"]).days) for r in rows]

async def _recurring(s: AsyncSession, uid: str) -> list:
    """Issues raised in more than one note, grouped by subject: how many notes, where, by how many people, how lately."""
    rows = (await s.execute(text(
        "SELECT i.topic, count(DISTINCT i.note_id) AS notes, max(n.created_at) AS last, "
        " count(DISTINCT w) FILTER (WHERE w IS NOT NULL) AS people, "
        " array_agg(DISTINCT i.text) AS texts, array_agg(DISTINCT i.note_id::text) AS note_ids, "
        f" count(DISTINCT i.note_id) FILTER (WHERE n.created_at > now() - interval '{RECENT} days') AS recent, "
        f" count(DISTINCT i.note_id) FILTER (WHERE n.created_at <= now() - interval '{RECENT} days' "
        f"  AND n.created_at > now() - interval '{RECENT + BEFORE} days') AS before, "
        " ARRAY(SELECT DISTINCT e.name FROM note_items i2 JOIN note_entities ne ON ne.note_id = i2.note_id JOIN entities e ON e.id = ne.entity_id "
        "  WHERE i2.user_id = :u AND i2.kind = 'issue' AND i2.topic = i.topic AND e.kind = 'place') AS places "
        "FROM note_items i JOIN notes n ON n.id = i.note_id LEFT JOIN LATERAL unnest(i.who) w ON true "
        "WHERE i.user_id = :u AND i.kind = 'issue' AND i.topic <> '' AND i.dismissed_at IS NULL "
        "GROUP BY i.topic HAVING count(DISTINCT i.note_id) >= 2 ORDER BY count(DISTINCT i.note_id) DESC, max(n.created_at) DESC LIMIT 8"),
        {"u": uid})).mappings().all()
    return [{"topic": r["topic"], "notes": r["notes"], "last": r["last"], "people": r["people"], "places": list(r["places"])[:4],
             "examples": list(r["texts"])[:3], "note_ids": list(r["note_ids"]), "trend": trend(r["recent"], r["before"])} for r in rows]

async def _moving(s: AsyncSession, uid: str) -> dict:
    """People, places and terms mentioned more lately than before (growing), and ones gone quiet."""
    rows = (await s.execute(text(
        "SELECT e.id, e.name, e.kind, e.last_seen, "
        f" count(*) FILTER (WHERE n.created_at > now() - interval '{RECENT} days') AS recent, "
        f" count(*) FILTER (WHERE n.created_at <= now() - interval '{RECENT} days' AND n.created_at > now() - interval '{RECENT + BEFORE} days') AS before "
        "FROM entities e JOIN note_entities ne ON ne.entity_id = e.id JOIN notes n ON n.id = ne.note_id "
        "WHERE e.user_id = :u GROUP BY e.id"), {"u": uid})).mappings().all()
    entries = [dict(r, id=str(r["id"]), trend=trend(r["recent"], r["before"])) for r in rows]
    growing = sorted((e for e in entries if e["trend"] in ("growing", "new") and e["recent"] >= 2), key=lambda e: -e["recent"])[:6]
    quiet = sorted((e for e in entries if e["trend"] == "quiet" and e["before"] >= 2), key=lambda e: -e["before"])[:6]
    return {"growing": growing, "quiet": quiet}

async def _topics(s: AsyncSession, uid: str) -> list:
    """The main ideas with the most notes lately, and whether each is growing."""
    rows = (await s.execute(text(
        "SELECT t.id, t.name, count(*) AS notes, max(n.created_at) AS last, "
        f" count(*) FILTER (WHERE n.created_at > now() - interval '{RECENT} days') AS recent, "
        f" count(*) FILTER (WHERE n.created_at <= now() - interval '{RECENT} days' AND n.created_at > now() - interval '{RECENT + BEFORE} days') AS before "
        "FROM topics t JOIN note_topics nt ON nt.topic_id = t.id JOIN notes n ON n.id = nt.note_id WHERE t.user_id = :u "
        "AND t.parent_id IS NULL GROUP BY t.id ORDER BY max(n.created_at) DESC, count(*) DESC LIMIT 8"), {"u": uid})).mappings().all()
    return [{"id": str(r["id"]), "name": r["name"], "notes": r["notes"], "last": r["last"], "trend": trend(r["recent"], r["before"])} for r in rows]

async def _picked_up(s: AsyncSession, uid: str) -> list:
    """Notes written lately (the last RECENT days, as for trends) that connect to one written before then, strongest
    first: where the user picked up an old thread."""
    lately = datetime.now(timezone.utc) - timedelta(days=RECENT)
    recent = (await s.execute(text("SELECT id::text, title, created_at FROM notes WHERE user_id = :u AND created_at >= :t ORDER BY created_at DESC"),
                              {"u": uid, "t": lately})).mappings().all()
    out = []
    for n in recent:
        for h in await links.related_to_note(s, uid, n["id"]):
            out.append((h, n))
    old = {str(r["id"]): r for r in (await s.execute(text(
        "SELECT id, title, created_at FROM notes WHERE id = ANY(CAST(:ids AS uuid[])) AND created_at < :t"),
        {"ids": list({h["id"] for h, _ in out}), "t": lately})).mappings().all()}
    return [{"score": h["score"], "shared": h["shared"], "new_id": n["id"], "new_title": n["title"], "new_at": n["created_at"],
             "old_id": h["id"], "old_title": old[h["id"]]["title"], "old_at": old[h["id"]]["created_at"],
             "gap_days": (n["created_at"] - old[h["id"]]["created_at"]).days}
            for h, n in sorted(out, key=lambda x: -x[0]["score"]) if h["id"] in old]

async def _projects(s: AsyncSession, uid: str) -> list:
    """The four most recently active projects."""
    rows = (await s.execute(text(
        "SELECT p.id, p.name, p.description, (SELECT count(*) FROM notes n WHERE n.project_id = p.id) AS notes, "
        "greatest(p.updated_at, (SELECT max(n.created_at) FROM notes n WHERE n.project_id = p.id), "
        " (SELECT max(c.updated_at) FROM conversations c WHERE c.project_id = p.id)) AS active_at "
        "FROM projects p WHERE p.user_id = :u ORDER BY active_at DESC LIMIT 4"), {"u": uid})).mappings().all()
    return [dict(r, id=str(r["id"])) for r in rows]

async def _conversations(s: AsyncSession, uid: str) -> list:
    """The three most recent conversations, to pick up again."""
    rows = (await s.execute(text(
        "SELECT c.id, c.title, c.updated_at, p.name AS project FROM conversations c LEFT JOIN projects p ON p.id = c.project_id "
        "WHERE c.user_id = :u ORDER BY c.updated_at DESC LIMIT 3"), {"u": uid})).mappings().all()
    return [dict(r, id=str(r["id"])) for r in rows]

def _facts(data: dict) -> str:
    """The plain facts the briefing is written from — only what the page itself shows."""
    ov = data["overview"]
    lines = [f"Notes in the last 30 days: {ov['notes_month']} (the 30 days before: {ov['notes_prev']}).",
             f"Promises not yet kept: {ov['open_promises']}."]
    if data["waiting"]:
        lines.append("Oldest: " + "; ".join(f"{w['text']} ({w['days']} days)" for w in data["waiting"][:2]) + ".")
    if data["recurring"]:
        lines.append("Keeps coming up: " + ", ".join(f"{r['topic']} ({r['notes']} notes)" for r in data["recurring"][:4]) + ".")
    if data["moving"]["growing"]:
        lines.append("Mentioned more lately: " + ", ".join(e["name"] for e in data["moving"]["growing"][:4]) + ".")
    if data["coming_up"]:
        lines.append("Coming up: " + "; ".join(f"{c['text']} on {c['due_at']:%a %d %b}" for c in data["coming_up"][:4]) + ".")
    return "\n".join(lines)

def _briefing(facts: str) -> tuple:
    """(text, still being written). Written once per set of facts, in the background."""
    if facts in _briefings:
        return _briefings[facts], False
    if facts not in _writing:
        _writing.add(facts)
        asyncio.create_task(_write_briefing(facts))
    return "", True

async def _write_briefing(facts: str) -> None:
    """Ask the model for the briefing and keep it (the last 16 kept)."""
    try:
        _briefings[facts] = no_dashes(await chat([{"role": "user", "content": prompts.BRIEFING.format(facts=facts)}]))
    except Unavailable:
        _briefings[facts] = ""  # no AI: the numbers speak for themselves
    finally:
        _writing.discard(facts)
        while len(_briefings) > 16:
            _briefings.pop(next(iter(_briefings)))
