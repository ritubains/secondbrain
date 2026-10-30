"""Apply db/migrations/*.sql in order to the configured database (AP_DB_* or DATABASE_URL).

Each file runs once, in its own transaction, and is recorded in schema_migrations,
so re-running only applies new files. The migrations are idempotent, so a database
set up by hand before this script existed is safely brought under tracking.

Run: `python3 scripts/migrate.py`
"""
import sys
from pathlib import Path
# Let `python scripts/x.py` import routes/core/db as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
from db.session import engine

MIGRATIONS = Path(__file__).resolve().parents[1] / "db" / "migrations"

async def main() -> None:
    async with engine.connect() as c:
        # asyncpg's own execute() runs multi-statement SQL files; SQLAlchemy's text() can't.
        pg = (await c.get_raw_connection()).driver_connection
        await pg.execute("CREATE TABLE IF NOT EXISTS schema_migrations ("
                         "name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        done = {r["name"] for r in await pg.fetch("SELECT name FROM schema_migrations")}
        todo = [f for f in sorted(MIGRATIONS.glob("*.sql")) if f.name not in done]
        for f in todo:
            async with pg.transaction():
                await pg.execute(f.read_text())
                await pg.execute("INSERT INTO schema_migrations (name) VALUES ($1)", f.name)
            print(f"applied {f.name}")
    await engine.dispose()
    print(f"{len(todo)} migration(s) applied, {len(done)} already up to date")

if __name__ == "__main__":
    asyncio.run(main())
