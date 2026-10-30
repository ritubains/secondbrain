-- 026: notes are filed by the AI (pipeline/clusters.py). Each note's matter, in the AI's words, is kept so it's asked
-- once; whether two matters are the same — the AI's yes/no — is kept per pair so a regroup only asks about new pairs.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS matter TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS matter_pairs (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  a       TEXT NOT NULL,   -- the two matters, a < b
  b       TEXT NOT NULL,
  same    BOOLEAN NOT NULL,
  name    TEXT NOT NULL DEFAULT '',   -- one name for both, when the same
  PRIMARY KEY (user_id, a, b)
);
