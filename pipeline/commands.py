"""Instructions, said or typed in place of (or along with) a note:

  "create a project Drug free ward and put this note in it"     "move my last note to the Election project"
  "add my PhD notes to the Exploration project"                 "star this" · "pin my pension notes" · "unpin it"
  "rename the idea Meetings to Daily schedule"                  "merge Meetings into Schedule"

Only text that asks something in those words (GATES) is read by the AI, so ordinary notes save as fast as ever. The
AI says what's asked as a list of actions; then rules keep it honest — project and idea names must be ones the user
said (or has), an instruction must point at notes ("this", "my last note", "my PhD notes") unless it only creates a
project, and text that is all note ("finish the project report") stays a note.

understand()  → None for a plain note, or {actions: [...], note: "what's left to save as a note"}
carry_out()   do the actions → (what this new note gets: {project_id, pinned, starred}, ["Created project …", …])
"""
import difflib
import re
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import prompts
from core.llm import Unavailable, chat_json
from core.text import NAME_SIM, key
from pipeline import topics

# Wording that may be an instruction: about projects, pinning and starring, or reshaping ideas.
GATES = [
    re.compile(r"\b(create|make|start|set up|new|add|put|move|file|save|keep|shift|assign)\b[^.?!\n]{0,80}\bprojects?\b", re.I),
    re.compile(r"\b(pin|unpin|star|unstar|favou?rite|bookmark)\b|\bmark\b[^.?!\n]{0,40}\b(important|urgent|starred)\b|\bas important\b", re.I),
    re.compile(r"\b(rename|merge|combine|join)\b[^.?!\n]{0,60}\b(ideas?|topics?|folders?|groups?)\b|\b(ideas?|topics?|folders?)\b[^.?!\n]{0,40}\b(rename|merge)\b"
               r"|^\s*(?:please\s+)?(rename|merge|combine)\b[^.?!\n]{1,60}\b(to|into|with)\b", re.I),
]
# An instruction about notes points at them ("this", "it", "my last note", "my PhD notes") — unless it creates a project.
POINTS = re.compile(r"\b(this|it|that|last|previous|latest|notes?|recordings?|ideas?|topics?|folders?)\b", re.I)
# "my street light notes", "notes about PhD", "notes related to the pond" → the subject, when the model misses it.
SUBJECT = re.compile(r"\bnotes?\s+(?:about|on|related to|regarding|of|for)\s+(?:the\s+|my\s+)?([\w' -]+?)(?=\s+(?:to|in|into|under|inside|as)\b|[,.]|$)"
                     r"|\b(?:all\s+)?(?:my|the)\s+([\w' -]+?)\s+notes\b", re.I)
# Words that say nothing about which notes are meant ("my PhD notes" → PhD).
FILLER = {"my", "all", "the", "notes", "note", "about", "related", "regarding", "on", "of", "to", "and", "any", "every", "existing", "last"}
ACTIONS = {"create_project", "move", "pin", "unpin", "star", "unstar", "rename_idea", "merge_ideas"}

def asks(t: str) -> bool:
    """Whether some part of the text is worded like an instruction."""
    return any(g.search(t) for g in GATES)

async def understand(s: AsyncSession, uid: str, body: str) -> dict | None:
    """What the text asks the app to do, or None when it's a plain note (or the AI isn't there to tell)."""
    if not asks(body):
        return None
    projects = [r[0] for r in (await s.execute(text("SELECT name FROM projects WHERE user_id = :u ORDER BY updated_at DESC LIMIT 40"), {"u": uid})).all()]
    ideas = [r[0] for r in (await s.execute(text("SELECT name FROM topics WHERE user_id = :u ORDER BY updated_at DESC LIMIT 60"), {"u": uid})).all()]
    try:
        raw = await chat_json(prompts.COMMAND.format(projects="; ".join(projects) or "none yet", ideas="; ".join(ideas) or "none yet", text=body[:2000]))
    except Unavailable:
        return None
    asking = " ".join(p for p in _parts(body) if asks(p))
    found = SUBJECT.search(asking)
    subject = (found.group(1) or found.group(2)) if found else ""
    actions = []
    for a in raw.get("actions") or []:
        if not isinstance(a, dict) or a.get("do") not in ACTIONS:
            continue
        do = a["do"]
        if do == "create_project":
            name = _name(a.get("name") or a.get("project"))
            if _said(name, body):
                actions.append({"do": do, "name": name})
        elif do == "rename_idea":
            idea, to = _clean(a.get("idea") or a.get("name")), _clean(a.get("to"))
            if idea and _said(to, body) and _closest(idea, ideas):
                actions.append({"do": do, "idea": _closest(idea, ideas), "to": to[:1].upper() + to[1:]})
        elif do == "merge_ideas":
            idea, into = _closest(_clean(a.get("idea") or a.get("name")), ideas), _closest(_clean(a.get("into")), ideas)
            if idea and into and idea != into:
                actions.append({"do": do, "idea": idea, "into": into})
        else:  # move, pin, unpin, star, unstar: which notes
            about = _clean(a.get("about")) or (subject if a.get("which") == "about" else "")
            which = "about" if about and about.lower() not in FILLER else a.get("which") if a.get("which") in ("this", "last") else "this"
            act = {"do": do, "which": which, "about": about if which == "about" else ""}
            if do == "move":
                act["project"] = _name(a.get("project"))
                if not _said(act["project"], body) and not any(c["name"].lower() == act["project"].lower() for c in actions if c["do"] == "create_project"):
                    continue
            actions.append(act)
    if not actions or (raw.get("instruction") is False and not actions):
        return None
    about_notes = [x for x in actions if x["do"] not in ("create_project", "rename_idea", "merge_ideas")]
    if about_notes and not any(x["do"] == "create_project" for x in actions) and not POINTS.search(asking):
        return None  # "add more volunteers to the booth project": about a project, not asking the app anything
    note = _rest(body)
    if note and len(_squash(note)) >= 0.9 * len(_squash(body)):
        return None  # nothing was left out: it's all note
    # "make a project X and add this: …" — a new project with a note and no move means the note goes in it.
    made = [x["name"] for x in actions if x["do"] == "create_project"]
    if made and note and not any(x["do"] == "move" for x in actions):
        actions.append({"do": "move", "project": made[0], "which": "this", "about": ""})
    for x in actions:  # "this" with nothing left to save means the note just before
        if x.get("which") == "this" and not note:
            x["which"] = "last"
    return {"actions": actions, "note": note}

