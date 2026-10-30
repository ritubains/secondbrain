"""Entities: the people, places, officials, groups and terms a user's notes mention. Together they are the
user's vocabulary — every spelling seen, what terms mean, how often and when each came up.

recognize()  finds entities the user already has in new text (any spelling, near misses), before the AI reads it
resolve()    turns what the AI extracted into entity rows and links them to the note
canonical()  the entity name for a name as written ("Bansal sahib" → "Rakesh Bansal")
"""
import difflib
import re
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.llm import common_words
from core.text import NAME_SIM, key
from db.session import Session

KINDS = ("person", "place", "official", "group", "issue", "term")
# Titles and honorifics around a person's name — never the name itself ("Sarpanch" isn't Sarpanch Balbir).
TITLES = set("sarpanch master baba bibi biji sardar sardarni ji sahib saab sahab bhai bhaji chacha mama tauji "
             "dr mr mrs ms shri smt".split())

async def load(s: AsyncSession, uid: str) -> list:
    """Every entity of this user with its other spellings: [{id, kind, name, meaning, origin, forms: [name, *aliases]}]."""
    rows = (await s.execute(text(
        "SELECT e.id, e.kind, e.name, e.meaning, e.origin, coalesce(array_agg(a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases "
        "FROM entities e LEFT JOIN entity_aliases a ON a.entity_id = e.id WHERE e.user_id = :u GROUP BY e.id"),
        {"u": uid})).mappings().all()
    return [{"id": str(r["id"]), "kind": r["kind"], "name": r["name"], "meaning": r["meaning"], "origin": r["origin"],
             "forms": [r["name"], *r["aliases"]]} for r in rows]

def core_name(name: str) -> list:
    """A person's own name words, without titles and posts: "SSP Harpreet Kaur" → ["harpreet", "kaur"]."""
    return [w.lower() for w in re.findall(r"[A-Za-z]+", name) if w.lower() not in TITLES and not (len(w) >= 2 and w.isupper())]

class Index:
    """Lookups over a user's entities: by any spelling, by a near miss, or by part of a person's name."""

    def __init__(self, ents: list):
        self.ents = ents
        self.by_key = {}
        self.words = {}  # key → number of words in that spelling, for near-miss matching
        for e in ents:
            for f in e["forms"]:
                self.add(e, f)

    def add(self, e: dict, form: str) -> None:
        """Make one more spelling of an entity findable."""
        k = key(form)
        if k:
            self.by_key.setdefault(k, e)
            if len(k) >= 4:
                self.words[k] = len(form.split())

    def find(self, name: str, kind: str = "") -> dict | None:
        """The entity a written name means, or None. Exact spelling first, then a near miss with the same number of
        words ("Mster Harbhjan"), then — for people — the same name around other titles, or part of one known name."""
        k = key(name)
        if k in self.by_key:
            return self.by_key[k]
        if len(k) >= 4:
            same_length = [x for x, n in self.words.items() if n == len(name.split())]
            near = difflib.get_close_matches(k, same_length, n=1, cutoff=NAME_SIM)
            if near:
                return self.by_key[near[0]]
        return self.person(name) if kind in ("", "person") else None

    def person(self, name: str) -> dict | None:
        """The one person whose name this is, ignoring titles ("Harpreet Kaur SSP" = "SSP Harpreet Kaur"), or whose
        name contains it ("Bansal sahib" → Rakesh Bansal). None when nobody or several people fit ("Singh")."""
        words = core_name(name)
        if not words:
            return None
        forms = [(e, core_name(f)) for e in self.ents if e["kind"] in ("person", "official") for f in e["forms"]]
        same = {e["id"]: e for e, f in forms if f == words}
        if same:
            return next(iter(same.values())) if len(same) == 1 else None
        part = {e["id"]: e for e, f in forms if len(f) > len(words) and any(f[i:i + len(words)] == words for i in range(len(f)))}
        return next(iter(part.values())) if len(part) == 1 else None

