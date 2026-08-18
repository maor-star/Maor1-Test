-- סכימת בסיס הנתונים ל-Cloudflare D1.
-- זהה לסכימה ב-db.js — D1 הוא SQLite אמיתי, ולכן היא עוברת ללא שינוי.

CREATE TABLE IF NOT EXISTS employees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  role         TEXT    DEFAULT '',
  hourly_rate  REAL    NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date    TEXT    NOT NULL,
  hours        REAL    NOT NULL,
  description  TEXT    DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date TEXT    NOT NULL,
  category     TEXT    NOT NULL DEFAULT 'אחר',
  vendor       TEXT    DEFAULT '',
  description  TEXT    DEFAULT '',
  amount       REAL    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  income_date  TEXT    NOT NULL,
  client       TEXT    DEFAULT '',
  description  TEXT    DEFAULT '',
  amount       REAL    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_time_employee ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_date     ON time_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_exp_date      ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_inc_date      ON income(income_date);
