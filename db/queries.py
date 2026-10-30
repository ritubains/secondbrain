"""Reading notes the same way everywhere: the columns the app shows, plus the place each note is about, the people
and everything else it mentions, its ideas, and its open promises and events."""
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# A note as the web app shows it. Alias n = notes.
NOTE_COLUMNS = (
    "n.id, n.raw_text, n.title, n.form, n.summary, n.formatted, n.tags, n.bucket, n.project_id, n.pinned, n.starred, n.done_at, "
    "n.source, n.enrich_state, n.created_at, n.updated_at, "
    "(SELECT e.name FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = n.id AND e.kind = 'place' "
    " ORDER BY ne.main DESC, e.mentions DESC LIMIT 1) AS place, "
    "ARRAY(SELECT e.name FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = n.id AND e.kind = 'person' "
    " ORDER BY e.mentions DESC) AS people, "
    "coalesce((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'parent_id', t.parent_id) "
    " ORDER BY t.parent_id NULLS FIRST, t.name) FROM note_topics nt "
    " JOIN topics t ON t.id = nt.topic_id WHERE nt.note_id = n.id), '[]') AS topics, "
    # Everyone and everything it mentions, with the words used (the cards highlight them in the text).
    "coalesce((SELECT json_agg(json_build_object('id', e.id, 'name', e.name, 'kind', e.kind, 'seen_as', ne.seen_as) "
    " ORDER BY e.kind, e.name) FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = n.id), '[]') AS mentions, "
    # Its promises and dated events still open, soonest first.
    "coalesce((SELECT json_agg(json_build_object('id', i.id, 'kind', i.kind, 'text', i.text, 'due_at', i.due_at, 'due_has_time', i.due_has_time) "
    " ORDER BY i.due_at NULLS LAST) FROM note_items i WHERE i.note_id = n.id AND i.kind IN ('promise', 'event') "
    " AND i.done_at IS NULL AND i.dismissed_at IS NULL), '[]') AS open_items")

def note_row(r) -> dict:
    """A database row → the note dict the API returns."""
    d = dict(r)
    d["id"] = str(d["id"])
    d["project_id"] = str(d["project_id"]) if d.get("project_id") else None
    d["place"] = d.get("place") or ""
    d["people"] = list(d.get("people") or [])
    for k in ("topics", "mentions", "open_items"):  # Postgres JSON arrives as text
        v = d.get(k) or []
        d[k] = json.loads(v) if isinstance(v, str) else v
    return d

async def notes_by_id(s: AsyncSession, uid: str, ids: list) -> list:
    """These notes of this user, in the order given (missing ones skipped)."""
    if not ids:
        return []
    rows = (await s.execute(text(f"SELECT {NOTE_COLUMNS} FROM notes n WHERE n.user_id = :u AND n.id = ANY(CAST(:ids AS uuid[]))"),
                            {"u": uid, "ids": list(ids)})).mappings().all()
    by_id = {str(r["id"]): note_row(r) for r in rows}
    return [by_id[i] for i in ids if i in by_id]
