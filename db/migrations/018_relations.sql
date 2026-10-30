-- 018: facts between entities, from the notes — the user's knowledge graph. "Saroj — is MC of — Ward 18",
-- "Gurdev Singh — is sarpanch of — Kheri Kalan". The object is another entity when it is one, else plain text
-- ("since 2019"). Each fact keeps the note it came from; the same fact from another note isn't stored twice.
CREATE TABLE IF NOT EXISTS relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id  UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation    TEXT NOT NULL,                    -- "is MC of", "lives in", "reports to"
  object_id   UUID REFERENCES entities(id) ON DELETE CASCADE,
  object_text TEXT NOT NULL DEFAULT '',         -- when the object isn't an entity
  note_id     UUID REFERENCES notes(id) ON DELETE SET NULL,
  origin      TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto', 'you')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  fact_key    TEXT NOT NULL,                    -- subject + relation + object, spelling-insensitive: one row per fact
  UNIQUE (user_id, fact_key)
);
CREATE INDEX IF NOT EXISTS relations_subject_idx ON relations (subject_id);
CREATE INDEX IF NOT EXISTS relations_object_idx ON relations (object_id);
CREATE INDEX IF NOT EXISTS relations_note_idx ON relations (note_id);
