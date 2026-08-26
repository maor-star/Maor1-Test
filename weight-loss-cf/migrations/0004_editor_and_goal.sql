-- Content authoring, the collective target, and the editable rules of thumb.
ALTER TABLE profiles ADD COLUMN is_editor INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tips (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('group_goal_kg', '200');

INSERT INTO tips (text, position) VALUES
  ('תמיד עדיף לא לאכול 100 קלוריות מאשר להתאמן ולהוריד אותם', 0),
  ('אימון אחד לא משנה כלום. שלושה בשבוע, חצי שנה, משנים הכל', 1),
  ('המשקל בבוקר הוא רעש. הרצף הוא הנתון', 2);
