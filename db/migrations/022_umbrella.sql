-- 022: umbrella ideas. A note whose main point is its form — a checklist / to-do list — goes under one umbrella idea
-- ("Checklists") whatever it's about, not with the subject it mentions (pipeline/clusters.py). The marker keeps the
-- umbrella an umbrella when the user renames it.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS umbrella TEXT NOT NULL DEFAULT '';
