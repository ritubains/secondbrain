"""The knowledge graph around one thing — a note, a person/place/office/group/word, or an idea: everything one step
away, with a label on every line ("mentions", "idea", "via Kheri Kalan", "is MC of"), plus the facts between the
things shown. Tapping a node in the app makes it the centre.

/graph/map is the whole picture at once, for the mind map and folders: every note, the categories and topics the AI
filed them under, and the people and places with the notes they come up in.
/graph/entities is the knowledge graph of the Map tab: notes by category and everything they mention."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.auth import current_user
from core.text import is_uuid
from db.session import get_session
from pipeline import links, relations

router = APIRouter()

class Graph:
    """Nodes and labelled edges, each node and edge once."""

    def __init__(self):
        self.nodes: dict = {}
        self.edges: dict = {}

    def node(self, kind: str, id_: str, label: str, sub: str = "") -> str:
        """Add a node (kind: note, topic, or an entity kind) → its graph id."""
        gid = f"{'note' if kind == 'note' else 'topic' if kind == 'topic' else 'entity'}:{id_}"
        self.nodes.setdefault(gid, {"id": gid, "kind": kind, "label": label[:60], "sub": sub})
        return gid

    def edge(self, a: str, b: str, label: str) -> None:
        """Add a labelled line between two nodes (the first label wins)."""
        if a != b:
            self.edges.setdefault(tuple(sorted((a, b))), {"source": a, "target": b, "label": label})

    def out(self, center: str) -> dict:
        return {"center": center, "nodes": list(self.nodes.values()), "edges": list(self.edges.values())}

async def _facts_between(s: AsyncSession, g: Graph) -> None:
    """Add the facts linking the entities already in the graph (and the plain-text ones about them)."""
    ids = [n["id"].split(":", 1)[1] for n in g.nodes.values() if n["id"].startswith("entity:")]
    for f in await relations.about(s, ids):
        a = f"entity:{f['subject_id']}"
        if f["object_id"]:
            b = f"entity:{f['object_id']}"
            if a in g.nodes and b in g.nodes:
                g.edge(a, b, f["relation"])
        elif a in g.nodes:
            g.edge(a, g.node("value", f"{f['id']}", f["object"]), f["relation"])

@router.get("/graph")
async def graph(kind: str, id: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The neighbourhood of a note (kind=note), an entity (kind=entity) or an idea (kind=topic)."""
    if not is_uuid(id) or kind not in ("note", "entity", "topic"):
        raise HTTPException(404)
    g = Graph()
    if kind == "note":
        center = await _around_note(s, uid, id, g)
    elif kind == "entity":
        center = await _around_entity(s, uid, id, g)
    else:
        center = await _around_topic(s, uid, id, g)
    await _facts_between(s, g)
    return g.out(center)

