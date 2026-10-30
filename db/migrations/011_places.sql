-- 011: places — cluster field notes by village/town (routes/places.py).
-- notes.place: the locality a note is about (AI-extracted, "" = none).
-- note_items: what the extraction pulled out of a note, one row each —
--   promise: something the writer committed to (who = promised to / occasion), done_at when kept;
--   issue:   a problem people raised there (who = raised by).
-- Rows are rewritten on re-enrich; done/dismissed state carries over by matching text.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS place TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS notes_user_place_idx ON notes (user_id, lower(place)) WHERE place <> '';

CREATE TABLE IF NOT EXISTS note_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id      UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('promise', 'issue')),
  text         TEXT NOT NULL,
  who          TEXT[] NOT NULL DEFAULT '{}',
  done_at      TIMESTAMPTZ,            -- promise kept
  dismissed_at TIMESTAMPTZ             -- wrongly extracted → hidden, and stays hidden on re-enrich
);
CREATE INDEX IF NOT EXISTS note_items_note_idx ON note_items (note_id);
CREATE INDEX IF NOT EXISTS note_items_user_kind_idx ON note_items (user_id, kind);
