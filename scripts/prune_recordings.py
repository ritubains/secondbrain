"""Sweep voice clips never attached to a note (cancelled drafts, crashed uploads).

DB-driven: only rows with note_id IS NULL older than N hours are
touched, so audio behind a saved note can never be deleted. S3 object first,
then the row; deleting a key that never made it to S3 is a no-op.

Run: `python3 scripts/prune_recordings.py [hours=24]` (manually or from cron).
"""
import sys
from pathlib import Path
# Let `python scripts/x.py` import routes/core/db as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
from sqlalchemy import text
from db.session import engine
from core import storage

async def main(hours: int) -> None:
    async with engine.begin() as c:
        rows = (await c.execute(text(
            "SELECT id, s3_key FROM recordings WHERE note_id IS NULL "
            "AND recorded_at < now() - make_interval(hours => :h)"), {"h": hours})).all()
        if rows and storage.enabled():
            storage.delete([r.s3_key for r in rows])
        if rows:
            await c.execute(text("DELETE FROM recordings WHERE id = ANY(:ids)"), {"ids": [r.id for r in rows]})
    print(f"pruned {len(rows)} unattached recording(s) older than {hours}h")

if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 24))
