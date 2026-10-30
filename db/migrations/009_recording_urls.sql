-- 009: every recording carries its permanent S3 URL, a playable presigned URL (+ expiry)
-- and its upload time. Two phases so a running older API never breaks:
--   A (now)          : add columns nullable (pre-009 rows were backfilled once; that script is retired —
--                      a fresh database has no such rows).
--   B (after restart): the SET NOT NULL block below.
-- presigned_url is re-signed on read when it expires (<1h left) or the signing key changes.

-- phase A
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS s3_url               TEXT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS presigned_url        TEXT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS presigned_expires_at TIMESTAMPTZ;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS uploaded_at          TIMESTAMPTZ;

-- phase B (run only after the API restarted on the new code)
-- ALTER TABLE recordings ALTER COLUMN s3_url               SET NOT NULL;
-- ALTER TABLE recordings ALTER COLUMN presigned_url        SET NOT NULL;
-- ALTER TABLE recordings ALTER COLUMN presigned_expires_at SET NOT NULL;
-- ALTER TABLE recordings ALTER COLUMN uploaded_at          SET NOT NULL;
