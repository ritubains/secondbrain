"""How close two notes are, or a question and a note: worked out when it's asked, never stored, so every note is
compared with every other note as they are now (a new note with the old ones, and the old ones with it).

The evidence, each on the user's own scale (note_scales, measured from their notes and refreshed in the background):
  meaning  how close the two texts are (vector similarity): 0 = as close as two of their notes typically are,
           1 = as close as a note typically is to its closest other note
  names    the people, places, offices, groups and issues both mention, each worth how rare it is in their notes
           (log of notes ÷ notes naming it), added up; 0 and 1 the same way: a typical pair, a note and its closest
A question is measured by meaning the same way; by names and by words, as the share of what it names or says that a
note has too, each name or word worth how rare it is (all of it = 1).
The pieces combine as independent signs, 1 − Π(1 − s): one strong sign is enough and weak ones add up, so nothing is
weighted. Connected (or, for a question, relevant) = at least half way from typical to closest.

Only candidates that can pass are looked at: notes sharing a name (from the index of names), and notes close enough
in meaning to pass on meaning alone (from the vector index, read in growing batches until they're too far).

related_to_note()      a note's connected notes, closest first
related_to_question()  the notes a question is about, most relevant first
refresh_scale()        measure the user's scale again (pipeline/clusters.py runs it after notes change)
"""
import math
from datetime import datetime
import numpy as np
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.llm import embed_table

CONNECTED = 0.5   # half way from a typical pair to a note's closest: the line between related and not
SAMPLE = 256      # notes measured for the scale: its medians settle long before this, and its cost grows with the square

# Notes of the user, optionally leaving one out and only from a date on (:x, :since).
SCOPE = ("n.user_id = :u AND (CAST(:x AS uuid) IS NULL OR n.id <> CAST(:x AS uuid)) "
         "AND (CAST(:since AS timestamptz) IS NULL OR n.created_at >= :since)")

async def related_to_note(s: AsyncSession, uid: str, nid: str, since: datetime | None = None) -> list:
    """The notes connected to this one, closest first: [{id, score, meaning, names, words, shared}]."""
    scale = await _scale(s, uid)
    args = {"u": uid, "x": nid, "since": since}
    vec = (await s.execute(text(f"SELECT embedding::text FROM {embed_table()} WHERE note_id = :n"), {"n": nid})).scalar()
    named = await _shared_names(s, args, "SELECT entity_id FROM note_entities WHERE note_id = :n", {"n": nid})
    names = {i: (_on_scale(info, scale["names_typical"], scale["names_close"]), shared) for i, (info, shared) in named.items()}
    return await _combine(s, args, vec, scale, names, {})

async def related_to_question(s: AsyncSession, uid: str, vec: list | None, entity_ids: list, words: str = "",
                              since: datetime | None = None) -> list:
    """The notes a question is about, most relevant first: [{id, score, meaning, names, words, shared}]."""
    scale = await _scale(s, uid)
    args = {"u": uid, "x": None, "since": since}
    names = {}
    if entity_ids:
        asked = sum((await _rarity(s, uid, entity_ids)).values())
        named = await _shared_names(s, args, "SELECT unnest(CAST(:ids AS uuid[]))", {"ids": list(entity_ids)})
        names = {i: (info / asked if asked else 0.0, shared) for i, (info, shared) in named.items()}
    said = await _words(s, args, words) if words.strip() else {}
    return await _combine(s, args, str(vec) if vec is not None else None, scale, names, said)

async def _combine(s: AsyncSession, args: dict, vec: str | None, scale: dict, names: dict, said: dict) -> list:
    """Every candidate's evidence put together, keeping those that pass, best first."""
    meaning = {}
    if vec is not None:
        meaning = await _near(s, args, vec, await meaning_floor(s, args["u"]), scale["notes"])
        meaning.update(await _similarity(s, vec, [i for i in {*names, *said} if i not in meaning]))
    out = []
    for nid in {*meaning, *names, *said}:
        m = _on_scale(meaning.get(nid, 0.0), scale["meaning_typical"], scale["meaning_close"]) if nid in meaning else 0.0
        e, shared = names.get(nid, (0.0, []))
        w = said.get(nid, 0.0)
        score = 1 - (1 - m) * (1 - min(e, 1.0)) * (1 - w)
        if score >= CONNECTED:
            out.append({"id": nid, "score": round(score, 3), "meaning": round(m, 3), "names": round(min(e, 1.0), 3), "words": round(w, 3), "shared": shared})
    return sorted(out, key=lambda h: -h["score"])

