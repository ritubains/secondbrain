# session: one engine to rule all queries.
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from core.config import settings

# ponytail: Neon needs TLS; keep it out of DATABASE_URL (asyncpg rejects
# query-string ssl params) and pass it here instead. Local Postgres has no TLS (DB_SSL overrides).
_url = settings.database_url.split("?")[0]
_mode = settings.db_ssl.strip().lower()
_ssl = (_mode in ("true", "1", "yes", "require")) if _mode != "auto" else not any(h in _url for h in ("@localhost", "@127.0.0.1"))
# pool_pre_ping: drop connections the server (or Neon's idle suspend) closed, instead of failing a request.
engine = create_async_engine(_url, connect_args={"ssl": True} if _ssl else {}, pool_pre_ping=True)
Session = async_sessionmaker(engine, expire_on_commit=False)

async def get_session():
    # Yield one DB session per request; FastAPI closes it when the request ends.
    async with Session() as s:
        yield s
