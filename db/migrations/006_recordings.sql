-- 006: voice clips kept in S3 (core/storage.py, routes/voice.py); one note can carry several (record → append → record).
-- Row is written before the upload so a crash mid-request leaves something the prune job can find.
-- status: uploading → transcribed | failed → attached (retry moves failed → transcribed).

CREATE TABLE IF NOT EXISTS recordings (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id     UUID REFERENCES notes(id) ON DELETE CASCADE,  -- NULL until the note is saved
  s3_key      TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'audio/webm',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'uploading',
  transcript  TEXT NOT NULL DEFAULT '',
  engine      TEXT NOT NULL DEFAULT '',  -- local | api
  error       TEXT NOT NULL DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recordings_note_idx ON recordings(note_id);
CREATE INDEX IF NOT EXISTS recordings_unattached_idx ON recordings(recorded_at) WHERE note_id IS NULL;