async def meaning_floor(s: AsyncSession, uid: str) -> float:
    """The vector similarity at which meaning alone makes two texts related, on this user's scale."""
    scale = await _scale(s, uid)
    return scale["meaning_typical"] + CONNECTED * (scale["meaning_close"] - scale["meaning_typical"])

def _on_scale(x: float, typical: float, close: float) -> float:
    """A raw measure on the user's scale: typical → 0, close → 1 (0 to 1). With no spread to measure against, more
    than typical counts fully."""
    if close > typical:
        return max(0.0, min(1.0, (x - typical) / (close - typical)))
    return 1.0 if x > typical else 0.0

async def _near(s: AsyncSession, args: dict, vec: str, floor: float, notes: int) -> dict:
    """Notes whose vector similarity reaches `floor` → {id: similarity}. Read from the vector index nearest first, in
    batches that double (starting at log2 of the number of notes) until one ends below the floor."""
    await s.execute(text("SET LOCAL hnsw.iterative_scan = strict_order"))  # keep searching the index past other users' notes
    limit = max(1, math.ceil(math.log2(notes + 1)))
    while True:
        rows = (await s.execute(text(
            f"SELECT n.id::text, 1 - (e.embedding <=> CAST(:v AS vector)) FROM {embed_table()} e JOIN notes n ON n.id = e.note_id "
            f"WHERE {SCOPE} ORDER BY e.embedding <=> CAST(:v AS vector) LIMIT :lim"), {**args, "v": vec, "lim": limit})).all()
        if len(rows) < limit or rows[-1][1] < floor:
            return {r[0]: float(r[1]) for r in rows if r[1] >= floor}
        limit *= 2

async def _similarity(s: AsyncSession, vec: str, ids: list) -> dict:
    """Vector similarity of these notes to `vec` → {id: similarity}."""
    if not ids:
        return {}
    rows = (await s.execute(text(
        f"SELECT note_id::text, 1 - (embedding <=> CAST(:v AS vector)) FROM {embed_table()} WHERE note_id = ANY(CAST(:ids AS uuid[]))"),
        {"v": vec, "ids": ids})).all()
    return {r[0]: float(r[1]) for r in rows}

async def _rarity(s: AsyncSession, uid: str, entity_ids: list) -> dict:
    """How much naming each of these says: log of the user's notes ÷ the notes naming it → {id: weight}."""
    total = (await s.execute(text("SELECT count(*) FROM notes WHERE user_id = :u"), {"u": uid})).scalar() or 1
    rows = (await s.execute(text("SELECT id::text, mentions FROM entities WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": list(entity_ids)})).all()
    return {r[0]: math.log(total / max(r[1], 1)) for r in rows}

async def _shared_names(s: AsyncSession, args: dict, names: str, params: dict) -> dict:
    """The notes naming any of `names` (a query giving entity ids: a note's names, or a question's) →
    {id: (rarity of what they share, added up; the shared names, rarest first)}."""
    rows = (await s.execute(text(
        "SELECT n.id::text, sum(ln(t.total / greatest(e.mentions, 1))), array_agg(e.name ORDER BY e.mentions) "
        f"FROM note_entities b JOIN entities e ON e.id = b.entity_id JOIN notes n ON n.id = b.note_id "
        "CROSS JOIN (SELECT count(*)::float AS total FROM notes WHERE user_id = :u) t "
        f"WHERE b.entity_id IN ({names}) AND {SCOPE} GROUP BY n.id"), {**args, **params})).all()
    return {r[0]: (float(r[1]), list(r[2])) for r in rows}

async def _words(s: AsyncSession, args: dict, words: str) -> dict:
    """How much of what the question says each note says too: its words (stemmed, filler left out), each worth how
    rare it is in the user's notes like names are, as a share of all of them → {id: share}."""
    lexemes = (await s.execute(text("SELECT array(SELECT lexeme FROM unnest(to_tsvector('english', :q)))"), {"q": words})).scalar() or []
    if not lexemes:
        return {}
    rows = (await s.execute(text(
        "SELECT w, (SELECT count(*) FROM notes n WHERE n.user_id = :u AND n.search_tsv @@ to_tsquery('english', quote_literal(w))), "
        " (SELECT count(*) FROM notes WHERE user_id = :u) FROM unnest(CAST(:w AS text[])) AS w"), {"u": args["u"], "w": lexemes})).all()
    weight = {w: math.log(total / found) for w, found, total in rows if found}
    whole = sum(weight.values()) + sum(math.log(max(total, 1)) for _, found, total in rows if not found)  # words no note has weigh most
    if not whole:
        return {}
    hits = (await s.execute(text(
        f"SELECT n.id::text, array_agg(w) FROM notes n, unnest(CAST(:w AS text[])) AS w WHERE {SCOPE} "
        "AND n.search_tsv @@ to_tsquery('english', quote_literal(w)) GROUP BY n.id"), {**args, "w": list(weight)})).all() if weight else []
    return {r[0]: sum(weight[w] for w in r[1]) / whole for r in hits}

