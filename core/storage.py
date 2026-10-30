# storage: voice clips in a private S3 bucket (keys in the DB, short-lived links only), or on local disk.
"""S3 helpers for voice recordings — the only module that talks to AWS.

No S3 configured → clips are kept on local disk under AUDIO_DIR instead, same key layout;
s3_url / presigned_url then hold the file:// path (local files don't expire).

Layout: one private bucket (Block Public Access on), keys
recordings/<user-id>/<yyyy>/<mm>/<recording-id>.<ext>, encrypted at rest (SSE-S3).
The browser never talks to S3: audio goes browser → API → S3.

DB keeps per clip (table `recordings`): s3_key, s3_url (permanent address, not
openable — bucket is private), presigned_url (playable, 7 days) + its expiry, signed
at upload. The app doesn't play clips yet; a player should re-sign expired links.

Sync boto3 on purpose: routes call these through run_in_threadpool so the
upload runs alongside transcription without blocking the event loop.
"""
import datetime
from functools import lru_cache
from pathlib import Path
from typing import List, Tuple
import boto3
from botocore.config import Config
from core.config import settings

PRESIGN_TTL = 604800  # 7 days — the SigV4 maximum for IAM-user keys

# Browser recorder formats we accept → file extension Whisper/ffmpeg understands.
AUDIO_EXT = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
             "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav"}

LOCAL_EXPIRY = datetime.timedelta(days=3650)  # file:// links never really expire; keeps the column filled

# Used by: every helper below — S3 when fully configured, else local disk.
def s3() -> bool:
    return bool(settings.s3_bucket and settings.aws_access_key_id and settings.aws_secret_access_key)

# Used by: local-disk branches below. Relative AUDIO_DIR resolves against apps/api.
def local_root() -> Path:
    return (Path(__file__).resolve().parents[1] / settings.audio_dir).resolve()

def _local(key: str) -> Path:
    return local_root() / key

# Used by: routes/voice.py, routes/notes.py (rm, one), main.py startup log, scripts/*.
def enabled() -> bool:
    # Audio is kept when S3 is configured, or else on local disk; AUDIO_DIR="" with no S3 → not kept.
    return s3() or bool(settings.audio_dir)

# Used by: main.py lifespan — startup warning.
def half_configured() -> bool:
    # Some S3 vars set but not all — worth a startup warning (treated as disabled).
    vals = (settings.s3_bucket, settings.aws_access_key_id, settings.aws_secret_access_key)
    return any(vals) and not all(vals)

# Used by: every helper below.
@lru_cache(maxsize=1)
def _client():
    # One cached client; bounded timeouts so a slow S3 fails in ~30s instead of hanging a request.
    return boto3.client(
        "s3", region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        # Regional host: the global one 307-redirects for ap-south-1 and breaks presigned links.
        endpoint_url=settings.s3_endpoint_url or f"https://s3.{settings.aws_region}.amazonaws.com",
        config=Config(connect_timeout=5, read_timeout=20, retries={"max_attempts": 3, "mode": "standard"},
                      signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )

# Used by: routes/voice.py transcribe_audio — names the object before upload.
def audio_key(uid: str, rid: str, ext: str) -> str:
    # recordings/<user>/<yyyy>/<mm>/<recording-id>.<ext> — per-user prefix, sortable by month.
    d = datetime.datetime.utcnow()
    return f"{settings.s3_prefix.strip('/')}/{uid}/{d:%Y/%m}/{rid}{ext}"

# Used by: routes/voice.py transcribe_audio (store chain).
def put_audio(key: str, data: bytes, mime: str) -> None:
    if not s3():
        _local(key).parent.mkdir(parents=True, exist_ok=True)
        _local(key).write_bytes(data)
        return
    # Single PUT (clips are ≤ AUDIO_MAX_MB, far below multipart territory), encrypted at rest.
    _client().put_object(Bucket=settings.s3_bucket, Key=key, Body=data,
                         ContentType=mime, ServerSideEncryption="AES256")

# Used by: routes/voice.py retry — the only normal path that reads audio back.
def get_audio(key: str) -> bytes:
    # Whole clip into memory (bounded by AUDIO_MAX_MB) → temp file → Whisper.
    if not s3():
        return _local(key).read_bytes()
    return _client().get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()

# Used by: routes/notes.py rm, routes/voice.py (object without a row), scripts/prune_recordings.py.
def delete(keys: List[str]) -> None:
    if not s3():
        for k in keys:
            _local(k).unlink(missing_ok=True)
        return
    for i in range(0, len(keys), 1000):  # S3 caps a batch delete at 1000 keys
        _client().delete_objects(Bucket=settings.s3_bucket,
                                 Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]], "Quiet": True})

# Used by: routes/voice.py transcribe_audio (row insert).
def object_url(key: str) -> str:
    # Permanent address of the object (bucket is private: opening it directly → AccessDenied, by design).
    if not s3():
        return _local(key).as_uri()
    if settings.s3_endpoint_url:
        return f"{settings.s3_endpoint_url.rstrip('/')}/{settings.s3_bucket}/{key}"
    return f"https://{settings.s3_bucket}.s3.{settings.aws_region}.amazonaws.com/{key}"

# Used by: routes/voice.py (row insert).
def presign_get(key: str, ttl: int = PRESIGN_TTL) -> Tuple[str, datetime.datetime]:
    # (url, expires_at) — a playable link that stops working at expires_at (UTC).
    if not s3():
        return _local(key).as_uri(), datetime.datetime.now(datetime.timezone.utc) + LOCAL_EXPIRY
    url = _client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.s3_bucket, "Key": key}, ExpiresIn=ttl)
    return url, datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=ttl)
