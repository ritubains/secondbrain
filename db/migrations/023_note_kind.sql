-- 023: what kind of note each one is, in the AI's words ("to-do list", "meeting notes", "journal entry"), and whether
-- it's first of all a list of separate items (form_first) rather than about one matter. Notes whose kind
-- comes first are grouped by kind, under ideas named from them (pipeline/clusters.py) — nothing about kinds is fixed.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS form TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS form_first BOOLEAN NOT NULL DEFAULT false;
UPDATE topics SET umbrella = 'kind' WHERE umbrella <> '';
