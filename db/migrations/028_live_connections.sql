-- Connections between notes are worked out when they're read (pipeline/links.py), so every note is always compared
-- with every other note as they are now; nothing is stored that could go stale.
DROP TABLE IF EXISTS note_links;

-- Each user's own scale for "how close" (pipeline/links.py): for meaning and for shared names, what a typical pair of
-- their notes has (0 on the scale) and what a note typically has with its closest other note (1). Refreshed in the
-- background as notes change.
CREATE TABLE IF NOT EXISTS note_scales (
  user_id UUID PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  meaning_typical REAL NOT NULL,
  meaning_close REAL NOT NULL,
  names_typical REAL NOT NULL,
  names_close REAL NOT NULL,
  notes INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The AI's names for what notes are about, as vectors, so filing (pipeline/clusters.py) only embeds names it hasn't
-- seen before. Kept per embedding model, since vectors from different models can't be compared.
CREATE TABLE IF NOT EXISTS matter_vectors (
  user_id UUID REFERENCES users ON DELETE CASCADE,
  name TEXT,
  model TEXT,
  embedding vector NOT NULL,
  PRIMARY KEY (user_id, name, model)
);
