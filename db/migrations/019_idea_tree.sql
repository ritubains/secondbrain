-- 019: ideas form a tree. Each note has one main idea (a broad subject many notes share, "Drugs") and up to two
-- sub-ideas inside it ("Drug reduction drive"). A sub-idea's parent is its main idea; main ideas have none.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES topics(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS topics_parent_idx ON topics (parent_id);
