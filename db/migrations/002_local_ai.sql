-- 002: local (on-device) embeddings live apart from cloud vectors.
-- pgvector HNSW columns cannot mix dimensions (1536 cloud vs 384 MiniLM),
-- so each engine gets its own table + index. Same cascade semantics.

CREATE TABLE IF NOT EXISTS note_embeddings_local (
  note_id UUID PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  embedding vector(384) NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2'
);
CREATE INDEX IF NOT EXISTS emb_local_hnsw_idx ON note_embeddings_local USING hnsw (embedding vector_cosine_ops);
