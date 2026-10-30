-- 014: dated things a note mentions (appointments, meetings, birthdays, deadlines) for "Coming up" in For you.
-- Stored as note_items kind 'event'; due_at = the day (and time, if one was said) worked out by core/when.py.
ALTER TABLE note_items DROP CONSTRAINT IF EXISTS note_items_kind_check;
ALTER TABLE note_items ADD CONSTRAINT note_items_kind_check CHECK (kind IN ('promise', 'issue', 'event'));
ALTER TABLE note_items ADD COLUMN IF NOT EXISTS due_at       TIMESTAMPTZ;
ALTER TABLE note_items ADD COLUMN IF NOT EXISTS due_has_time BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS note_items_due_idx ON note_items (user_id, due_at) WHERE kind = 'event';
