"""Read a note into a structured record with one AI call: title, summary, what kind of note it is (in the AI's words),
tags, the issues it's about, entities, the place it's about, and its promises / issues / events / tasks. Typed and
spoken notes are treated the same. Where a note belongs (its topic and category) is learned later, by clustering all
the notes together (pipeline/clusters.py)."""
import re
from datetime import datetime
import prompts
from core.llm import chat_json
from core.text import no_dashes

ITEM_KINDS = ("promise", "issue", "event", "task")

async def extract(body: str, known: list, written: datetime) -> dict:
    """The note's structured record. known: entities memory already recognised in it. Raises llm.Unavailable."""
    names = "\n".join(f"- {e['name']} ({e['kind']}{': ' + e['meaning'] if e['meaning'] else ''})" for e in known)
    raw = await chat_json(prompts.EXTRACT.format(
        known=prompts.KNOWN.format(names=names) if names else "",
        written=f"{written:%A %d %B %Y}", text=body[:6000]))
    return clean(raw, body)

def _with_named(entities: list, main_place: str, items: list) -> list:
    """The note's entities, plus its main place and the people its items name when the model left them out."""
    have = {e["name"].lower() for e in entities}
    extra = [{"name": main_place, "kind": "place", "meaning": "", "also": []}] if main_place else []
    # "who" may hold several names in one string ("SSP Harpreet Kaur, Rakesh Bansal"); only proper names are people.
    named = [w.strip() for i in items for part in i["who"] for w in re.split(r",|\band\b|&", part) if w.strip()]
    extra += [{"name": w, "kind": "person", "meaning": "", "also": []} for w in named if w[:1].isupper()]
    for e in extra:
        if e["name"].lower() not in have:
            entities.append(e)
            have.add(e["name"].lower())
    return entities

def fallback(body: str) -> dict:
    """Without an AI engine: a title from the first words (the entities memory recognised are added by resolve)."""
    first = re.split(r"(?<=[.!?])\s", body.strip(), maxsplit=1)[0]
    return {"title": " ".join(first.split()[:8]), "summary": "", "form": "", "tags": [], "relations": [],
            "entities": [], "main_place": "", "items": []}

def clean(raw: dict, body: str) -> dict:
    """Shape the model's answer: known values only, trimmed strings, no dashes, nothing empty."""
    title = _text(raw.get("title"), 80) or fallback(body)["title"]
    record = {
        "title": no_dashes(title),
        "summary": no_dashes(_text(raw.get("summary"), 400)),
        "form": _text(raw.get("kind_of_note"), 40).lower(),
        "tags": list(dict.fromkeys(t.lower() for t in _list(raw.get("tags"), 40)))[:5],
        "entities": [{"name": _text(e.get("name"), 80), "kind": _text(e.get("kind"), 20).lower(),
                      "meaning": _text(e.get("meaning"), 160), "also": _list(e.get("also"), 80)[:3]}
                     for e in raw.get("entities") or [] if isinstance(e, dict) and _text(e.get("name"), 80)][:25],
        "main_place": _text(raw.get("main_place"), 80),
        "items": [{"kind": i.get("kind"), "text": no_dashes(_text(i.get("text"), 200)),
                   "who": [w.strip() for part in _list(i.get("who"), 80) for w in re.split(r",|\band\b|&", part) if w.strip()][:6],
                   "topic": _text(i.get("topic"), 40).capitalize() if i.get("kind") == "issue" else "", "when": _text(i.get("when"), 80)}
                  for i in raw.get("items") or [] if isinstance(i, dict) and i.get("kind") in ITEM_KINDS and _text(i.get("text"), 200)][:20],
    }
    record["relations"] = [{"subject": _text(r.get("subject"), 80), "relation": _text(r.get("relation"), 60), "object": _text(r.get("object"), 80)}
                           for r in raw.get("relations") or [] if isinstance(r, dict)
                           and _text(r.get("subject"), 80) and _text(r.get("relation"), 60) and _text(r.get("object"), 80)][:12]
    record["entities"] = _with_named(record["entities"], record["main_place"], record["items"])
    # Issues are entities too ("Drugs", "Roads"): shared by notes, they tie them together like a person or place does.
    have = {e["name"].lower() for e in record["entities"]}
    for issue in dict.fromkeys(_cap(t) for t in _list(raw.get("issues"), 40)):
        if issue.lower() not in have and len(issue.split()) <= 3:
            record["entities"].append({"name": issue, "kind": "issue", "meaning": "", "also": []})
            have.add(issue.lower())
    return record

def _cap(t: str) -> str:
    """First letter capital, the rest as written ("drug reduction drive" → "Drug reduction drive")."""
    return t[:1].upper() + t[1:]

def _text(v, limit: int) -> str:
    """One trimmed line, or "" for blanks and placeholders like "none"."""
    v = " ".join(str(v or "").split()).strip(" .\"'")
    return "" if v.lower() in ("none", "n/a", "null", "unknown", "-") else v[:limit]

def _list(v, limit: int) -> list:
    """A list of trimmed, non-empty strings."""
    return [t for t in (_text(x, limit) for x in (v if isinstance(v, list) else [v] if v else [])) if t]
