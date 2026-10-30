"""The AI engines in one place: chat (plain text or JSON) and embeddings.

LLM_ENGINE   local → Ollama (OpenAI-compatible API) · api → OpenAI · off → Unavailable is raised
EMBED_ENGINE local → MiniLM on this machine (384 numbers) · api → OpenAI (1536 numbers)
Callers catch Unavailable and carry on without the AI step.

What fits in one prompt is measured, not assumed: window() is the context the model really runs with (Ollama loads
each model with its own, often far smaller than the model allows), and tokens() counts text in the model's own tokens,
using how many characters made a token in every prompt sent so far. reply_room() is the longest reply seen, kept free.
"""
import asyncio
import json
import math
import threading
import httpx
import openai
from openai import AsyncOpenAI
from core.config import settings

try:  # local models: present with requirements-local.txt, absent on the slim (OpenAI-only) image
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

class Unavailable(Exception):
    """The AI engine is off, unreachable, or answered with something unusable."""

# One on-device model load at a time, process-wide (MiniLM here, Whisper in core/transcribe.py, mem0's
# embedder): two loads at once fail inside transformers and break every later load.
MODEL_LOAD = threading.Lock()

_openai = None
_ollama = None
_minilm = None
_window = 0             # the model's context in tokens, asked once
_sent = [0, 0]          # characters and tokens of every prompt so far → characters per token
_longest_reply = 0      # tokens

def _client() -> tuple:
    """The chat client and model name for LLM_ENGINE."""
    global _openai, _ollama
    if settings.llm_engine == "local":
        if _ollama is None:
            # A busy local model queues requests, so it gets a long timeout.
            _ollama = AsyncOpenAI(base_url=settings.llm_base_url, api_key="ollama",
                                  timeout=httpx.Timeout(120.0, connect=2.0), max_retries=0)
        return _ollama, settings.llm_model
    if settings.llm_engine == "api" and settings.openai_api_key:
        if _openai is None:
            _openai = AsyncOpenAI(api_key=settings.openai_api_key)
        return _openai, settings.extraction_model
    raise Unavailable(f"LLM_ENGINE={settings.llm_engine}")

async def window() -> int:
    """The model's context window in tokens. Ollama: the context it's loaded with (a one-token request loads it
    first when it isn't); an API model: LLM_CONTEXT."""
    global _window
    if _window:
        return _window
    if settings.llm_engine != "local":
        _window = settings.llm_context
        return _window
    base = settings.llm_base_url.rsplit("/v1", 1)[0]
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            for _ in range(2):
                loaded = [m for m in (await c.get(f"{base}/api/ps")).json().get("models", [])
                          if m["name"].split(":")[0] == settings.llm_model.split(":")[0]]
                if loaded:
                    _window = int(loaded[0]["context_length"])
                    return _window
                await c.post(f"{base}/api/generate", json={"model": settings.llm_model, "prompt": "", "stream": False, "options": {"num_predict": 1}})
    except (httpx.HTTPError, KeyError, ValueError) as e:
        raise Unavailable(f"can't read the model's context: {e!r}")
    raise Unavailable("the model didn't load")

def tokens(text: str) -> int:
    """About how many of the model's tokens this text takes (characters per token as measured so far; before the
    first prompt, a character each, which never overfills)."""
    chars, toks = _sent
    return math.ceil(len(text) / (chars / toks if toks else 1))

def chars(n_tokens: int) -> int:
    """About how many characters fit in this many tokens (the inverse of tokens())."""
    sent_chars, sent_tokens = _sent
    return int(n_tokens * (sent_chars / sent_tokens if sent_tokens else 1))

async def reply_room() -> int:
    """Tokens to keep free for the answer: the longest reply so far (a quarter of the window before any)."""
    return _longest_reply or await window() // 4

def _measure(messages: list, r) -> None:
    """Learn from the model's own counts: characters per prompt token, and the longest reply."""
    global _longest_reply
    if r.usage:
        _sent[0] += sum(len(m["content"]) for m in messages)
        _sent[1] += r.usage.prompt_tokens
        _longest_reply = max(_longest_reply, r.usage.completion_tokens)

async def chat(messages: list, temperature: float = 0.2) -> str:
    """One chat completion → its text."""
    client, model = _client()
    try:
        r = await client.chat.completions.create(model=model, temperature=temperature, messages=messages)
    except (openai.APIConnectionError, openai.APITimeoutError, openai.NotFoundError) as e:
        raise Unavailable(str(e))
    _measure(messages, r)
    return (r.choices[0].message.content or "").strip()

async def chat_json(prompt: str) -> dict:
    """One completion that must answer with a JSON object; retried once on unreadable output."""
    client, model = _client()
    messages = [{"role": "user", "content": prompt}]
    for _ in range(2):
        try:
            r = await client.chat.completions.create(model=model, temperature=0, response_format={"type": "json_object"}, messages=messages)
        except (openai.APIConnectionError, openai.APITimeoutError, openai.NotFoundError) as e:
            raise Unavailable(str(e))
        _measure(messages, r)
        out = r.choices[0].message.content or ""
        try:
            return json.loads(out[out.index("{"):out.rindex("}") + 1], strict=False)  # a stray line break inside a value is fine
        except ValueError:
            continue
    raise Unavailable("the model returned no JSON")

def minilm():
    """The local MiniLM model, loaded once (about 80 MB, downloaded on first use)."""
    global _minilm
    if _minilm is None:
        if SentenceTransformer is None:
            raise Unavailable("sentence-transformers is not installed")
        with MODEL_LOAD:
            if _minilm is None:
                _minilm = SentenceTransformer("all-MiniLM-L6-v2")
    return _minilm

def embed_table() -> str:
    """The table holding note vectors for EMBED_ENGINE (the two engines' vectors differ in size)."""
    return "note_embeddings_local" if settings.embed_engine == "local" else "note_embeddings"

def embed_model() -> str:
    """The model name stored next to each vector."""
    return "all-MiniLM-L6-v2" if settings.embed_engine == "local" else settings.embedding_model

async def embed(text: str) -> list:
    """Text → vector with EMBED_ENGINE. Local runs in a thread so the server keeps answering meanwhile."""
    if settings.embed_engine == "local":
        model = await asyncio.to_thread(minilm)
        vec = await asyncio.to_thread(model.encode, text or "")
        return [float(x) for x in vec]
    if not settings.openai_api_key:
        raise Unavailable("OPENAI_API_KEY is not set")
    global _openai
    if _openai is None:
        _openai = AsyncOpenAI(api_key=settings.openai_api_key)
    r = await _openai.embeddings.create(model=settings.embedding_model, input=text or " ")
    return r.data[0].embedding

_common = None

def common_words() -> set:
    """Everyday English words (MiniLM's word list) — "villages" and "Sunday" are in it; sarpanch and XEN aren't.
    Empty when the local model isn't available."""
    global _common
    if _common is None:
        try:
            _common = set(minilm().tokenizer.get_vocab())
        except Exception:
            _common = set()
    return _common
