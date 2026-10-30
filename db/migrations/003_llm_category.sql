-- 003: LLM enrichment — sense-disambiguated category + synonym keywords.
-- keywords is comma-joined TEXT (not TEXT[]) so the generated tsvector stays
-- immutable; the API splits it back into a list.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS keywords TEXT DEFAULT '';

DROP INDEX IF EXISTS notes_tsv_idx;
ALTER TABLE notes DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE notes ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (
  to_tsvector('english', coalesce(raw_text,'') || ' ' || coalesce(title,'') || ' ' || coalesce(summary,'')
    || ' ' || coalesce(category,'') || ' ' || coalesce(keywords,''))
) STORED;
CREATE INDEX IF NOT EXISTS notes_tsv_idx ON notes USING GIN(search_tsv);
