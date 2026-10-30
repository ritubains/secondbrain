"""Chat with your notes: ask in plain language, get an answer with the notes it came from, and keep the
conversation — inside a project or across everything."""
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from chat.answer import reply
from core import memory
from core.auth import current_user
from core.config import settings
from core.text import is_uuid
from db.queries import notes_by_id
from db.session import get_session

router = APIRouter()

class Question(BaseModel):
    message: str
    conversation_id: Optional[str] = None   # continue this conversation; none = start one
    project_id: Optional[str] = None        # where a new conversation lives

@router.post("/chat")
async def ask(q: Question, tasks: BackgroundTasks, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Answer one question. → {conversation, answer, notes}"""
    message = q.message.strip()[:2000]
    if not message:
        raise HTTPException(422, "empty question")
    if q.project_id and (not is_uuid(q.project_id) or not (await s.execute(
            text("SELECT 1 FROM projects WHERE id = :p AND user_id = :u"), {"p": q.project_id, "u": uid})).first()):
        raise HTTPException(404, "no such project")
    cid = q.conversation_id if q.conversation_id and is_uuid(q.conversation_id) else None
    result = await reply(s, uid, message, cid, q.project_id)
    if settings.memory_learn_from_chat:  # off by default: ~12 s of a local model per question
        tasks.add_task(memory.remember, uid, message, result["conversation"]["project_id"], source="chat")
    return result

@router.get("/conversations")
async def conversations(project_id: Optional[str] = None, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Conversations, most recent first — one project's, or all of them."""
    rows = (await s.execute(text(
        "SELECT c.id, c.title, c.project_id, c.updated_at, p.name AS project FROM conversations c LEFT JOIN projects p ON p.id = c.project_id "
        "WHERE c.user_id = :u AND (CAST(:p AS uuid) IS NULL OR c.project_id = CAST(:p AS uuid)) ORDER BY c.updated_at DESC LIMIT 100"),
        {"u": uid, "p": project_id if project_id and is_uuid(project_id) else None})).mappings().all()
    return {"conversations": [dict(r, id=str(r["id"]), project_id=str(r["project_id"]) if r["project_id"] else None) for r in rows]}

@router.get("/conversations/{cid}")
async def conversation(cid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """One conversation with its messages; each answer carries the notes it used."""
    row = (await s.execute(text("SELECT id, title, project_id FROM conversations WHERE id = :c AND user_id = :u"),
                           {"c": cid, "u": uid})).mappings().first() if is_uuid(cid) else None
    if not row:
        raise HTTPException(404)
    messages = []
    for m in (await s.execute(text("SELECT role, content, note_ids, created_at FROM messages WHERE conversation_id = :c ORDER BY created_at"),
                              {"c": cid})).mappings().all():
        messages.append({"role": m["role"], "content": m["content"], "created_at": m["created_at"],
                         "notes": await notes_by_id(s, uid, [str(i) for i in m["note_ids"]])})
    return {"id": str(row["id"]), "title": row["title"], "project_id": str(row["project_id"]) if row["project_id"] else None,
            "messages": messages}

@router.delete("/conversations/{cid}")
async def delete_conversation(cid: str, uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a conversation (the notes it cited stay)."""
    if is_uuid(cid):
        await s.execute(text("DELETE FROM conversations WHERE id = :c AND user_id = :u"), {"c": cid, "u": uid})
        await s.commit()
    return {"ok": True}
