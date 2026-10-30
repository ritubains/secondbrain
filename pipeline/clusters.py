"""Where notes belong — category › topic › note — decided by the AI, the way a thoughtful assistant would file them,
in small steps a local model gets right, with nothing about the result written into the code: no categories, no
kinds of note, no names, no examples. It runs again in the background whenever a note is saved, edited or deleted,
and what each run costs follows what changed, not how many notes there are:

  1. matter     the AI says what each note is about, in a few words named so other notes on the same matter would
                get the same name: asked once per note, kept on the note (notes.matter), its vector kept too
                (matter_vectors), so only new names are embedded
  2. topics     matters that mean the same are one topic: for each matter, the few closest in meaning (log2 of how
                many there are) are put to the AI as a yes/no question, "the same problem, case or plan?", and the
                yeses join; every answer is kept (matter_pairs), so a regroup only asks about new pairs
  3. categories the AI groups the topics into the broad areas of the person's life or work and names them, all at
                once while the list fits what the model can read (core/llm.py measures it); past that, topics that
                continue an old one stay in its area and only new topics are placed, one by one. When no topic
                changed, nothing is asked. Areas and topics the person named themselves keep their names
  4. stored     as topics (level category / topic, parent_id up the tree) and note_topics; a note's bucket is its
                category's name. A group keeps the id and name of the old one when they're mostly (more than half)
                the same notes; ideas the user put a note in by hand stay. Only what changed is written.

Each run also measures the user's scale for connections again (pipeline/links.py).

schedule()   file a user's notes again soon, in the background (calls while it runs mean one more run after)
recluster()  do it now
settled()    wait until filing that's running for a user has finished (the screens then reload)
"""
import asyncio
import logging
import math
import numpy as np
from sqlalchemy import text
import prompts
from core.llm import Unavailable, chat_json, embed, embed_model, reply_room, tokens, window
from core.text import key
from db.session import Session
from pipeline import links

log = logging.getLogger("bigbutter.clusters")

_running: dict = {}
_again: set = set()

def schedule(uid: str, delay: float = 2.0) -> None:
    """File this user's notes again soon, in the background. Saves in quick succession make one run (plus one after,
    if something changed while it ran)."""
    task = _running.get(uid)
    if task and not task.done():
        _again.add(uid)
        return
    _running[uid] = asyncio.create_task(_loop(uid, delay))

async def settled(uid: str) -> None:
    """Wait for the user's filing to finish, if it's running or about to (at once if not). A caller giving up early
    doesn't stop it."""
    task = _running.get(uid)
    if task and not task.done():
        await asyncio.shield(task)

async def _loop(uid: str, delay: float) -> None:
    await asyncio.sleep(delay)
    while True:
        _again.discard(uid)
        try:
            await recluster(uid)
        except Exception:
            log.exception("filing failed user=%s", uid)
        if uid not in _again:
            break

async def recluster(uid: str) -> dict:
    """File all of the user's notes into categories and topics (the AI's judgment), and store what changed."""
    async with Session() as s:
        await links.refresh_scale(s, uid)
        await s.commit()
        notes = [dict(r) for r in (await s.execute(text(
            "SELECT id::text AS id, coalesce(nullif(title, ''), left(raw_text, 60)) AS title, "
            # a note the AI hasn't read yet has no summary: its start stands in
            "coalesce(nullif(summary, ''), left(raw_text, 300)) AS says, matter FROM notes WHERE user_id = :u AND raw_text <> '' "
            "ORDER BY created_at"), {"u": uid})).mappings().all()]
        old = await _old_ideas(s, uid)
    if not notes:
        return {"categories": 0, "topics": 0}
    try:
        await _matters(notes)
        topics = await _topics(uid, notes)
        t_match = _match([t["notes"] for t in topics], [o for o in old if o["level"] == "topic"])
        categories = await _categories(topics, t_match, old)
    except Unavailable as e:
        log.info("filing skipped, no AI (%s) user=%s", e, uid)
        return {"categories": 0, "topics": 0}
    plan = _plan(categories, topics, t_match, old)
    async with Session() as s:
        await _store(s, uid, plan, old)
        await s.commit()
    n_topics = sum(len(c["topics"]) for c in plan)
    log.info("filed user=%s: %d notes → %d categories, %d topics", uid, len(notes), len(plan), n_topics)
    return {"categories": len(plan), "topics": n_topics}

