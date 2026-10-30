-- 010: buckets — one stable, user-facing life area per note (Technology, Shopping, …).
-- notes.bucket is picked by AI from the user's list ('' = not enriched yet, shown as Other);
-- bucket_locked = the user picked it by hand, so re-enrichment leaves it alone.
-- users.buckets NULL = the default list (core/buckets.py DEFAULTS).

ALTER TABLE notes ADD COLUMN IF NOT EXISTS bucket TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS bucket_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS buckets TEXT[];
CREATE INDEX IF NOT EXISTS notes_user_bucket_idx ON notes (user_id, bucket);
