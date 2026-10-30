-- 021: issues as entities, and starred notes.
-- An issue is a subject a note is about, named as a short noun the way you'd say it ("Drugs", "Roads", "Pensions"):
-- shared by many notes, it ties them together the way a person or a place does (pipeline/clusters.py).
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_kind_check;
ALTER TABLE entities ADD CONSTRAINT entities_kind_check CHECK (kind IN ('person', 'place', 'official', 'group', 'issue', 'term'));
-- Starred: important, shown first and marked (pinned stays "keep on top").
ALTER TABLE notes ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
