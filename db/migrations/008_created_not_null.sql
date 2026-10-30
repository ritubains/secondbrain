-- 008: cursor paging. GET /notes pages by (created_at, id) row comparison, which drops
-- rows whose created_at is NULL — backfill them and make the column required.
UPDATE notes SET created_at = COALESCE(updated_at, now()) WHERE created_at IS NULL;
ALTER TABLE notes ALTER COLUMN created_at SET NOT NULL;
