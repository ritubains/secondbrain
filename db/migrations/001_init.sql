-- 001_init: three tables walk into a bar...
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  raw_text TEXT NOT NULL,
  title TEXT DEFAULT '',
  type TEXT DEFAULT 'note',
  summary TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  people TEXT[] DEFAULT '{}',
  action_items TEXT[] DEFAULT '{}',
  source TEXT DEFAULT 'typed',
  search_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(raw_text,'') || ' ' || coalesce(title,'') || ' ' || coalesce(summary,''))) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_user_idx ON notes(user_id);
CREATE INDEX IF NOT EXISTS notes_tsv_idx ON notes USING GIN(search_tsv);

CREATE TABLE IF NOT EXISTS note_embeddings (
  note_id UUID PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'text-embedding-3-small'
);
CREATE INDEX IF NOT EXISTS emb_hnsw_idx ON note_embeddings USING hnsw (embedding vector_cosine_ops);