async def _matters(notes: list) -> None:
    """What each note is about, in the AI's words: asked once per note and kept on it."""
    for n in notes:
        if n["matter"]:
            continue
        raw = await chat_json(prompts.MATTER.format(note=f"{n['title']}: {n['says']}"))
        n["matter"] = " ".join(str(raw.get("matter") or n["title"]).split())[:60]
        async with Session() as s:
            await s.execute(text("UPDATE notes SET matter = :m WHERE id = :n"), {"m": n["matter"], "n": n["id"]})
            await s.commit()

async def _vectors(uid: str, labels: list) -> np.ndarray:
    """Unit vectors for these names, in order: kept ones read back, new ones embedded and kept."""
    model = embed_model()
    async with Session() as s:
        kept = dict((await s.execute(text(
            "SELECT name, embedding::text FROM matter_vectors WHERE user_id = :u AND model = :m AND name = ANY(:names)"),
            {"u": uid, "m": model, "names": labels})).all())
        for name in labels:
            if name not in kept:
                kept[name] = str(await embed(name))
                await s.execute(text("INSERT INTO matter_vectors (user_id, name, model, embedding) VALUES (:u, :n, :m, CAST(:v AS vector)) "
                                     "ON CONFLICT DO NOTHING"), {"u": uid, "n": name, "m": model, "v": kept[name]})
        await s.commit()
    vecs = np.array([[float(x) for x in kept[name].strip("[]").split(",")] for name in labels], dtype=np.float32)
    lengths = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / np.where(lengths == 0, 1, lengths)

async def _topics(uid: str, notes: list) -> list:
    """Matters that mean the same, joined into topics → [{"name", "notes": [ids], "titles"}], biggest first. Which
    matters are put to the AI: each one's closest in meaning (how many: log2 of how many matters there are); its
    yes/no decides."""
    labels = sorted({n["matter"] for n in notes})
    says = {n["matter"]: n["says"] for n in notes}
    vecs = await _vectors(uid, labels)
    k = max(1, math.ceil(math.log2(len(labels) + 1)) - 1)
    parent = {m: m for m in labels}
    name = {m: m for m in labels}
    async with Session() as s:
        known = {(r[0], r[1]): (r[2], r[3]) for r in (await s.execute(text(
            "SELECT a, b, same, name FROM matter_pairs WHERE user_id = :u"), {"u": uid})).all()}
    for i, a in enumerate(labels):
        near = vecs @ vecs[i]  # one row at a time: memory stays in step with the number of matters
        near[i] = -np.inf
        for j in np.argpartition(-near, min(k, len(labels) - 1))[:k] if len(labels) > 1 else []:
            pair = tuple(sorted((a, labels[j])))
            if pair not in known:
                raw = await chat_json(prompts.SAME.format(a=pair[0], b=pair[1], ea=says[pair[0]], eb=says[pair[1]]))
                known[pair] = (raw.get("same") is True, " ".join(str(raw.get("name") or "").split())[:60])
                async with Session() as s:
                    await s.execute(text("INSERT INTO matter_pairs (user_id, a, b, same, name) VALUES (:u, :a, :b, :s, :n) ON CONFLICT DO NOTHING"),
                                    {"u": uid, "a": pair[0], "b": pair[1], "s": known[pair][0], "n": known[pair][1]})
                    await s.commit()
            same, both = known[pair]
            ra, rb = _root(parent, pair[0]), _root(parent, pair[1])
            if same and ra != rb:
                parent[rb] = ra
                name[ra] = both or name[ra]
    groups: dict = {}
    for n in notes:
        groups.setdefault(_root(parent, n["matter"]), []).append(n["id"])
    title = {n["id"]: n["title"] for n in notes}
    return sorted([{"name": name[r], "notes": ids, "titles": [title[i] for i in ids]} for r, ids in groups.items()], key=lambda t: -len(t["notes"]))

def _root(parent: dict, m: str) -> str:
    """The matter a merged group is known by: follow the joins up to the one that wasn't joined to another."""
    while parent[m] != m:
        m = parent[m]
    return m

