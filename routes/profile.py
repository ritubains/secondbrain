"""What the app has learned about the user (core/memory.py) — to read, and to forget one fact or all of them.
Their vocabulary lives in routes/people.py (the Words page)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core import memory
from core.auth import current_user
from core.text import is_uuid
from db.session import get_session

router = APIRouter()

@router.get("/memory")
async def facts(uid: str = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Every fact memory keeps, with the note and project it came from."""
    items = await memory.everything(uid)
    names = dict((str(r[0]), r[1]) for r in (await s.execute(text("SELECT id, name FROM projects WHERE user_id = :u"), {"u": uid})).all())
    for f in items:
        f["project"] = names.get(f["project_id"] or "", "")
    return {"enabled": memory.enabled(), "items": items}

@router.delete("/memory/{mid}")
async def forget(mid: str, uid: str = Depends(current_user)):
    """Forget one fact."""
    if not is_uuid(mid) or not await memory.forget(uid, mid):
        raise HTTPException(404)
    return {"ok": True}

@router.delete("/memory")
async def forget_everything(uid: str = Depends(current_user)):
    """Forget every fact (notes stay)."""
    await memory.forget_all(uid)
    return {"ok": True}
