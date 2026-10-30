-- 015: notes you've dealt with or want on top (Notes page card actions).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS pinned  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS notes_user_pinned_idx ON notes (user_id) WHERE pinned;
