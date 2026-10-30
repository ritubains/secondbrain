-- Columns nothing uses any more: note colours and the user's colour palette (colours were removed), the old fixed
-- note type and per-user bucket list (the AI files notes now), and the manual bucket lock.
ALTER TABLE notes DROP COLUMN IF EXISTS color, DROP COLUMN IF EXISTS type, DROP COLUMN IF EXISTS bucket_locked;
ALTER TABLE users DROP COLUMN IF EXISTS palette, DROP COLUMN IF EXISTS buckets;
