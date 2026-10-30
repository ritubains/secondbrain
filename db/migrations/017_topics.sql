-- 017: topics, and connected notes stored once per pair.
-- A topic is a subject the user's notes keep coming back to ("Election strategy"); a note can have several.
-- The pipeline names a note's topics and reuses an existing one when the note belongs to it.

CREATE TABLE IF NOT EXISTS topics (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  key        TEXT NOT NULL,                     -- spelling-insensitive name
  origin     TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto', 'you')),  -- 'you': named or renamed by the user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS note_topics (
  note_id  UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  by_you   BOOLEAN NOT NULL DEFAULT false,         -- put there by the user: kept when the note is read again
  PRIMARY KEY (note_id, topic_id)
);
CREATE INDEX IF NOT EXISTS note_topics_topic_idx ON note_topics (topic_id);

-- Connected notes: one row per pair (note_id < other_id) instead of one per direction — half the rows.
DELETE FROM note_links WHERE note_id > other_id;
ALTER TABLE note_links DROP COLUMN IF EXISTS keyword;
CREATE INDEX IF NOT EXISTS note_links_other_idx ON note_links (other_id);
