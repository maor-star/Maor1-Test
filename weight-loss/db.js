import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, 'data', 'weightloss.db');

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(join(dirname(dbPath), 'uploads'), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
db.exec(`
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
`);

// ---- Seed the master list of badges ----
export const BADGE_SEED = [
  {
    key: 'iron_champion',
    name: 'אלוף הברזל',
    description: 'השלמת את כל אימוני הכוח שתוכננו לשבוע',
    icon_name: 'dumbbell',
    points_reward: 150,
  },
  {
    key: 'protein_master',
    name: 'מאסטר חלבון',
    description: 'עמדת ביעד החלבון 7 ימים ברציפות',
    icon_name: 'drumstick',
    points_reward: 200,
  },
  {
    key: 'iron_consistency',
    name: 'התמדה של ברזל',
    description: 'רצף דיווח יומי של 14 יום',
    icon_name: 'flame',
    points_reward: 300,
  },
];

const upsertBadge = db.prepare(`
  INSERT INTO badges (key, name, description, icon_name, points_reward)
  VALUES (@key, @name, @description, @icon_name, @points_reward)
  ON CONFLICT (key) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    icon_name = excluded.icon_name,
    points_reward = excluded.points_reward
`);
db.transaction((rows) => rows.forEach((r) => upsertBadge.run(r)))(BADGE_SEED);

export default db;
