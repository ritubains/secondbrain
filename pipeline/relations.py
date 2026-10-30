"""Facts between entities — the user's knowledge graph: "Saroj — is MC of — Ward 18", "Gurdev Singh — is sarpanch
of — Kheri Kalan". The AI states them while reading a note; here each side is matched to the user's entities (any
spelling). The subject must be an entity; the object is one when it can be, else plain text. A fact seen in several
notes is stored once.

resolve()  save a note's facts (replacing the ones learned from it before)
about()    the facts an entity is part of, for its profile and for the chat
"""
import re
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.text import key
from pipeline import entities

# Verbs of one-off events — those are items (issues, promises), not lasting facts about someone.
EVENTS = set("raised raises called calls said says asked asks met meets came comes told tells promised wants wanted visited complained "
             "agreed agrees requested requests will would shared shares mentioned".split())

def lasting(f: dict) -> bool:
    """A fact worth keeping: not about itself, not a one-off event, and saying something ("called again" isn't)."""
    a, b = key(f["subject"]), key(f["object"])
    if a in b or b in a:  # about itself: "EO" — "is Executive Officer of" — "EO of the municipal committee"
        return False
    words = re.findall(r"[a-z]+", f["relation"].lower())
    if not words or words[0] in EVENTS:
        return False
    return len(key(f["object"])) >= 3 and f["object"].lower() not in ("again", "today", "yesterday", "tomorrow")

async def resolve(s: AsyncSession, uid: str, nid: str, facts: list, written) -> int:
    """Save the facts stated in a note. → how many."""
    await s.execute(text("DELETE FROM relations WHERE note_id = :n AND origin = 'auto'"), {"n": nid})
    index = entities.Index(await entities.load(s, uid))
    saved = 0
    for f in filter(lasting, facts):
        subject = index.find(f["subject"])
        if subject is None:
            continue  # facts are about entities the notes mention; a subject the note didn't name as one is skipped
        obj = index.find(f["object"])
        if obj and obj["id"] == subject["id"]:
            continue  # "XEN Drainage handles XEN Drainage service": the same entry on both sides
        relation = " ".join(f["relation"].split())[:60]
        # "is MC of" + "MC of ward 18" → object "ward 18": the relation's words aren't repeated in the object.
        tail = " ".join(relation.split()[-2:]).lower()
        if f["object"].lower().startswith(tail + " ") and not obj:
            f = {**f, "object": f["object"][len(tail) + 1:]}
            obj = index.find(f["object"])
        fact_key = f"{subject['id']}|{key(relation)}|{obj['id'] if obj else key(f['object'])}"
        await s.execute(text(
            "INSERT INTO relations (user_id, subject_id, relation, object_id, object_text, note_id, fact_key, created_at) "
            "VALUES (:u, :s, :r, :o, :ot, :n, :k, :w) ON CONFLICT (user_id, fact_key) DO NOTHING"),
            {"u": uid, "s": subject["id"], "r": relation, "o": obj["id"] if obj else None,
             "ot": "" if obj else f["object"][:80], "n": nid, "k": fact_key, "w": written})
        saved += 1
    return saved

async def about(s: AsyncSession, entity_ids: list) -> list:
    """Facts these entities are part of, either side:
    [{id, subject_id, subject, subject_kind, relation, object_id, object, object_kind, note_id}]."""
    if not entity_ids:
        return []
    rows = (await s.execute(text(
        "SELECT r.id, r.subject_id, sub.name AS subject, sub.kind AS subject_kind, r.relation, r.object_id, "
        "coalesce(obj.name, r.object_text) AS object, obj.kind AS object_kind, r.note_id "
        "FROM relations r JOIN entities sub ON sub.id = r.subject_id LEFT JOIN entities obj ON obj.id = r.object_id "
        "WHERE r.subject_id = ANY(CAST(:ids AS uuid[])) OR r.object_id = ANY(CAST(:ids AS uuid[])) ORDER BY r.created_at"),
        {"ids": list(entity_ids)})).mappings().all()
    return [{k: (str(v) if k.endswith("_id") or k == "id" else v) if v else v for k, v in r.items()} for r in rows]

def sentence(f: dict) -> str:
    """A fact as a sentence: "Saroj is MC of Ward 18"."""
    return f"{f['subject']} {f['relation']} {f['object']}"
