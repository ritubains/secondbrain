-- 016: one pipeline for every note. What a note mentions moves from per-note arrays into real tables
-- (entities = the user's vocabulary), notes link to each other with a score and a reason, projects hold
-- notes and conversations, and chats are saved. Ingest (pipeline/ingest.py) fills all of it.

-- Projects: a named context (like a Claude project) with instructions the chat always reads.
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id, updated_at DESC);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notes_user_project_idx ON notes (user_id, project_id, created_at DESC);

-- Entities: every person, place, official, group or term the user's notes mention — their vocabulary.
CREATE TABLE IF NOT EXISTS entities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('person', 'place', 'official', 'group', 'term')),
  name       TEXT NOT NULL,
  key        TEXT NOT NULL,                       -- spelling-insensitive name: "Dhab Wala" = "dhabwala"
  meaning    TEXT NOT NULL DEFAULT '',            -- "XEN = Executive Engineer"; '' for plain names
  origin     TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto', 'you')),  -- 'you': added or edited by the user
  mentions   INT  NOT NULL DEFAULT 0,             -- notes that mention it
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);
CREATE INDEX IF NOT EXISTS entities_user_kind_idx ON entities (user_id, kind, last_seen DESC);

-- Other ways an entity is written or heard ("Dhabwala", "Mster Harbhjan").
CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  key       TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS entity_aliases_entity_idx ON entity_aliases (entity_id);

-- Which note mentions which entity, and how the note wrote it. main = the place the note is about.
CREATE TABLE IF NOT EXISTS note_entities (
  note_id   UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  seen_as   TEXT NOT NULL DEFAULT '',
  main      BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (note_id, entity_id)
);
CREATE INDEX IF NOT EXISTS note_entities_entity_idx ON note_entities (entity_id);

-- Connected notes, stored both ways, with why: score = weighted meaning + shared entities + shared tags.
CREATE TABLE IF NOT EXISTS note_links (
  note_id  UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  other_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score    REAL NOT NULL,
  semantic REAL NOT NULL DEFAULT 0,
  entity   REAL NOT NULL DEFAULT 0,
  keyword  REAL NOT NULL DEFAULT 0,
  shared   TEXT[] NOT NULL DEFAULT '{}',           -- names of the shared entities, for "via Kheri Kalan, XEN"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, other_id)
);
CREATE INDEX IF NOT EXISTS note_links_user_idx ON note_links (user_id, created_at DESC);

-- Saved chats, optionally inside a project; each answer keeps the notes it used.
CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  note_ids        UUID[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);

-- Action items become items like promises, issues and events.
ALTER TABLE note_items DROP CONSTRAINT IF EXISTS note_items_kind_check;
ALTER TABLE note_items ADD CONSTRAINT note_items_kind_check CHECK (kind IN ('promise', 'issue', 'event', 'task'));

-- Per-note entity arrays and the old extraction fields are replaced by the tables above.
ALTER TABLE notes DROP COLUMN IF EXISTS search_tsv;
DROP INDEX IF EXISTS notes_people_gin_idx;
DROP INDEX IF EXISTS notes_user_place_idx;
ALTER TABLE notes DROP COLUMN IF EXISTS people, DROP COLUMN IF EXISTS place, DROP COLUMN IF EXISTS other_places,
  DROP COLUMN IF EXISTS officials, DROP COLUMN IF EXISTS groups, DROP COLUMN IF EXISTS action_items,
  DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS keywords;
ALTER TABLE notes ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (
  to_tsvector('english', coalesce(raw_text, '') || ' ' || coalesce(title, '') || ' ' || coalesce(summary, ''))) STORED;
CREATE INDEX IF NOT EXISTS notes_tsv_idx ON notes USING GIN (search_tsv);

-- The vocabulary used to live inside mem0; it now lives in entities. mem0 keeps only profile + project memory.
DO $$ BEGIN
  IF to_regclass('public.mem0_local') IS NOT NULL THEN
    DELETE FROM mem0_local WHERE payload->>'agent_id' = 'vocab';
  END IF;
  IF to_regclass('public.mem0_api') IS NOT NULL THEN
    DELETE FROM mem0_api WHERE payload->>'agent_id' = 'vocab';
  END IF;
END $$;

-- The old Home cards could be dismissed; the new Home is built from items, which are ticked off or hidden instead.
DROP TABLE IF EXISTS insight_dismissals;
