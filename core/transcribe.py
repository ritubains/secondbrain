"""Speech → text. TRANSCRIBE_ENGINE local → Whisper on this machine · api → OpenAI Whisper.

On a Mac with Apple Silicon, local Whisper runs on the GPU through MLX (mlx-whisper): the same model, ~3× faster
than on the CPU (a 50 s clip: 1.8 s vs 6 s on an M3 Pro). Elsewhere it's openai-whisper on the CPU.

Spelling hints: WHISPER_PROMPT plus the user's own vocabulary (their names, places and terms), so
"Dhab Wala" and "Harbhajan" come out spelled their way.
"""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from openai import AsyncOpenAI
from core.config import settings
from core.llm import MODEL_LOAD, Unavailable

try:  # present with requirements-local.txt, absent on the slim (OpenAI-only) image
    import whisper
except ImportError:
    whisper = None
try:  # Apple Silicon only (requirements-mac.txt)
    import mlx.core as mx
    import mlx_whisper
    from mlx_whisper.transcribe import ModelHolder
except ImportError:
    mlx_whisper = None

# WHISPER_MODEL → the same model converted for MLX.
MLX_REPOS = {"tiny": "mlx-community/whisper-tiny-mlx", "base": "mlx-community/whisper-base-mlx", "small": "mlx-community/whisper-small-mlx",
             "medium": "mlx-community/whisper-medium-mlx", "turbo": "mlx-community/whisper-large-v3-turbo",
             "large": "mlx-community/whisper-large-v3-mlx"}

_model = None
_model_lock = threading.Lock()
# MLX ties GPU work to the thread that set it up, so loading and every transcription run on this one thread
# (which also means one clip at a time).
_mlx_thread = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-whisper")

def available() -> bool:
    """Whether this server can transcribe at all."""
    return settings.transcribe_engine == "local" or bool(settings.openai_api_key)

def _mlx_repo() -> str | None:
    """The MLX model to use, when this Mac can run it."""
    return MLX_REPOS.get(settings.whisper_model) if mlx_whisper is not None else None

def load_local():
    """The local Whisper model (WHISPER_MODEL), loaded once — the first load downloads it."""
    global _model
    if _mlx_repo():
        return _mlx_thread.submit(_mlx_load).result()
    if _model is None:
        if whisper is None:
            raise Unavailable("openai-whisper is not installed")
        with _model_lock, MODEL_LOAD:
            if _model is None:
                _model = whisper.load_model(settings.whisper_model)
    return _model

def _hint(words: str) -> str:
    """The prompt Whisper copies spellings from. Whisper mimics its style, so it ends like a sentence."""
    terms = ", ".join(t for t in (settings.whisper_prompt.strip().rstrip("."), words.strip()) if t)
    return terms + "." if terms else ""

def _mlx_load():
    """Load the MLX model (on the MLX thread)."""
    with MODEL_LOAD:
        return ModelHolder.get_model(_mlx_repo(), mx.float16)

def _mlx(path: str, hint: str) -> str:
    """Transcribe on the Apple GPU (on the MLX thread)."""
    _mlx_load()
    result = mlx_whisper.transcribe(path, path_or_hf_repo=_mlx_repo(), language=settings.whisper_language or None, initial_prompt=hint or None)
    return (result.get("text") or "").strip()

def _local(path: str, hint: str) -> str:
    """Transcribe on the CPU (fp16 off: required there)."""
    result = load_local().transcribe(path, fp16=False, language=settings.whisper_language or None, initial_prompt=hint or None)
    return (result.get("text") or "").strip()

async def transcribe(path: str, words: str = "") -> tuple:
    """An audio file → (text, engine name). words: the user's terms to spell their way."""
    hint = _hint(words)
    if settings.transcribe_engine == "local":
        if _mlx_repo():
            return await asyncio.get_running_loop().run_in_executor(_mlx_thread, _mlx, path, hint), "local"
        return await asyncio.to_thread(_local, path, hint), "local"
    if not settings.openai_api_key:
        raise Unavailable("OPENAI_API_KEY is not set")
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    with open(path, "rb") as f:
        r = await client.audio.transcriptions.create(model="whisper-1", file=f, **({"prompt": hint} if hint else {}))
    return r.text, "api"
