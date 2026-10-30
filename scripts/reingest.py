"""Run the note pipeline (pipeline/ingest.py) again over existing notes — after the pipeline changes, or to
move notes saved before it onto its tables. Oldest first, so later notes recognise what earlier ones taught; then
each user's notes are clustered into ideas once.

Run: python3 scripts/reingest.py [email]      (default: every user)
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # import core/, db/, pipeline/ as top-level packages
import asyncio
import time
from sqlalchemy import text
from db.session import Session, engine
from pipeline import clusters
from pipeline.ingest import ingest

async def main(email: str = "") -> None:
    """Re-ingest every note of one user (or all users), one at a time, printing what each became."""
    async with Session() as s:
        rows = (await s.execute(text(
            "SELECT n.id, n.user_id, n.raw_text FROM notes n JOIN users u ON u.id = n.user_id "
            "WHERE (:e = '' OR u.email = :e) ORDER BY n.created_at"), {"e": email.strip().lower()})).mappings().all()
    started = time.time()
    for i, r in enumerate(rows, 1):
        t = time.time()
        await ingest(str(r["user_id"]), str(r["id"]), cluster=False)
        async with Session() as s:
            got = (await s.execute(text(
                "SELECT n.title, ARRAY(SELECT e.name FROM note_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.note_id = n.id) AS names "
                "FROM notes n WHERE n.id = :n"), {"n": r["id"]})).mappings().first()
        print(f"{i}/{len(rows)} {time.time() - t:4.1f}s  {got['title'][:40]!r:44} {', '.join(got['names'])[:70]}", flush=True)
    for uid in dict.fromkeys(str(r["user_id"]) for r in rows):  # all the notes filed together, once
        print("filed:", await clusters.recluster(uid), flush=True)
    await engine.dispose()
    print(f"done: {len(rows)} notes in {time.time() - started:.0f}s")

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