async def recognize(s: AsyncSession, uid: str, body: str) -> list:
    """Entities this text mentions that the user already has — longest match first, so "Old Mandi" isn't also
    "Mandi". → [{...entity, seen_as: how this text wrote it}]"""
    index = Index(await load(s, uid))
    if not index.ents:
        return []
    words = [re.sub(r"'s$", "", w) for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9.'-]*", body)]
    used = [False] * len(words)
    found = {}
    for exact in (True, False):  # every exact mention first, then near misses in the words left over
        for n in (4, 3, 2, 1):
            for i in range(len(words) - n + 1):
                if any(used[i:i + n]):
                    continue
                said = " ".join(words[i:i + n]).strip(".-'")
                e = index.by_key.get(key(said)) if exact else index.find(said, "?")
                if e and len(key(said)) >= 2:
                    used[i:i + n] = [True] * n
                    found.setdefault(e["id"], {**e, "seen_as": said})
    return list(found.values())

def worth_keeping(name: str, kind: str) -> bool:
    """Skip everyday English ("brother", "villages", "Sunday") and lone titles; keep abbreviations (SSP, XEN),
    proper names ("Sharma Printers"), words that aren't everyday English (sarpanch, nala), and issues."""
    words = re.findall(r"[A-Za-z]+", name)
    if not words or (kind == "person" and not core_name(name)):
        return False
    if kind == "issue":
        return True  # issues are everyday words on purpose ("Drugs", "Roads")
    letters = "".join(words)
    if any(len(w) >= 2 and w.isupper() for w in words) or (len(letters) >= 2 and letters.isupper()):
        return True
    if len(words) >= 2 and all(w[0].isupper() for w in words) and kind != "term":
        return True
    common = common_words()
    return not common or not all(w.lower() in common or w.lower().rstrip("s") in common for w in words)

def _kind(name: str, kind: str) -> str:
    """The AI's kind → one of KINDS. An "official" that is really a titled person ("SSP Harpreet Kaur",
    "Sarpanch Gurdev Singh") is a person: at least half of the words left after titles and posts are names,
    not everyday English (so "XEN Drainage" stays an office)."""
    k = (kind or "").strip().lower()
    k = k if k in KINDS else "term"
    words = core_name(name)
    if k == "official" and words:
        common = common_words()
        if sum(w not in common for w in words) * 2 >= len(words):
            return "person"
    return k

async def resolve(s: AsyncSession, uid: str, nid: str, extracted: list, known: list, main_place: str, written) -> list:
    """Link the note to its entities: existing ones by any spelling, new ones created. Saves new spellings and
    meanings, refreshes counts. → [{id, kind, name}] for the note."""
    index = Index(await load(s, uid))
    mentions = [{"name": e["name"], "kind": e["kind"], "meaning": "", "also": [], "seen_as": e["seen_as"]} for e in known]
    mentions += [{**e, "seen_as": e["name"]} for e in extracted]
    old = [str(r[0]) for r in (await s.execute(text("DELETE FROM note_entities WHERE note_id = :n RETURNING entity_id"), {"n": nid})).all()]
    linked = {}
    for m in mentions:
        kind = _kind(m["name"], m["kind"])
        e = index.find(m["name"], kind)
        if e is None:
            if not worth_keeping(m["name"], kind):
                continue
            e = await _create(s, uid, m["name"], kind, m["meaning"], written)
            index.ents.append(e)
            index.add(e, e["name"])
        for form in [m["seen_as"], m["name"], *m.get("also", [])]:
            if form and key(form) and key(form) not in index.by_key:
                await _add_alias(s, uid, e["id"], form)
                index.add(e, form)
        if m["meaning"] and not e["meaning"] and e["origin"] == "auto":
            e["meaning"] = m["meaning"]
            await s.execute(text("UPDATE entities SET meaning = :m WHERE id = :i"), {"m": m["meaning"][:160], "i": e["id"]})
        linked.setdefault(e["id"], (e, m["seen_as"]))
    main = index.find(main_place, "place") if main_place else None
    for eid, (e, seen) in linked.items():
        await s.execute(text("INSERT INTO note_entities (note_id, entity_id, seen_as, main) VALUES (:n, :e, :s, :m)"),
                        {"n": nid, "e": eid, "s": seen[:80], "m": bool(main and main["id"] == eid)})
    touched = list({*old, *linked})
    if touched:  # counts and last-seen come from the links themselves, so re-ingesting never double counts
        await s.execute(text(
            "UPDATE entities e SET mentions = (SELECT count(*) FROM note_entities ne WHERE ne.entity_id = e.id), "
            "last_seen = greatest(e.last_seen, :w) WHERE e.id = ANY(CAST(:ids AS uuid[]))"), {"ids": touched, "w": written})
    return [{"id": eid, "kind": e["kind"], "name": e["name"]} for eid, (e, _) in linked.items()]

async def _create(s: AsyncSession, uid: str, name: str, kind: str, meaning: str, written) -> dict:
    """A new entity (or the existing one if another note created it meanwhile)."""
    name = " ".join(name.split())[:80]
    row = (await s.execute(text(
        "INSERT INTO entities (user_id, kind, name, key, meaning, first_seen, last_seen) VALUES (:u, :k, :n, :key, :m, :w, :w) "
        "ON CONFLICT (user_id, key) DO UPDATE SET name = entities.name RETURNING id, kind, name, meaning, origin"),
        {"u": uid, "k": kind, "n": name, "key": key(name), "m": meaning[:160], "w": written})).mappings().first()
    return {"id": str(row["id"]), "kind": row["kind"], "name": row["name"], "meaning": row["meaning"], "origin": row["origin"], "forms": [row["name"]]}

async def _add_alias(s: AsyncSession, uid: str, eid: str, alias: str) -> None:
    """Remember another spelling of an entity (ignored if that spelling already belongs to one)."""
    await s.execute(text("INSERT INTO entity_aliases (entity_id, user_id, alias, key) VALUES (:e, :u, :a, :k) ON CONFLICT DO NOTHING"),
                    {"e": eid, "u": uid, "a": alias[:80], "k": key(alias)})

def canonical(index: Index, name: str) -> str:
    """The entity name for a name as written, or the name itself when it isn't a known person/place/office."""
    e = index.find(name, "person")
    return e["name"] if e and e["kind"] != "term" else name

async def set_place(s: AsyncSession, uid: str, nid: str, name: str) -> None:
    """The user picked the place a note is about ("" = none): that place entity becomes the note's main one."""
    await s.execute(text("UPDATE note_entities SET main = false WHERE note_id = :n"), {"n": nid})
    if not name.strip():
        return
    index = Index(await load(s, uid))
    e = index.find(name, "place") or await _create(s, uid, name, "place", "", await _written(s, nid))
    await s.execute(text(
        "INSERT INTO note_entities (note_id, entity_id, seen_as, main) VALUES (:n, :e, :s, true) "
        "ON CONFLICT (note_id, entity_id) DO UPDATE SET main = true"), {"n": nid, "e": e["id"], "s": name[:80]})
    await recount(s, uid)

async def _written(s: AsyncSession, nid: str):
    """When a note was written."""
    return (await s.execute(text("SELECT created_at FROM notes WHERE id = :n"), {"n": nid})).scalar()

async def recount(s: AsyncSession, uid: str) -> None:
    """Refresh every entity's mention count, and drop learned ones no note mentions any more (after a delete).
    Entities the user added or edited stay."""
    await s.execute(text(
        "UPDATE entities e SET mentions = (SELECT count(*) FROM note_entities ne WHERE ne.entity_id = e.id) WHERE e.user_id = :u"), {"u": uid})
    await s.execute(text("DELETE FROM entities WHERE user_id = :u AND mentions = 0 AND origin = 'auto'"), {"u": uid})

async def spelling_hint(uid: str, limit: int = 600) -> str:
    """The user's most-mentioned names and terms, for Whisper to spell their way ("Dhab Wala, Harbhajan, XEN")."""
    async with Session() as s:
        names = (await s.execute(text("SELECT name FROM entities WHERE user_id = :u ORDER BY origin = 'you' DESC, mentions DESC LIMIT 80"),
                                 {"u": uid})).scalars().all()
    out, size = [], 0
    for name in names:
        if size + len(name) + 2 > limit:
            break
        out.append(name)
        size += len(name) + 2
    return ", ".join(out)
