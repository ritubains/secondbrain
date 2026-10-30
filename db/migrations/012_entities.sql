-- 012: who/what a note mentions beyond people + its main place (routes/hubs.py builds the map from these).
-- other_places: further villages/colonies/landmarks; officials: posts + departments (SSP, BDPO, Police);
-- groups: parties, associations, media, crowds; note_items.topic: an issue's 1-2 word subject (Drainage, Water).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS other_places TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS officials    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS groups       TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE note_items ADD COLUMN IF NOT EXISTS topic   TEXT   NOT NULL DEFAULT '';