def _parts(body: str) -> list:
    return [p for p in re.split(r"(?<=[.!?])\s+|\n+", body.strip()) if p.strip()]

def _rest(body: str) -> str:
    """The note once the instructions are taken out: the sentences that don't ask for anything, and what follows a
    colon after an instruction ("make a project X and add this: contractor starts Monday" → "contractor starts Monday").
    An instruction tacked on after a comma ("…patrol after 9 pm, star this") is cut off too. By rule, not the model:
    a model drops or keeps the wrong part too often."""
    kept = []
    for part in _parts(body):
        if not asks(part):
            kept.append(part.strip())
            continue
        head, colon, tail = part.partition(":")
        if colon and asks(head) and tail.strip():
            kept.append(tail.strip())
            continue
        # "…after 9 pm, and star this" → keep what comes before the clause that asks
        clauses = re.split(r",\s*(?:and\s+|also\s+|please\s+)?|\s+and\s+(?=(?:please\s+)?(?:pin|star|mark|put|move|add|create|make)\b)", part)
        before = []
        for c in clauses:
            if asks(c):
                break
            before.append(c.strip())
        if before and len(" ".join(before).split()) >= 3:
            kept.append(", ".join(before).rstrip(".") + ".")
    rest = " ".join(kept)
    return rest if len(rest.split()) >= 3 else ""

async def carry_out(s: AsyncSession, uid: str, asked: dict) -> tuple:
    """Do the actions → ({project_id, pinned, starred} for the note being saved now, ["what was done", …])."""
    did, mine, made = [], {}, {}
    for a in asked["actions"]:
        do = a["do"]
        if do == "create_project":
            pid, new = await _project(s, uid, a["name"])
            made[a["name"].lower()] = pid
            did.append(f"Created project “{a['name']}”" if new else f"Project “{a['name']}” already exists")
        elif do == "rename_idea":
            tid = (await s.execute(text("SELECT id FROM topics WHERE user_id = :u AND name = :o LIMIT 1"), {"u": uid, "o": a["idea"]})).scalar()
            await topics.rename(s, uid, str(tid), a["to"])
            did.append(f"Renamed the idea “{a['idea']}” to “{a['to']}”")
        elif do == "merge_ideas":
            ids = dict((await s.execute(text("SELECT name, id FROM topics WHERE user_id = :u AND name = ANY(:names)"),
                                        {"u": uid, "names": [a["idea"], a["into"]]})).all())
            # Kept as the user's doing, so the next clustering doesn't pull them apart again.
            await s.execute(text("INSERT INTO note_topics (note_id, topic_id, by_you) SELECT note_id, :into, true FROM note_topics "
                                 "WHERE topic_id = :from ON CONFLICT (note_id, topic_id) DO UPDATE SET by_you = true"),
                            {"into": ids[a["into"]], "from": ids[a["idea"]]})
            await s.execute(text("UPDATE topics SET origin = 'you' WHERE id = :t"), {"t": ids[a["into"]]})
            await s.execute(text("DELETE FROM topics WHERE id = :t"), {"t": ids[a["idea"]]})
            did.append(f"Merged “{a['idea']}” into “{a['into']}”")
        else:
            field, value, label = {"move": ("project_id", None, ""), "pin": ("pinned", True, "Pinned"), "unpin": ("pinned", False, "Unpinned"),
                                   "star": ("starred", True, "Starred"), "unstar": ("starred", False, "Unstarred")}[do]
            if do == "move":
                value = made.get(a["project"].lower())
                if value is None:
                    value, new = await _project(s, uid, a["project"])
                    if new:
                        did.append(f"Created project “{a['project']}”")
                pname = (await s.execute(text("SELECT name FROM projects WHERE id = :p"), {"p": value})).scalar()
            if a["which"] == "this":
                mine[field] = value
                did.append(f"Put this note in {pname}" if do == "move" else f"{label} this note")
                continue
            targets = await _about(s, uid, a["about"]) if a["which"] == "about" else await _last(s, uid)
            for nid, _ in targets:
                await s.execute(text(f"UPDATE notes SET {field} = :v, updated_at = now() WHERE id = :n"), {"v": value, "n": nid})
            names = ", ".join(f"“{t}”" for _, t in targets[:5]) + (f" and {len(targets) - 5} more" if len(targets) > 5 else "")
            what = (f"{len(targets)} note{'s' if len(targets) != 1 else ''} about {a['about']}" if a["which"] == "about" else names)
            if not targets:
                did.append(f"Found no notes about {a['about']}" if a["which"] == "about" else "There's no earlier note")
            elif do == "move":
                did.append(f"Put {what} in {pname}" + (f": {names}" if a["which"] == "about" else ""))
            else:
                did.append(f"{label} {what}" + (f": {names}" if a["which"] == "about" else ""))
    return mine, did

