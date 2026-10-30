"""One pipeline for every note. Typed or spoken (voice is transcribed to text first), it's the same text and
the same steps, run in the background after the note is saved:

  1. recognize   entities the user already has, found in the text (any spelling)
  2. extract     one AI call: title, summary, what kind of note it is, the people, places, offices, groups and
                 issues it mentions, items, facts between entities; then a spoken note (or one asking for a
                 checklist) is written up for reading by a small call, checked by rule
  3. resolve     entities linked to the note (new ones created); items and facts between entities saved
  4. vector      its meaning as numbers (connections to other notes are worked out when read: pipeline/links.py)
  5. file        all the user's notes are filed again by the AI, in the background (pipeline/clusters.py): this
                 note joins the topic it belongs with, and may pull older notes in with it
  6. remember    mem0 learns lasting facts for the user's profile (or the note's project)

The note stays readable throughout; status goes "pending" → "done" even if a step fails.
"""
import logging
from sqlalchemy import text
from core import memory
from core.llm import Unavailable, embed, embed_model, embed_table
from core.when import due
from db.session import Session
from pipeline import clusters, entities, extract, layout, relations

log = logging.getLogger("bigbutter.ingest")

async def ingest(uid: str, nid: str, keep_title: str | None = None, cluster: bool = True) -> None:
    """Run the pipeline for one note. keep_title: a title the user typed, which wins over the AI's. cluster: False
    when many notes are re-read at once (the caller files them once at the end). Never holds a database connection
    while the AI is thinking."""
    try:
        async with Session() as s:
            note = (await s.execute(text(
                "SELECT n.raw_text, n.source, n.created_at, n.project_id FROM notes n "
                "WHERE n.id = :n AND n.user_id = :u"), {"n": nid, "u": uid})).mappings().first()
            if not note:
                return  # deleted meanwhile
            known = await entities.recognize(s, uid, note["raw_text"])
        body, written = note["raw_text"], note["created_at"]
        vec = await _vector(body)

        try:
            record = await extract.extract(body, known, written)
        except Unavailable as e:
            log.info("ingest without AI (%s) note=%s", e, nid)
            record = extract.fallback(body)
        if keep_title:
            record["title"] = keep_title
        # Written up for reading: spoken notes, long typed ones written without any formatting, and any that ask for a
        # checklist or list ("make a to-do list: …"). Text that already
        # has headings, lists or checklists (typed that way, or a write-up the user edited) is kept as it is.
        plain = not layout.formatted(body) and (note["source"] == "voice" or len(body) >= layout.LONG_TYPED or layout.asks_format(body))
        record["formatted"] = await layout.layout(body, [e["name"] for e in record["entities"] if e["name"].lower() in body.lower()]) if plain else ""

        async with Session() as s:
            linked = await entities.resolve(s, uid, nid, record["entities"], known, record["main_place"], written)
            await relations.resolve(s, uid, nid, record["relations"], written)
            await _save_note(s, nid, record)
            await _save_items(s, uid, nid, record["items"], written)
            if vec is not None:
                await _save_vector(s, nid, vec)
            await s.execute(text("UPDATE notes SET enrich_state = 'done' WHERE id = :n"), {"n": nid})
            await s.commit()
        log.info("ingested note=%s: %d entities, %d items", nid, len(linked), len(record["items"]))
    except Exception:
        log.exception("ingest failed note=%s", nid)
        async with Session() as s:
            await s.execute(text("UPDATE notes SET enrich_state = 'done' WHERE id = :n"), {"n": nid})
            await s.commit()
        return
    if cluster:
        clusters.schedule(uid)
    await memory.remember(uid, body, str(note["project_id"]) if note["project_id"] else None, note_id=nid)

async def _vector(body: str) -> list | None:
    """The note's vector, from its text (found first: similar earlier notes are looked up with it)."""
    try:
        return await embed(body)
    except Unavailable:
        return None

async def _save_note(s, nid: str, record: dict) -> None:
    """Write what the AI found onto the note (its category comes from clustering, pipeline/clusters.py)."""
    await s.execute(text(
        "UPDATE notes SET title = :ti, summary = :su, formatted = :fo, form = :fm, tags = :ta, updated_at = now() WHERE id = :n"),
        {"ti": record["title"], "su": record["summary"], "fo": record["formatted"], "fm": record["form"], "ta": record["tags"], "n": nid})

async def _save_items(s, uid: str, nid: str, items: list, written) -> None:
    """Replace the note's promises / issues / events / tasks. Names are the entities' own spellings, and an item
    ticked off or dismissed before keeps that state when the same text comes back."""
    index = entities.Index(await entities.load(s, uid))
    old = (await s.execute(text("DELETE FROM note_items WHERE note_id = :n RETURNING kind, lower(text) AS t, done_at, dismissed_at"),
                           {"n": nid})).mappings().all()
    kept = {(r["kind"], r["t"]): r for r in old}
    for item in items:
        when, has_time = due(item["when"], written) if item["kind"] == "event" else (None, False)
        if item["kind"] == "event" and not when:
            continue  # an event without a day it could be placed on
        before = kept.get((item["kind"], item["text"].lower()), {})
        await s.execute(text(
            "INSERT INTO note_items (user_id, note_id, kind, text, who, topic, due_at, due_has_time, done_at, dismissed_at) "
            "VALUES (:u, :n, :k, :t, :w, :tp, :due, :ht, :d, :x)"),
            {"u": uid, "n": nid, "k": item["kind"], "t": item["text"], "w": [entities.canonical(index, w) for w in item["who"]],
             "tp": item["topic"], "due": when, "ht": has_time, "d": before.get("done_at"), "x": before.get("dismissed_at")})

async def _save_vector(s, nid: str, vec: list) -> None:
    """Store (or replace) the note's vector."""
    await s.execute(text(
        f"INSERT INTO {embed_table()} (note_id, embedding, model_version) VALUES (:n, CAST(:v AS vector), :m) "
        "ON CONFLICT (note_id) DO UPDATE SET embedding = EXCLUDED.embedding, model_version = EXCLUDED.model_version"),
        {"n": nid, "v": str(vec), "m": embed_model()})
