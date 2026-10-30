"""People, places and words — the entities the user's notes mention (their vocabulary), each with how often and when
it comes up, what's been promised to them, what they raised, and who/where it goes with. The user can add, correct,
rename and merge them; their edits are kept when new notes come in."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.auth import current_user
from core.text import is_uuid, key
from core.when import BEFORE, RECENT, trend
from db.queries import NOTE_COLUMNS, note_row
from db.session import get_session
from pipeline import relations
from pipeline.entities import KINDS, Index, load, recount

router = APIRouter()

# Which entity kinds each page lists.
GROUPS = {"people": ("person", "official", "group"), "places": ("place",), "issues": ("issue",), "words": ("term",)}

class EntityIn(BaseModel):
    name: str
    kind: str = "term"
    meaning: str = ""
    aliases: List[str] = []   # other spellings

class EntityUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    meaning: Optional[str] = None
    aliases: Optional[List[str]] = None

class FactIn(BaseModel):
    relation: str   # "is MC of"
    object: str     # "Ward 18" — linked to that entry when it exists

class Merge(BaseModel):
    into: str  # the entity that stays

ENTITY_COLUMNS = (
    "e.id, e.kind, e.name, e.meaning, e.origin, e.mentions, e.first_seen, e.last_seen, "
    "ARRAY(SELECT a.alias FROM entity_aliases a WHERE a.entity_id = e.id ORDER BY a.alias) AS aliases, "
    f"(SELECT count(*) FROM note_entities ne JOIN notes n ON n.id = ne.note_id WHERE ne.entity_id = e.id "
    f" AND n.created_at > now() - interval '{RECENT} days') AS recent, "
    f"(SELECT count(*) FROM note_entities ne JOIN notes n ON n.id = ne.note_id WHERE ne.entity_id = e.id "
    f" AND n.created_at <= now() - interval '{RECENT} days' AND n.created_at > now() - interval '{RECENT + BEFORE} days') AS before")

# Open promises and raised issues that concern an entity: a person named in the item, or a place the note is about.
ITEMS_FOR = (
    "SELECT i.id, i.kind, i.text, i.who, i.note_id, n.created_at, n.title FROM note_items i JOIN notes n ON n.id = i.note_id "
    "WHERE i.user_id = :u AND i.dismissed_at IS NULL AND i.kind IN ('promise', 'issue') AND ("
    " EXISTS (SELECT 1 FROM unnest(i.who) w WHERE lower(w) = lower(:name)) OR "
    " EXISTS (SELECT 1 FROM note_entities ne WHERE ne.note_id = i.note_id AND ne.entity_id = :e AND :kind = 'place'))")

def _entity(r) -> dict:
    """An entity row → dict, with its trend."""
    d = dict(r, id=str(r["id"]))
    d["aliases"] = list(d["aliases"] or [])
    d["trend"] = trend(d.pop("recent"), d.pop("before"))
    return d

async def _get(s: AsyncSession, uid: str, eid: str) -> dict:
    """The user's entity, or 404."""
    row = (await s.execute(text(f"SELECT {ENTITY_COLUMNS} FROM entities e WHERE e.id = :e AND e.user_id = :u"),
                           {"e": eid, "u": uid})).mappings().first() if is_uuid(eid) else None
    if not row:
        raise HTTPException(404)
    return _entity(row)

async def _items(s: AsyncSession, uid: str, e: dict) -> list:
    """Promises and issues about this person or place, newest first (open promises carry how long they've waited)."""
    rows = (await s.execute(text(ITEMS_FOR + " ORDER BY n.created_at DESC"),
                            {"u": uid, "name": e["name"], "e": e["id"], "kind": e["kind"]})).mappings().all()
    return [dict(r, id=str(r["id"]), note_id=str(r["note_id"])) for r in rows]

