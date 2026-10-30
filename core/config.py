"""Settings from the environment / apps/api/.env (see README "Settings")."""
import os
from pathlib import Path
from urllib.parse import quote
from pydantic import model_validator
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Postgres connection parts (env AP_DB_*). A full DATABASE_URL, if set, wins (e.g. Neon).
    ap_db_host: str = "localhost"
    ap_db_port: int = 5432
    ap_db_name: str = "second_brain"
    ap_db_user: str = "postgres"
    ap_db_password: str = ""
    database_url: str = ""
    db_ssl: str = "auto"  # "auto" (TLS except localhost) | "true" | "false" (e.g. a Postgres container on a private network)
    openai_api_key: str = ""
    wispr_api_key: str = ""
    wispr_ws_url: str = "wss://platform-api.wisprflow.ai/api/v1/dash/ws"
    log_level: str = "info"
    env: str = "dev"  # "prod" → strong JWT_SECRET required, Secure cookies, no /docs
    jwt_secret: str = "change-me"  # prod refuses to boot with this default (core/auth.py check_secret)
    session_days: int = 30  # login lifetime: JWT exp + cookie max-age
    cors_origins: str = "http://localhost:3000"  # comma-separated web origins allowed to call the API
    embedding_model: str = "text-embedding-3-small"
    extraction_model: str = "gpt-4o-mini"
    transcribe_engine: str = "api"  # or "local" (on-device Whisper, no key)
    whisper_model: str = "turbo"  # local Whisper size: tiny | base | small | medium | turbo (large-v3-turbo, best)
    whisper_language: str = "en"  # spoken language code (en, hi, pa…); "" = auto-detect per clip
    whisper_prompt: str = ""  # comma-separated names/terms you say often — fixes their spelling
    embed_engine: str = "api"  # or "local" (on-device MiniLM 384-dim, no key)
    llm_engine: str = "api"  # "api" (OpenAI key) | "local" (Ollama, no key) | "off" (rule fallback)
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen3-fast"  # Qwen3 8B without thinking (scripts/qwen3-fast.Modelfile)
    llm_context: int = 128_000  # an API model's context window in tokens (a local model's is read from Ollama)
    # Long-term memory (core/memory.py): facts mem0 learns about the user and each project, stored in this Postgres.
    memory_engine: str = "off"  # "mem0" | "off"
    memory_llm_model: str = ""  # blank = LLM_MODEL (local) / EXTRACTION_MODEL (api)
    memory_dir: str = "data/mem0"  # mem0's small SQLite change log (relative to apps/api)
    memory_learn_from_chat: bool = False  # also learn from chat questions (~12s of local-model time each)
    # S3 voice recordings (core/storage.py). Optional: no bucket/keys → audio isn't kept, voice works as before.
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    s3_bucket: str = ""
    s3_prefix: str = "recordings"
    s3_endpoint_url: str = ""  # blank = AWS; set for R2/MinIO
    audio_max_mb: int = 25
    audio_dir: str = "data"  # no S3 → voice clips kept under <audio_dir>/<S3_PREFIX>/… (relative to apps/api); "" = not kept
    app_user_email: str = ""
    app_user_password: str = ""

    class Config:
        env_file = ".env"

    @model_validator(mode="after")
    def _build_database_url(self):
        # Quote user/password: characters like "@" would otherwise break the URL.
        if not self.database_url:
            self.database_url = (
                f"postgresql+asyncpg://{quote(self.ap_db_user, safe='')}:{quote(self.ap_db_password, safe='')}"
                f"@{self.ap_db_host}:{self.ap_db_port}/{self.ap_db_name}")
        return self

settings = Settings()

# mem0 reads these when it's imported (core/memory.py), so they're set here, first: no telemetry or remote
# notices, and its small local log under MEMORY_DIR.
MEMORY_DIR = Path(settings.memory_dir) if Path(settings.memory_dir).is_absolute() else Path(__file__).resolve().parents[1] / settings.memory_dir
os.environ.setdefault("MEM0_TELEMETRY", "False")
os.environ.setdefault("MEM0_DIR", str(MEMORY_DIR))

def is_prod() -> bool:
    """Production mode: Secure cookies, no API docs, a strong JWT_SECRET required."""
    return settings.env.strip().lower() == "prod"
