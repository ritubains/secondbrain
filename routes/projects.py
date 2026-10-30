"""Projects: a named context — description and instructions the chat always reads — holding notes and conversations,
like a project in Claude. Deleting a project keeps its notes (they just leave the project)."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.auth import current_user
from core.text import is_uuid
from db.queries import NOTE_COLUMNS, note_row
from db.session import get_session

router = APIRouter()

class ProjectIn(BaseModel):
    name: str
    description: str = ""
    instructions: str = ""   # what the chat should know or do in this project

class NoteIds(BaseModel):
    note_ids: list[str]

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None

PROJECT_COLUMNS = ("p.id, p.name, p.description, p.instructions, p.created_at, p.updated_at, "
                   "(SELECT count(*) FROM notes n WHERE n.project_id = p.id) AS notes, "
                   "(SELECT count(*) FROM conversations c WHERE c.project_id = p.id) AS conversations, "
                   "greatest(p.updated_at, (SELECT max(n.created_at) FROM notes n WHERE n.project_id = p.id), "
                   "(SELECT max(c.updated_at) FROM conversations c WHERE c.project_id = p.id)) AS active_at")

def _project(r) -> dict:
    """A project row → dict with a string id."""
    return dict(r, id=str(r["id"]))

async def _get(s: AsyncSession, uid: str, pid: str) -> dict:
    """The user's project, or 404."""
    row = (await s.execute(text(f"SELECT {PROJECT_COLUMNS} FROM projects p WHERE p.id = :p AND p.user_id = :u"),
                           {"p": pid, "u": uid})).mappings().first() if is_uuid(pid) else None
    if not row:
        raise HTTPException(404)
    return _project(row)

@router.get("/projects")
async def list_projects(uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Every project, most recently active first."""
    rows = (await s.execute(text(f"SELECT {PROJECT_COLUMNS} FROM projects p WHERE p.user_id = :u ORDER BY active_at DESC"),
                            {"u": uid})).mappings().all()
    return {"projects": [_project(r) for r in rows]}

@router.post("/projects")
async def create_project(p: ProjectIn, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """A new project."""
    if not p.name.strip():
        raise HTTPException(422, "a project needs a name")
    pid = (await s.execute(text("INSERT INTO projects (user_id, name, description, instructions) VALUES (:u, :n, :d, :i) RETURNING id"),
                           {"u": uid, "n": p.name.strip()[:80], "d": p.description.strip()[:2000], "i": p.instructions.strip()[:4000]})).scalar()
    await s.commit()
    return await _get(s, uid, str(pid))

@router.get("/projects/{pid}")
async def read_project(pid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """A project with its notes and conversations, newest first."""
    project = await _get(s, uid, pid)
    project["notes"] = [note_row(r) for r in (await s.execute(text(
        f"SELECT {NOTE_COLUMNS} FROM notes n WHERE n.user_id = :u AND n.project_id = :p ORDER BY n.created_at DESC LIMIT 200"),
        {"u": uid, "p": pid})).mappings().all()]
    project["conversation_list"] = [dict(r, id=str(r["id"])) for r in (await s.execute(text(
        "SELECT id, title, updated_at FROM conversations WHERE user_id = :u AND project_id = :p ORDER BY updated_at DESC"),
        {"u": uid, "p": pid})).mappings().all()]
    return project

@router.put("/projects/{pid}")
async def update_project(pid: str, p: ProjectUpdate, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Rename a project or change its description / instructions."""
    await _get(s, uid, pid)
    values = {"name": (p.name or "").strip()[:80] or None, "description": p.description, "instructions": p.instructions}
    for column, value in values.items():  # column names come from the code, never from the request
        if value is not None:
            await s.execute(text(f"UPDATE projects SET {column} = :v, updated_at = now() WHERE id = :p"), {"v": value.strip(), "p": pid})
    await s.commit()
    return await _get(s, uid, pid)

@router.delete("/projects/{pid}")
async def delete_project(pid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a project and its conversations; its notes stay, outside any project."""
    await _get(s, uid, pid)
    await s.execute(text("DELETE FROM projects WHERE id = :p"), {"p": pid})
    await s.commit()
    return {"ok": True}

@router.post("/projects/{pid}/notes")
async def add_notes(pid: str, body: NoteIds, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Move existing notes into this project."""
    await _get(s, uid, pid)
    ids = [i for i in body.note_ids if is_uuid(i)][:200]
    await s.execute(text("UPDATE notes SET project_id = :p WHERE user_id = :u AND id = ANY(CAST(:ids AS uuid[]))"), {"p": pid, "u": uid, "ids": ids})
    await s.execute(text("UPDATE projects SET updated_at = now() WHERE id = :p"), {"p": pid})
    await s.commit()
    return {"ok": True, "added": len(ids)}

@router.delete("/projects/{pid}/notes/{nid}")
async def remove_note(pid: str, nid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Take a note out of this project (the note stays)."""
    await _get(s, uid, pid)
    if is_uuid(nid):
        await s.execute(text("UPDATE notes SET project_id = NULL WHERE id = :n AND user_id = :u AND project_id = :p"), {"n": nid, "u": uid, "p": pid})
        await s.commit()
    return {"ok": True}