@router.get("/entities")
async def list_entities(group: str = "people", uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The People, Places or Words page: every entry most recently mentioned first, with open promises, raised issues
    and where (or with whom) it comes up."""
    kinds = GROUPS.get(group)
    if not kinds:
        raise HTTPException(422, "group is people, places, issues or words")
    rows = (await s.execute(text(f"SELECT {ENTITY_COLUMNS} FROM entities e WHERE e.user_id = :u AND e.kind = ANY(:k) "
                                 "ORDER BY e.last_seen DESC"), {"u": uid, "k": list(kinds)})).mappings().all()
    out = [_entity(r) for r in rows]
    if not out:
        return {"items": []}
    together = (await s.execute(text(
        "SELECT a.entity_id, e.name, e.kind, count(*) AS n FROM note_entities a JOIN note_entities b ON b.note_id = a.note_id AND b.entity_id <> a.entity_id "
        "JOIN entities e ON e.id = b.entity_id WHERE a.entity_id = ANY(CAST(:ids AS uuid[])) AND e.kind <> 'term' "
        "GROUP BY 1, 2, 3 ORDER BY n DESC"), {"ids": [e["id"] for e in out]})).mappings().all()
    facts = await relations.about(s, [e["id"] for e in out])
    for e in out:
        e["role"] = next((f"{f['relation']} {f['object']}" for f in facts if f["subject_id"] == e["id"]), "")  # "is MC of Ward 18"
        others = [r for r in together if str(r["entity_id"]) == e["id"]]
        e["with"] = [r["name"] for r in others if (r["kind"] == "place") != (e["kind"] == "place")][:3]  # people ↔ places
        items = await _items(s, uid, e) if e["kind"] != "term" else []
        e["waiting"] = [i for i in items if i["kind"] == "promise"]
        e["raised"] = [i for i in items if i["kind"] == "issue"]
    if group == "people":  # whoever is waiting on you first, then most recent
        out.sort(key=lambda e: (not e["waiting"], -e["last_seen"].timestamp()))
    return {"items": out}

@router.get("/entities/{eid}")
async def read_entity(eid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Everything about one entity: its notes, promises, issues and events, and what it's mentioned together with."""
    e = await _get(s, uid, eid)
    e["notes"] = [note_row(r) for r in (await s.execute(text(
        f"SELECT {NOTE_COLUMNS} FROM notes n JOIN note_entities ne ON ne.note_id = n.id WHERE ne.entity_id = :e "
        "ORDER BY n.created_at DESC LIMIT 100"), {"e": eid})).mappings().all()]
    e["items"] = await _items(s, uid, e)
    e["events"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT i.id, i.text, i.due_at, i.due_has_time, i.done_at FROM note_items i JOIN note_entities ne ON ne.note_id = i.note_id "
        "WHERE ne.entity_id = :e AND i.kind = 'event' AND i.dismissed_at IS NULL ORDER BY i.due_at DESC"), {"e": eid})).mappings().all()]
    e["facts"] = [dict(f, text=relations.sentence(f)) for f in await relations.about(s, [eid])]
    e["related"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT o.id, o.name, o.kind, count(*) AS notes FROM note_entities a JOIN note_entities b ON b.note_id = a.note_id "
        "JOIN entities o ON o.id = b.entity_id WHERE a.entity_id = :e AND b.entity_id <> :e GROUP BY o.id ORDER BY notes DESC LIMIT 12"),
        {"e": eid})).mappings().all()]
    return e

async def _set_aliases(s: AsyncSession, uid: str, eid: str, aliases: list) -> None:
    """Replace an entity's other spellings (a spelling already used by another entity is skipped)."""
    await s.execute(text("DELETE FROM entity_aliases WHERE entity_id = :e"), {"e": eid})
    for a in dict.fromkeys(" ".join(a.split())[:80] for a in aliases if a.strip()):
        await s.execute(text("INSERT INTO entity_aliases (entity_id, user_id, alias, key) VALUES (:e, :u, :a, :k) ON CONFLICT DO NOTHING"),
                        {"e": eid, "u": uid, "a": a, "k": key(a)})

