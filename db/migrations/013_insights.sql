-- 013: "For you" feed (routes/insights.py) — cards the user waved away. A card's key encodes what it
-- said (e.g. a pattern's size), so a dismissed pattern comes back when it grows.
CREATE TABLE IF NOT EXISTS insight_dismissals (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
