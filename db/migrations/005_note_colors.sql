-- 005: Keep-style note colors. notes.color is '' (use the type default), a
-- preset key ('sage'), or a '#rrggbb' hex; users.palette holds custom swatches.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS palette TEXT[] DEFAULT '{}';
