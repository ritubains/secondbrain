-- 024: ideas are learned in three levels — category › topic › sub-topic — by clustering the notes and then their
-- topics (pipeline/clusters.py). Nothing about them is fixed: a note's bucket becomes its learned category's name.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'topic' CHECK (level IN ('category', 'topic', 'sub'));
UPDATE topics SET level = 'sub' WHERE parent_id IS NOT NULL;
ALTER TABLE topics DROP COLUMN IF EXISTS umbrella;
ALTER TABLE notes DROP COLUMN IF EXISTS form_first;
