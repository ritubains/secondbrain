"""The chatbot: answers in plain language from the user's notes, and keeps the conversation.

Context for each answer: the project's instructions (when the chat is in a project), what memory knows about
the user, what the user's own terms mean, the notes chat/retrieve.py found, and the conversation so far.
Every question and answer is saved, so a conversation can be picked up again later.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import prompts
from core import memory
from core.llm import Unavailable, chars, chat, reply_room, tokens, window
from core.text import no_dashes
from chat import retrieve
from pipeline import entities, links, relations

async def reply(s: AsyncSession, uid: str, question: str, conversation_id: str | None = None, project_id: str | None = None) -> dict:
    """Answer a question in a conversation (a new one when no id is given). → {conversation, answer, notes}

    Everything goes into one prompt that must fit the model's context (core/llm.py measures it), with room kept for
    the reply. In order, while there's room: the instructions, the project, the question and the last exchange; what
    the user's own terms mean; known facts about what the question names; what memory knows; the notes; and the
    earlier conversation, newest first."""
    conv = await _conversation(s, uid, conversation_id, project_id, question)
    history = await _history(s, conv["id"])
    # A short follow-up ("and in Massewal?") is searched together with the question before it.
    last = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    search_for = question if len(question.split()) > 5 or not last else f"{last} {question}"
    in_question = await entities.recognize(s, uid, question)
    project = await _project(s, uid, conv["project_id"])
    head = [prompts.ANSWER] + ([f"Project: {project['name']}\n{project['description']}\n{project['instructions']}".strip()] if project else [])
    latest = history[-2:]
    try:
        room = await window() - await reply_room() - tokens("\n\n".join(head) + question + "".join(m["content"] for m in latest))
    except Unavailable:
        room = None  # no AI to answer: the notes alone are shown

    terms, room = _fit([f"- {e['name']} = {e['meaning']}" for e in in_question if e["meaning"]], room)
    known, room = _fit([f"- {relations.sentence(f)}" for f in await relations.about(s, [e["id"] for e in in_question])], room)
    recalled, room = _fit(await memory.recall(uid, question, conv["project_id"], floor=await links.meaning_floor(s, uid)), room)
    notes = await retrieve.find(s, uid, search_for, conv["project_id"], room=chars(room) if room is not None else None)
    lines, room = _fit([_note_line(i, n) for i, n in enumerate(notes, 1)], room)
    notes = notes[:len(lines)]
    facts = await _relevant_facts(s, uid, recalled, notes, in_question)
    earlier, room = _fit([m["content"] for m in reversed(history[:-2])], room)

    context = list(head)
    if facts:
        context.append("Background about the user (to understand them; facts for the answer come from the notes):\n"
                       + "\n".join(f"- {f}" for f in facts))
    if terms:
        context.append("Their words:\n" + "\n".join(terms))
    if known:
        context.append("Known facts from their notes:\n" + "\n".join(known))
    context.append("Notes:\n" + ("\n".join(lines) or "(none match)"))
    kept = history[len(history) - 2 - len(earlier):] if history else []
    messages = [{"role": "system", "content": "\n\n".join(context)},
                *({"role": m["role"], "content": m["content"]} for m in kept),
                {"role": "user", "content": question}]
    try:
        answer = no_dashes(await chat(messages))
    except Unavailable:
        answer = (f"I can't reach the AI right now. These {len(notes)} notes look related." if notes
                  else "I can't reach the AI right now, and no notes match.")

    await _save(s, conv["id"], "user", question, [])
    await _save(s, conv["id"], "assistant", answer, [n["id"] for n in notes])
    await s.execute(text("UPDATE conversations SET updated_at = now() WHERE id = :c"), {"c": conv["id"]})
    await s.commit()
    return {"conversation": conv, "answer": answer, "notes": notes}

def _fit(lines: list, room: int | None) -> tuple:
    """As many of `lines`, in order, as fit in `room` tokens → (those lines, room left). No room given: all of them."""
    if room is None:
        return lines, None
    kept = []
    for line in lines:
        need = tokens(line) + 1  # and the line break
        if need > room:
            break
        kept.append(line)
        room -= need
    return kept, room

async def _relevant_facts(s: AsyncSession, uid: str, facts: list, notes: list, in_question: list) -> list:
    """Memory facts that fit this answer: general ones (no names in them), and ones whose names all appear in the
    question or its notes — so a fact about another village can't leak into the answer."""
    in_context = {e["id"] for e in in_question} | {e["id"] for e in await entities.recognize(s, uid, " ".join(n["raw_text"] for n in notes))}
    kept = []
    for fact in facts:
        named = {e["id"] for e in await entities.recognize(s, uid, fact)}
        if named <= in_context:
            kept.append(fact)
    return kept

def _note_line(i: int, n: dict) -> str:
    """One note in the prompt: number, date written, place, title, text."""
    where = f" · {n['place']}" if n["place"] else ""
    return f"[{i}] ({n['created_at']:%d %b %Y}{where}) {n['title']}: {n['raw_text']}"

async def _conversation(s: AsyncSession, uid: str, cid: str | None, project_id: str | None, question: str) -> dict:
    """The user's conversation with this id, or a new one titled after its first question."""
    if cid:
        row = (await s.execute(text("SELECT id, project_id, title FROM conversations WHERE id = :c AND user_id = :u"),
                               {"c": cid, "u": uid})).mappings().first()
        if row:
            return _conv(row)
    row = (await s.execute(text(
        "INSERT INTO conversations (user_id, project_id, title) VALUES (:u, :p, :t) RETURNING id, project_id, title"),
        {"u": uid, "p": project_id, "t": " ".join(question.split())[:80]})).mappings().first()
    return _conv(row)

def _conv(row) -> dict:
    """A conversation row → dict with string ids."""
    return {"id": str(row["id"]), "project_id": str(row["project_id"]) if row["project_id"] else None, "title": row["title"]}

async def _history(s: AsyncSession, cid: str) -> list:
    """The conversation's messages so far, oldest first."""
    rows = (await s.execute(text("SELECT role, content FROM messages WHERE conversation_id = :c ORDER BY created_at"),
                            {"c": cid})).mappings().all()
    return [dict(r) for r in rows]

async def _project(s: AsyncSession, uid: str, project_id: str | None) -> dict | None:
    """The project's name, description and instructions."""
    if not project_id:
        return None
    row = (await s.execute(text("SELECT name, description, instructions FROM projects WHERE id = :p AND user_id = :u"),
                           {"p": project_id, "u": uid})).mappings().first()
    return dict(row) if row else None

async def _save(s: AsyncSession, cid: str, role: str, content: str, note_ids: list) -> None:
    """Store one message."""
    await s.execute(text("INSERT INTO messages (conversation_id, role, content, note_ids) VALUES (:c, :r, :t, CAST(:n AS uuid[]))"),
                    {"c": cid, "r": role, "t": content, "n": note_ids})