@router.post("/entities")
async def add_entity(body: EntityIn, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Add a word, name or place the app should know — or correct the one already under that spelling."""
    name = " ".join(body.name.split())[:80]
    if not key(name) or body.kind not in KINDS:
        raise HTTPException(422, "a name and a kind (person, place, official, group, issue, term) are needed")
    eid = (await s.execute(text(
        "INSERT INTO entities (user_id, kind, name, key, meaning, origin) VALUES (:u, :k, :n, :key, :m, 'you') "
        "ON CONFLICT (user_id, key) DO UPDATE SET kind = EXCLUDED.kind, meaning = EXCLUDED.meaning, origin = 'you' RETURNING id"),
        {"u": uid, "k": body.kind, "n": name, "key": key(name), "m": body.meaning.strip()[:160]})).scalar()
    await _set_aliases(s, uid, str(eid), body.aliases)
    await s.commit()
    return await _get(s, uid, str(eid))

@router.put("/entities/{eid}")
async def update_entity(eid: str, body: EntityUpdate, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Correct an entity: name, kind, meaning, other spellings. It's then the user's, and learning won't change it."""
    e = await _get(s, uid, eid)
    if body.kind is not None and body.kind not in KINDS:
        raise HTTPException(422, "unknown kind")
    name = " ".join((body.name or e["name"]).split())[:80]
    if key(name) != key(e["name"]):
        if (await s.execute(text("SELECT 1 FROM entities WHERE user_id = :u AND key = :k AND id <> :e"), {"u": uid, "k": key(name), "e": eid})).first():
            raise HTTPException(409, "another entry already has that name — merge them instead")
        await s.execute(text("INSERT INTO entity_aliases (entity_id, user_id, alias, key) VALUES (:e, :u, :a, :k) ON CONFLICT DO NOTHING"),
                        {"e": eid, "u": uid, "a": e["name"], "k": key(e["name"])})  # the old name keeps being recognised
    await s.execute(text("UPDATE entities SET name = :n, key = :k, kind = :kind, meaning = :m, origin = 'you' WHERE id = :e"),
                    {"n": name, "k": key(name), "kind": body.kind or e["kind"], "m": (body.meaning if body.meaning is not None else e["meaning"]).strip()[:160], "e": eid})
    if body.aliases is not None:
        await _set_aliases(s, uid, eid, [*body.aliases, *([e["name"]] if key(name) != key(e["name"]) else [])])
    await s.commit()
    return await _get(s, uid, eid)

@router.post("/entities/{eid}/merge")
async def merge_entity(eid: str, m: Merge, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Two entries are the same thing: move this one's notes and spellings into `into`, then delete this one."""
    gone, kept = await _get(s, uid, eid), await _get(s, uid, m.into)
    if gone["id"] == kept["id"]:
        raise HTTPException(422, "that's the same entry")
    await s.execute(text("INSERT INTO note_entities (note_id, entity_id, seen_as, main) SELECT note_id, :k, seen_as, main FROM note_entities "
                         "WHERE entity_id = :g ON CONFLICT (note_id, entity_id) DO NOTHING"), {"k": kept["id"], "g": gone["id"]})
    await s.execute(text("UPDATE entity_aliases SET entity_id = :k WHERE entity_id = :g"), {"k": kept["id"], "g": gone["id"]})
    await s.execute(text("UPDATE note_items SET who = array_replace(who, :old, :new) WHERE user_id = :u"),
                    {"old": gone["name"], "new": kept["name"], "u": uid})
    await s.execute(text("DELETE FROM entities WHERE id = :g"), {"g": gone["id"]})
    await s.execute(text("INSERT INTO entity_aliases (entity_id, user_id, alias, key) VALUES (:k, :u, :a, :key) ON CONFLICT DO NOTHING"),
                    {"k": kept["id"], "u": uid, "a": gone["name"], "key": key(gone["name"])})
    await recount(s, uid)
    await s.commit()
    return await _get(s, uid, kept["id"])

@router.delete("/entities/{eid}")
async def delete_entity(eid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Forget an entry (its notes stay; a later note may teach it again)."""
    await _get(s, uid, eid)
    await s.execute(text("DELETE FROM entities WHERE id = :e"), {"e": eid})
    await s.commit()
    return {"ok": True}

@router.post("/entities/{eid}/facts")
async def add_fact(eid: str, f: FactIn, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Add a fact to an entry's profile ("is MC of" "Ward 18"); kept when notes are read again."""
    e = await _get(s, uid, eid)
    relation, target = " ".join(f.relation.split())[:60], " ".join(f.object.split())[:80]
    if not relation or not target:
        raise HTTPException(422, "a fact needs a relation and what it relates to")
    obj = Index(await load(s, uid)).find(target)
    fact_key = f"{e['id']}|{key(relation)}|{obj['id'] if obj else key(target)}"
    await s.execute(text(
        "INSERT INTO relations (user_id, subject_id, relation, object_id, object_text, origin, fact_key) VALUES (:u, :s, :r, :o, :ot, 'you', :k) "
        "ON CONFLICT (user_id, fact_key) DO UPDATE SET origin = 'you'"),
        {"u": uid, "s": eid, "r": relation, "o": obj["id"] if obj else None, "ot": "" if obj else target, "k": fact_key})
    await s.commit()
    return {"facts": [dict(x, text=relations.sentence(x)) for x in await relations.about(s, [eid])]}

@router.delete("/relations/{rid}")
async def delete_fact(rid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Remove a fact."""
    if is_uuid(rid):
        await s.execute(text("DELETE FROM relations WHERE id = :r AND user_id = :u"), {"r": rid, "u": uid})
        await s.commit()
    return {"ok": True}