async def _categories(topics: list, t_match: dict, old: list) -> list:
    """The topics in the broad areas of the person's life or work → [{"name", "topics": [...]}], biggest first. When
    the topics changed, all are grouped again at once while they fit in one prompt; past that (or when nothing
    changed), each topic that continues an old one stays in that one's area and new topics are placed one by one."""
    theirs = [o["name"] for o in old if o["level"] == "category" and o["origin"] == "you"]
    unchanged = len(t_match) == len(topics) == sum(o["level"] == "topic" for o in old) and \
        all(set(t["notes"]) == t_match[k]["notes"] for k, t in enumerate(topics))
    listing = "\n".join(f"{k}. {t['name']} (notes: {', '.join(t['titles'])})" for k, t in enumerate(topics, 1))
    prompt = prompts.GROUP.format(topics=listing, theirs=prompts.THEIRS.format(names=", ".join(theirs)) if theirs else "")
    if not unchanged and tokens(prompt) <= await window() - await reply_room():
        return _grouped(topics, await chat_json(prompt))
    by_id = {o["id"]: o for o in old}
    areas: dict = {}
    for k, t in enumerate(topics):
        was = t_match.get(k)
        home = by_id.get(was["parent_id"]) if was else None
        if home:
            areas.setdefault(home["name"], []).append(t)
            continue
        raw = await chat_json(prompts.PLACE.format(areas="; ".join(sorted({*areas, *theirs})) or "none yet",
                                                   topic=t["name"], titles=", ".join(t["titles"])))
        said = " ".join(str(raw.get("area") or t["name"]).split())[:60]
        same = next((a for a in {*areas, *theirs} if key(a) == key(said)), said)  # an area it named again, in other case or spacing
        areas.setdefault(same, []).append(t)
    out = [{"name": a, "topics": ts} for a, ts in areas.items()]
    return sorted(out, key=lambda c: -sum(len(t["notes"]) for t in c["topics"]))

def _grouped(topics: list, raw: dict) -> list:
    """The AI's grouping (areas listing topics by number) → [{"name", "topics": [...]}], biggest first; a topic it
    left out stands as its own area, named like it."""
    out, placed = [], set()
    for area in raw.get("areas") or []:
        picks = [int(x) - 1 for x in area.get("topics") or [] if str(x).isdigit() and 0 < int(x) <= len(topics)]
        mine = [i for i in dict.fromkeys(picks) if i not in placed]
        placed |= set(mine)
        if mine:
            out.append({"name": " ".join(str(area.get("name") or topics[mine[0]]["name"]).split())[:60], "topics": [topics[i] for i in mine]})
    out += [{"name": t["name"], "topics": [t]} for k, t in enumerate(topics) if k not in placed]
    return sorted(out, key=lambda c: -sum(len(t["notes"]) for t in c["topics"]))

async def _old_ideas(s, uid: str) -> list:
    """The ideas as they are now, with the notes in each (a category: the notes of its topics), not counting ones the
    user put there by hand: [{id, name, origin, level, parent_id, notes: set}]."""
    rows = (await s.execute(text(
        "SELECT t.id::text AS id, t.name, t.origin, t.level, t.parent_id::text AS parent_id, "
        "coalesce(array_agg(nt.note_id::text) FILTER (WHERE nt.note_id IS NOT NULL AND NOT nt.by_you), '{}') AS notes "
        "FROM topics t LEFT JOIN topics c ON c.parent_id = t.id AND t.level = 'category' "
        "LEFT JOIN note_topics nt ON nt.topic_id = coalesce(c.id, t.id) WHERE t.user_id = :u GROUP BY t.id"), {"u": uid})).mappings().all()
    return [dict(r, notes=set(r["notes"])) for r in rows]

def _match(new: list, old: list) -> dict:
    """Pair each new group with the old idea it continues: the one it overlaps most (Jaccard: shared ÷ all), when
    that old idea also overlaps this group more than any other, and they're mostly (more than half) the same notes
    → {group index: old idea}. Overlaps are counted through the notes, so the work follows the number of notes."""
    where = {}
    for o in old:
        for nid in o["notes"]:
            where.setdefault(nid, []).append(o["id"])
    by_id = {o["id"]: o for o in old}
    shared: dict = {}  # (group, old id) → notes in both
    for gi, ids in enumerate(new):
        for nid in ids:
            for oid in where.get(nid, ()):
                shared[gi, oid] = shared.get((gi, oid), 0) + 1
    jaccard = {(gi, oid): n / (len(new[gi]) + len(by_id[oid]["notes"]) - n) for (gi, oid), n in shared.items()}
    best_old: dict = {}
    best_new: dict = {}
    for (gi, oid), j in jaccard.items():
        if j > best_old.get(gi, (None, 0))[1]:
            best_old[gi] = (oid, j)
        if j > best_new.get(oid, (None, 0))[1]:
            best_new[oid] = (gi, j)
    return {gi: by_id[oid] for gi, (oid, j) in best_old.items() if j > 0.5 and best_new[oid][0] == gi}

