-- 020: a note laid out for reading (bullets for lists, short paragraphs), written by the extraction call from the
-- note's own words. raw_text stays exactly what was typed or said; '' = shown as written.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS formatted TEXT NOT NULL DEFAULT '';