async def _scale(s: AsyncSession, uid: str) -> dict:
    """The user's scale (measured now if it never has been)."""
    row = (await s.execute(text("SELECT * FROM note_scales WHERE user_id = :u"), {"u": uid})).mappings().first()
    return dict(row) if row else await refresh_scale(s, uid)

async def refresh_scale(s: AsyncSession, uid: str) -> dict:
    """Measure the user's scale from their notes (a sample of them, spread evenly by id) and keep it:
    typical = the median over pairs of sampled notes; close = the median over sampled notes of what each has with
    its closest other note (any of the user's notes)."""
    t = embed_table()
    ids = [r[0] for r in (await s.execute(text(
        f"SELECT n.id::text FROM notes n JOIN {t} e ON e.note_id = n.id WHERE n.user_id = :u ORDER BY md5(n.id::text) LIMIT :k"),
        {"u": uid, "k": SAMPLE})).all()]
    total = (await s.execute(text("SELECT count(*) FROM notes WHERE user_id = :u"), {"u": uid})).scalar() or 0
    meaning_typical = meaning_close = names_typical = names_close = 0.0
    if len(ids) > 1:
        await s.execute(text("SET LOCAL hnsw.iterative_scan = strict_order"))
        meaning_typical = (await s.execute(text(
            f"SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY 1 - (a.embedding <=> b.embedding)) FROM {t} a JOIN {t} b ON a.note_id < b.note_id "
            "WHERE a.note_id = ANY(CAST(:ids AS uuid[])) AND b.note_id = ANY(CAST(:ids AS uuid[]))"), {"ids": ids})).scalar()
        meaning_close = (await s.execute(text(
            f"SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY best) FROM (SELECT (SELECT 1 - (o.embedding <=> x.embedding) FROM {t} o "
            " JOIN notes m ON m.id = o.note_id WHERE m.user_id = :u AND o.note_id <> x.note_id ORDER BY o.embedding <=> x.embedding LIMIT 1) AS best "
            f" FROM {t} x WHERE x.note_id = ANY(CAST(:ids AS uuid[]))) q"), {"u": uid, "ids": ids})).scalar()
        pairs = (await s.execute(text(
            "SELECT a.note_id::text, b.note_id::text, sum(ln(:total / greatest(e.mentions, 1))) FROM note_entities a "
            "JOIN note_entities b ON b.entity_id = a.entity_id AND b.note_id <> a.note_id JOIN entities e ON e.id = a.entity_id "
            "WHERE a.note_id = ANY(CAST(:ids AS uuid[])) AND e.mentions < :total GROUP BY 1, 2"), {"ids": ids, "total": float(total)})).all()
        best = {i: 0.0 for i in ids}
        within = []
        sampled = set(ids)
        for a, b, info in pairs:
            best[a] = max(best[a], float(info))
            if b in sampled and a < b:
                within.append(float(info))
        n_pairs = len(ids) * (len(ids) - 1) // 2
        names_typical = float(np.median(within + [0.0] * (n_pairs - len(within))))  # pairs naming nothing in common count as 0
        names_close = float(np.median(list(best.values())))
    row = {"u": uid, "mt": float(meaning_typical or 0), "mc": float(meaning_close or 0), "nt": names_typical, "nc": names_close, "n": total}
    await s.execute(text(
        "INSERT INTO note_scales (user_id, meaning_typical, meaning_close, names_typical, names_close, notes, updated_at) "
        "VALUES (:u, :mt, :mc, :nt, :nc, :n, now()) ON CONFLICT (user_id) DO UPDATE SET meaning_typical = EXCLUDED.meaning_typical, "
        "meaning_close = EXCLUDED.meaning_close, names_typical = EXCLUDED.names_typical, names_close = EXCLUDED.names_close, "
        "notes = EXCLUDED.notes, updated_at = now()"), row)
    return {"meaning_typical": row["mt"], "meaning_close": row["mc"], "names_typical": row["nt"], "names_close": row["nc"], "notes": total}