def _plan(categories: list, topics: list, t_match: dict, old: list) -> list:
    """The tree to store: each group with the id of the old one it continues (if any). A name the user gave stays; an
    automatic one takes the AI's fresh name."""
    index = {id(t): k for k, t in enumerate(topics)}
    c_match = _match([[i for t in c["topics"] for i in t["notes"]] for c in categories], [o for o in old if o["level"] == "category"])
    plans = []
    for ci, c in enumerate(categories):
        cid, cname = _continues(c_match.get(ci), c["name"])
        mine = []
        for t in c["topics"]:
            tid, tname = _continues(t_match.get(index[id(t)]), t["name"])
            mine.append({"id": tid, "name": tname, "notes": t["notes"]})
        plans.append({"id": cid, "name": cname, "topics": mine})
    return plans

def _continues(old: dict | None, fresh: str) -> tuple:
    """(id, name) for a group: the old idea's id when it continues one, and its name if the user gave it."""
    return (old["id"] if old else None, old["name"] if old and old["origin"] == "you" else fresh)

async def _store(s, uid: str, plan: list, old: list) -> None:
    """Write what changed: ideas renamed, moved or new; note memberships added and removed; buckets that differ; and
    ideas nothing continues removed (unless the user named them or put a note in them by hand)."""
    by_id = {o["id"]: o for o in old}
    keep, wanted = [], set()
    for cat in plan:
        cid = await _topic(s, uid, cat, None, "category", by_id)
        keep.append(cid)
        for t in cat["topics"]:
            tid = await _topic(s, uid, t, cid, "topic", by_id)
            keep.append(tid)
            wanted |= {(nid, tid) for nid in t["notes"]}
        await s.execute(text("UPDATE notes SET bucket = :b WHERE id = ANY(CAST(:ids AS uuid[])) AND bucket IS DISTINCT FROM :b"),
                        {"b": cat["name"], "ids": [nid for t in cat["topics"] for nid in t["notes"]]})
    now = {(str(r[0]), str(r[1])) for r in (await s.execute(text(
        "SELECT nt.note_id, nt.topic_id FROM note_topics nt JOIN topics t ON t.id = nt.topic_id WHERE t.user_id = :u AND NOT nt.by_you"),
        {"u": uid})).all()}
    for nid, tid in now - wanted:
        await s.execute(text("DELETE FROM note_topics WHERE note_id = :n AND topic_id = :t AND NOT by_you"), {"n": nid, "t": tid})
    for nid, tid in wanted - now:
        await s.execute(text("INSERT INTO note_topics (note_id, topic_id) VALUES (:n, :t) ON CONFLICT DO NOTHING"), {"n": nid, "t": tid})
    await s.execute(text(
        "DELETE FROM topics t WHERE t.user_id = :u AND t.origin = 'auto' AND NOT (t.id = ANY(CAST(:keep AS uuid[]))) "
        "AND NOT EXISTS (SELECT 1 FROM note_topics nt WHERE nt.topic_id = t.id)"), {"u": uid, "keep": keep})

async def _topic(s, uid: str, group: dict, parent: str | None, level: str, by_id: dict) -> str:
    """The idea for a group: the old one (renamed if the AI's name changed, moved if its parent did), or a new one."""
    was = by_id.get(group["id"]) if group["id"] else None
    if was:
        if (was["name"], was["parent_id"], was["level"]) != (group["name"], parent, level):
            await s.execute(text(
                "UPDATE topics SET parent_id = :p, level = :l, name = CASE WHEN origin = 'you' THEN name ELSE :n END, "
                "key = CASE WHEN origin = 'you' THEN key ELSE :k END, updated_at = now() WHERE id = :t"),
                {"p": parent, "l": level, "n": group["name"], "k": key(group["name"]) or group["name"].lower(), "t": was["id"]})
        return was["id"]
    return (await s.execute(text(
        "INSERT INTO topics (user_id, name, key, parent_id, level) VALUES (:u, :n, :k, :p, :l) "
        "ON CONFLICT (user_id, level, key) DO UPDATE SET parent_id = EXCLUDED.parent_id, updated_at = now() "
        "RETURNING id::text"), {"u": uid, "n": group["name"], "k": key(group["name"]) or group["name"].lower(), "p": parent, "l": level})).scalar()
