"""Checklist items in a note — the "- [ ] …" lines of what it shows (its write-up for a spoken note, or the text as
typed). Ticking one changes just that line; the note isn't read again.

PATCH /notes/{id}/check      tick or untick one item, by its place among the note's checklist lines
"""
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.auth import current_user
from core.text import is_uuid
from db.session import get_session
from routes.notes import _one

router = APIRouter()
CHECK = re.compile(r"^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.*)$")

class Check(BaseModel):
    index: int
    done: bool

def checklist(t: str) -> list:
    """The checklist lines of a text, in order → [(index, done, text)]."""
    out = []
    for line in t.split("\n"):
        m = CHECK.match(line)
        if m:
            out.append((len(out), m.group(2) != " ", m.group(4).strip()))
    return out

@router.patch("/notes/{nid}/check")
async def check(nid: str, c: Check, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Tick (or untick) the index-th checklist item of what the note shows."""
    row = (await s.execute(text("SELECT raw_text, formatted FROM notes WHERE id = :n AND user_id = :u"),
                           {"n": nid, "u": uid})).mappings().first() if is_uuid(nid) else None
    if not row:
        raise HTTPException(404)
    field = "formatted" if row["formatted"] else "raw_text"
    lines, seen = row[field].split("\n"), -1
    for k, line in enumerate(lines):
        m = CHECK.match(line)
        if m:
            seen += 1
            if seen == c.index:
                lines[k] = f"{m.group(1)}{'x' if c.done else ' '}{m.group(3)}{m.group(4)}"
                break
    else:
        raise HTTPException(404, "no such checklist item")
    await s.execute(text(f"UPDATE notes SET {field} = :t, updated_at = now() WHERE id = :n"), {"t": "\n".join(lines), "n": nid})
    await s.commit()
    return await _one(s, uid, nid)