async def _around_note(s: AsyncSession, uid: str, nid: str, g: Graph) -> str:
    """A note → what it mentions, its ideas, its connected notes (with why)."""
    note = (await s.execute(text("SELECT id, title, raw_text FROM notes WHERE id = :n AND user_id = :u"), {"n": nid, "u": uid})).mappings().first()
    if not note:
        raise HTTPException(404)
    c = g.node("note", nid, note["title"] or note["raw_text"][:40])
    for r in (await s.execute(text("SELECT e.id, e.kind, e.name FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = :n"),
                              {"n": nid})).mappings().all():
        g.edge(c, g.node(r["kind"], str(r["id"]), r["name"]), "mentions")
    for r in (await s.execute(text("SELECT t.id, t.name FROM note_topics nt JOIN topics t ON t.id = nt.topic_id WHERE nt.note_id = :n"),
                              {"n": nid})).mappings().all():
        g.edge(c, g.node("topic", str(r["id"]), r["name"]), "idea")
    hits = await links.related_to_note(s, uid, nid)
    titles = dict((await s.execute(text("SELECT id::text, coalesce(nullif(title, ''), left(raw_text, 40)) FROM notes WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                   {"ids": [h["id"] for h in hits]})).all())
    for h in hits:
        g.edge(c, g.node("note", h["id"], titles.get(h["id"], "")), "via " + ", ".join(h["shared"][:2]) if h["shared"] else "similar")
    return c

async def _around_entity(s: AsyncSession, uid: str, eid: str, g: Graph) -> str:
    """A person/place/… → its facts, who/what it comes up with, its ideas, its latest notes."""
    e = (await s.execute(text("SELECT id, kind, name, meaning FROM entities WHERE id = :e AND user_id = :u"), {"e": eid, "u": uid})).mappings().first()
    if not e:
        raise HTTPException(404)
    c = g.node(e["kind"], eid, e["name"], e["meaning"])
    for f in await relations.about(s, [eid]):  # facts first, so their labels win over "together in …"
        if f["object_id"]:
            g.edge(g.node(f["subject_kind"], f["subject_id"], f["subject"]), g.node(f["object_kind"], f["object_id"], f["object"]), f["relation"])
    for r in (await s.execute(text(
            "SELECT o.id, o.kind, o.name, count(*) AS n FROM note_entities a JOIN note_entities b ON b.note_id = a.note_id "
            "JOIN entities o ON o.id = b.entity_id WHERE a.entity_id = :e AND b.entity_id <> :e GROUP BY o.id ORDER BY n DESC LIMIT 8"),
            {"e": eid})).mappings().all():
        g.edge(c, g.node(r["kind"], str(r["id"]), r["name"]), f"together in {r['n']} note{'s' if r['n'] > 1 else ''}")
    for r in (await s.execute(text(
            "SELECT t.id, t.name, count(*) AS n FROM note_entities ne JOIN note_topics nt ON nt.note_id = ne.note_id JOIN topics t ON t.id = nt.topic_id "
            "WHERE ne.entity_id = :e GROUP BY t.id ORDER BY n DESC LIMIT 5"), {"e": eid})).mappings().all():
        g.edge(c, g.node("topic", str(r["id"]), r["name"]), "idea")
    for r in (await s.execute(text(
            "SELECT n.id, n.title, n.raw_text FROM note_entities ne JOIN notes n ON n.id = ne.note_id WHERE ne.entity_id = :e "
            "ORDER BY n.created_at DESC LIMIT 6"), {"e": eid})).mappings().all():
        g.edge(c, g.node("note", str(r["id"]), r["title"] or r["raw_text"][:40]), "in note")
    return c

async def _around_topic(s: AsyncSession, uid: str, tid: str, g: Graph) -> str:
    """An idea → its notes, who and where it involves, ideas that share notes with it."""
    t = (await s.execute(text("SELECT id, name FROM topics WHERE id = :t AND user_id = :u"), {"t": tid, "u": uid})).mappings().first()
    if not t:
        raise HTTPException(404)
    c = g.node("topic", tid, t["name"])
    for r in (await s.execute(text(
            "SELECT n.id, n.title, n.raw_text FROM note_topics nt JOIN notes n ON n.id = nt.note_id WHERE nt.topic_id = :t "
            "ORDER BY n.created_at DESC LIMIT 12"), {"t": tid})).mappings().all():
        g.edge(c, g.node("note", str(r["id"]), r["title"] or r["raw_text"][:40]), "note")
    for r in (await s.execute(text(
            "SELECT e.id, e.kind, e.name, count(*) AS n FROM note_topics nt JOIN note_entities ne ON ne.note_id = nt.note_id "
            "JOIN entities e ON e.id = ne.entity_id WHERE nt.topic_id = :t AND e.kind <> 'term' GROUP BY e.id ORDER BY n DESC LIMIT 8"),
            {"t": tid})).mappings().all():
        g.edge(c, g.node(r["kind"], str(r["id"]), r["name"]), "involves")
    for r in (await s.execute(text(
            "SELECT o.id, o.name FROM note_topics a JOIN note_topics b ON b.note_id = a.note_id AND b.topic_id <> a.topic_id "
            "JOIN topics o ON o.id = b.topic_id WHERE a.topic_id = :t GROUP BY o.id ORDER BY count(*) DESC LIMIT 5"), {"t": tid})).mappings().all():
        g.edge(c, g.node("topic", str(r["id"]), r["name"]), "shares notes")
    return c

@router.get("/graph/map")
async def whole_map(s: AsyncSession = Depends(get_session), uid: str = Depends(current_user)):
    """All notes with their ideas, the ideas, and every person, place, office and group with the notes they're in
    (the mind map and folders arrange by them)."""
    notes = (await s.execute(text(
        "SELECT n.id, coalesce(nullif(n.title, ''), left(n.raw_text, 40)) AS title, n.bucket, n.created_at, "
        "coalesce(nullif(n.summary, ''), left(n.raw_text, 220)) AS preview, "
        "coalesce(array_agg(nt.topic_id::text) FILTER (WHERE nt.topic_id IS NOT NULL), '{}') AS ideas "
        "FROM notes n LEFT JOIN note_topics nt ON nt.note_id = n.id WHERE n.user_id = :u GROUP BY n.id ORDER BY n.created_at"),
        {"u": uid})).mappings().all()
    ideas = (await s.execute(text(
        "SELECT t.id, t.name, t.parent_id, t.level, (SELECT count(DISTINCT nt.note_id) FROM note_topics nt JOIN topics x ON x.id = nt.topic_id "
        " WHERE x.id = t.id OR x.parent_id = t.id) AS notes FROM topics t WHERE t.user_id = :u"), {"u": uid})).mappings().all()
    shared = (await s.execute(text(
        "SELECT e.id, e.kind, e.name, array_agg(ne.note_id::text) AS notes FROM entities e JOIN note_entities ne ON ne.entity_id = e.id "
        "WHERE e.user_id = :u AND e.kind <> 'term' GROUP BY e.id"), {"u": uid})).mappings().all()
    return {
        "notes": [{"id": str(n["id"]), "title": n["title"], "bucket": n["bucket"], "created_at": n["created_at"].isoformat(), "preview": n["preview"],
                   "ideas": list(n["ideas"])} for n in notes],
        "ideas": [{"id": str(t["id"]), "name": t["name"], "parent_id": str(t["parent_id"]) if t["parent_id"] else None, "level": t["level"], "notes": t["notes"]}
                  for t in ideas],
        "entities": [{"id": str(e["id"]), "kind": e["kind"], "name": e["name"], "notes": list(e["notes"])} for e in shared],
    }

@router.get("/graph/entities")
async def entity_graph(s: AsyncSession = Depends(get_session), uid: str = Depends(current_user)):
    """The knowledge graph of everything the notes mention: every person, place, office, group and issue (sized by
    how many notes mention it), joined where two come up in the same notes (how many, and which), plus the facts
    stated between them ("is MC of"). Words and abbreviations are left out."""
    nodes = (await s.execute(text(
        "SELECT e.id::text AS id, e.name, e.kind, e.meaning, count(DISTINCT ne.note_id) AS notes FROM entities e "
        "JOIN note_entities ne ON ne.entity_id = e.id WHERE e.user_id = :u AND e.kind <> 'term' GROUP BY e.id"), {"u": uid})).mappings().all()
    pairs = (await s.execute(text(
        "SELECT a.entity_id::text AS a, b.entity_id::text AS b, count(*) AS n, array_agg(a.note_id::text) AS notes "
        "FROM note_entities a JOIN note_entities b ON b.note_id = a.note_id AND a.entity_id < b.entity_id "
        "JOIN entities ea ON ea.id = a.entity_id JOIN entities eb ON eb.id = b.entity_id "
        "WHERE ea.user_id = :u AND ea.kind <> 'term' AND eb.kind <> 'term' GROUP BY 1, 2"), {"u": uid})).mappings().all()
    facts = (await s.execute(text(
        "SELECT subject_id::text AS a, object_id::text AS b, relation FROM relations WHERE user_id = :u AND object_id IS NOT NULL"),
        {"u": uid})).mappings().all()
    notes = (await s.execute(text(
        "SELECT n.id::text AS id, coalesce(nullif(n.title, ''), left(n.raw_text, 40)) AS title, n.created_at, n.bucket AS category, "
        "coalesce(nullif(n.summary, ''), left(n.raw_text, 200)) AS preview, ARRAY(SELECT ne.entity_id::text FROM note_entities ne WHERE ne.note_id = n.id) AS entities "
        "FROM notes n WHERE n.user_id = :u"), {"u": uid})).mappings().all()
    return {
        "nodes": [dict(r) for r in nodes],
        "edges": [{"a": r["a"], "b": r["b"], "notes": r["n"], "note_ids": list(r["notes"])} for r in pairs],
        "facts": [dict(r) for r in facts],
        "notes": [{"id": r["id"], "title": r["title"], "created_at": r["created_at"].isoformat(), "category": r["category"] or "",
                   "preview": r["preview"], "entities": list(r["entities"])} for r in notes],
        "stats": {"notes": len(notes), "linked": sum(len(r["entities"]) for r in notes), "things": len(nodes), "connections": len(pairs)},
    }
