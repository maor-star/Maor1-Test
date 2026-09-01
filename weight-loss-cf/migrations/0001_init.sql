-- סכמת "הדרך הקלה לרדת במשקל" עבור Cloudflare D1 (SQLite).

CREATE TABLE IF NOT EXISTS profiles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL DEFAULT 'client' CHECK (role IN ('admin','client')),
  full_name            TEXT    NOT NULL DEFAULT '',
  daily_calories_goal  INTEGER NOT NULL DEFAULT 1800,
  daily_protein_goal   INTEGER NOT NULL DEFAULT 130,
  weekly_workouts_goal INTEGER NOT NULL DEFAULT 3,
  total_points         INTEGER NOT NULL DEFAULT 0,
  current_streak       INTEGER NOT NULL DEFAULT 0,
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_logs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date                  TEXT    NOT NULL,
  calories_consumed     INTEGER NOT NULL DEFAULT 0,
  protein_consumed      INTEGER NOT NULL DEFAULT 0,
  strength_workout_done INTEGER NOT NULL DEFAULT 0,
  points_awarded        INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS weekly_weigh_ins (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date           TEXT    NOT NULL,
  week           TEXT    NOT NULL,
  weight         REAL    NOT NULL,
  photo_url      TEXT,
  admin_feedback TEXT,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, week)
);

CREATE TABLE IF NOT EXISTS badges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  icon_name     TEXT    NOT NULL DEFAULT 'award',
  points_reward INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_badges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id  INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  content      TEXT    NOT NULL DEFAULT '',
  author_id    INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  published_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_user_date  ON daily_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_weigh_user_date ON weekly_weigh_ins(user_id, date);
CREATE INDEX IF NOT EXISTS idx_userbadge_user  ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_date      ON posts(published_at DESC);

INSERT OR IGNORE INTO badges (key, name, description, icon_name, points_reward) VALUES
  ('iron_champion',    'אלוף הברזל',    'השלמת את כל אימוני הכוח שתוכננו לשבוע', 'dumbbell',  150),
  ('protein_master',   'מאסטר חלבון',   'עמדת ביעד החלבון 7 ימים ברציפות',       'drumstick', 200),
  ('iron_consistency', 'התמדה של ברזל', 'רצף דיווח יומי של 14 יום',              'flame',     300);
