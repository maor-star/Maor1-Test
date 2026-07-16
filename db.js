import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, 'data', 'office.db');

// Ensure data directory exists
import { mkdirSync } from 'fs';
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
db.exec(`
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
`);

export default db;