async def _last(s: AsyncSession, uid: str) -> list:
    """The user's latest note → [(id, title)]."""
    row = (await s.execute(text("SELECT id, coalesce(nullif(title, ''), left(raw_text, 40)) FROM notes WHERE user_id = :u "
                                "ORDER BY created_at DESC LIMIT 1"), {"u": uid})).first()
    return [(str(row[0]), row[1])] if row else []

async def _about(s: AsyncSession, uid: str, subject: str) -> list:
    """The user's notes on a subject → [(id, title)]: those in an idea, or mentioning a person, place or issue, whose
    name has its words, and those whose own text has every one of its words ("phd" in "list of all phd
    professors"). Strict on purpose — notes that are only connected or similar aren't moved."""
    words = [w for w in re.findall(r"[a-z0-9]+", subject.lower()) if w not in FILLER and len(w) >= 2]
    if not words:
        return []
    rows = (await s.execute(text(
        "SELECT n.id, coalesce(nullif(n.title, ''), left(n.raw_text, 40)) AS title, n.raw_text || ' ' || n.title || ' ' || "
        "coalesce((SELECT string_agg(t.name, ' ') FROM note_topics nt JOIN topics t ON t.id = nt.topic_id WHERE nt.note_id = n.id), '') || ' ' || "
        "coalesce((SELECT string_agg(e.name, ' ') FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = n.id), '') AS said "
        "FROM notes n WHERE n.user_id = :u ORDER BY n.created_at DESC"), {"u": uid})).all()
    stems = [w.rstrip("s")[:6] if len(w) > 3 else w for w in words]  # "street lights" finds "street light"
    return [(str(r[0]), r[1]) for r in rows if all(re.search(r"\b" + re.escape(w), r[2].lower()) for w in stems)][:50]

async def _project(s: AsyncSession, uid: str, name: str) -> tuple:
    """The user's project with this name (any case, or spelled almost the same), or a new one → (id, created)."""
    rows = (await s.execute(text("SELECT id, name FROM projects WHERE user_id = :u"), {"u": uid})).all()
    by_low = {r[1].lower(): str(r[0]) for r in rows}
    near = difflib.get_close_matches(name.lower(), list(by_low), n=1, cutoff=0.85)
    if near:
        return by_low[near[0]], False
    pid = (await s.execute(text("INSERT INTO projects (user_id, name) VALUES (:u, :n) RETURNING id"), {"u": uid, "n": (name[:1].upper() + name[1:])[:80]})).scalar()
    return str(pid), True

def _said(name: str, body: str) -> bool:
    """Whether the user actually wrote this name in the text (ignoring case, spaces and punctuation)."""
    return bool(name) and _squash(name) in _squash(body)

def _closest(name: str, ideas: list) -> str:
    """The user's idea this name means (same, or spelled almost the same), or ""."""
    if not name:
        return ""
    by_key = {key(i): i for i in ideas}
    if key(name) in by_key:
        return by_key[key(name)]
    near = difflib.get_close_matches(key(name), list(by_key), n=1, cutoff=NAME_SIM)
    return by_key[near[0]] if near else ""

def _squash(t: str) -> str:
    """Lowercase letters and digits only, to see whether a name appears in the text."""
    return re.sub(r"[^a-z0-9]", "", t.lower())

def _clean(v) -> str:
    """One line from the AI, without quotes."""
    v = " ".join(str(v or "").split()).strip(" .\"'“”")
    return "" if v.lower() in ("none", "empty", "n/a") else v[:80]

def _name(v) -> str:
    """A project name from the AI: one line, without quotes or a trailing "project"."""
    return re.sub(r"(?i)^(the|a|an)\s+|\s+project$", "", _clean(v))
