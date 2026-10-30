-- 025: a category and a topic may share a name (a category holding one topic is often named like it), so names are
-- unique per level, not per user. Rows that ended up as their own parent through that clash are freed.
ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_user_id_key_key;
ALTER TABLE topics ADD CONSTRAINT topics_user_level_key UNIQUE (user_id, level, key);
UPDATE topics SET parent_id = NULL WHERE parent_id = id;
