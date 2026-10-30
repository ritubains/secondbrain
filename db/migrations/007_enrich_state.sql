-- 007: fast save. POST /notes stores the note and replies; title/summary/tags/vector are
-- filled by a background task. enrich_state tells the UI when that has landed.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS enrich_state TEXT NOT NULL DEFAULT 'done';  -- pending | done
