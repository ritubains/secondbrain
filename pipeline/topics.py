"""Ideas the user names or reshapes themselves: put a note in an idea by name (an existing one if the name means the
same), and tidy away automatic ideas nothing is in. The ideas themselves are found by clustering all the notes
together (pipeline/clusters.py).

find_or_create()  the idea a name means, or a new one
rename()          give an idea the user's own name
prune()           drop automatic ideas no note is in any more
"""
import difflib
import math
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.llm import Unavailable, embed
from core.text import NAME_SIM, key

SAME_MEANING = 0.8    # two idea names this close in meaning are the same idea (when the user names one)
_vectors: dict = {}   # idea name → its vector, so names aren't embedded again

async def existing(s: AsyncSession, uid: str, limit: int = 40) -> list:
    """The user's ideas, most used lately first: [{id, name, origin, parent_id}] (parent_id: None for a main idea)."""
    rows = (await s.execute(text(
        "SELECT t.id, t.name, t.origin, t.parent_id FROM topics t LEFT JOIN note_topics nt ON nt.topic_id = t.id "
        "WHERE t.user_id = :u GROUP BY t.id ORDER BY max(t.updated_at) DESC, count(nt.note_id) DESC LIMIT :lim"),
        {"u": uid, "lim": limit})).mappings().all()
    return [_row(r) for r in rows]

def _row(r) -> dict:
    return {"id": str(r["id"]), "name": r["name"], "origin": r["origin"], "parent_id": str(r["parent_id"]) if r["parent_id"] else None}

def _near_spelling(name: str, known: list) -> dict | None:
    """An existing topic spelled almost the same ("Election stratergy")."""
    keys = {key(t["name"]): t for t in known}
    near = difflib.get_close_matches(key(name), list(keys), n=1, cutoff=NAME_SIM)
    return keys[near[0]] if near else None

async def _near_meaning(name: str, known: list) -> dict | None:
    """The existing topic whose name means the same, if one is close enough ("Campaign strategy" → "Election strategy")."""
    if not known:
        return None
    try:
        mine = await _vector(name)
        best, best_sim = None, SAME_MEANING
        for t in known:
            sim = _cosine(mine, await _vector(t["name"]))
            if sim >= best_sim:
                best, best_sim = t, sim
        return best
    except Unavailable:
        return None

async def _vector(name: str) -> list:
    """A topic name's vector (cached)."""
    if name not in _vectors:
        _vectors[name] = await embed(name)
    return _vectors[name]

def _cosine(a: list, b: list) -> float:
    """Cosine similarity of two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    size = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / size if size else 0.0

async def _create(s: AsyncSession, uid: str, name: str, parent: str | None) -> dict:
    """A new idea (or the existing one with that name), as a main idea (parent None) or inside one."""
    row = (await s.execute(text(
        "INSERT INTO topics (user_id, name, key, parent_id) VALUES (:u, :n, :k, :p) ON CONFLICT (user_id, level, key) DO UPDATE SET updated_at = now() "
        "RETURNING id, name, origin, parent_id"), {"u": uid, "n": name, "k": key(name), "p": parent})).mappings().first()
    return _row(row)

async def find_or_create(s: AsyncSession, uid: str, name: str) -> dict:
    """The topic a name means (same spelling, near spelling or close meaning), or a new one. Used when the user names
    a topic themselves."""
    known = await existing(s, uid, limit=500)
    hit = next((t for t in known if key(t["name"]) == key(name)), None) or _near_spelling(name, known) or await _near_meaning(name, known)
    return hit or await _create(s, uid, name, None)

async def prune(s: AsyncSession, uid: str) -> None:
    """Drop learned topics no note belongs to any more (after a re-read or a delete). The user's own stay."""
    await s.execute(text("DELETE FROM topics t WHERE t.user_id = :u AND t.origin = 'auto' "
                         "AND NOT EXISTS (SELECT 1 FROM note_topics nt WHERE nt.topic_id = t.id)"), {"u": uid})

async def rename(s: AsyncSession, uid: str, tid: str, name: str) -> None:
    """Give an idea the user's name (kept from then on); a renamed category's notes show the new name too."""
    old = (await s.execute(text("SELECT name, level FROM topics WHERE id = :t"), {"t": tid})).mappings().first()
    await s.execute(text("UPDATE topics SET name = :n, key = :k, origin = 'you', updated_at = now() WHERE id = :t"), {"n": name, "k": key(name), "t": tid})
    if old and old["level"] == "category":
        await s.execute(text("UPDATE notes SET bucket = :n WHERE user_id = :u AND bucket = :o"), {"n": name, "u": uid, "o": old["name"]})
