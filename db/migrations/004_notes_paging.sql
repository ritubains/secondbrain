-- 004: server-side pagination. Page scans ride (user_id, created_at); the
-- per-page "related" lookup and the connections count use array overlap (&&).

CREATE INDEX IF NOT EXISTS notes_user_created_idx ON notes(user_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS notes_tags_gin_idx ON notes USING GIN(tags);
CREATE INDEX IF NOT EXISTS notes_people_gin_idx ON notes USING GIN(people);
