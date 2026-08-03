import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, 'data', 'home.db');

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
db.exec(`
  -- קטגוריות הוצאה/הכנסה
  CREATE TABLE IF NOT EXISTS categories (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    kind           TEXT    NOT NULL DEFAULT 'expense',   -- expense | income
    is_home        INTEGER NOT NULL DEFAULT 1,           -- נספר בעלות אחזקת הבית
    color          TEXT    DEFAULT '#3f6fff',
    monthly_budget REAL    NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- כללי סיווג אוטומטי (טקסט שמופיע בעסקה -> קטגוריה)
  CREATE TABLE IF NOT EXISTS category_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    match_text   TEXT    NOT NULL,
    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- עסקאות (כרטיסי אשראי + חשבון בנק + ידני)
  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_date      TEXT    NOT NULL,
    source       TEXT    NOT NULL DEFAULT 'manual',      -- credit_card | bank | manual
    account      TEXT    DEFAULT '',                     -- שם הכרטיס / חשבון הבנק
    description  TEXT    DEFAULT '',                      -- טקסט גולמי מהתדפיס
    merchant     TEXT    DEFAULT '',                      -- שם בית העסק (מנוקה)
    amount       REAL    NOT NULL DEFAULT 0,              -- תמיד חיובי
    kind         TEXT    NOT NULL DEFAULT 'expense',      -- expense | income
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    notes        TEXT    DEFAULT '',
    hash         TEXT    UNIQUE,                          -- למניעת כפילויות בייבוא
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- הוצאות קבועות (חשבונות חוזרים)
  CREATE TABLE IF NOT EXISTS recurring_bills (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    provider     TEXT    DEFAULT '',
    amount       REAL    NOT NULL DEFAULT 0,
    frequency    TEXT    NOT NULL DEFAULT 'monthly',      -- monthly | bimonthly | quarterly | yearly
    due_day      INTEGER,                                 -- יום בחודש לחיוב
    professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    notes        TEXT    DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- בעלי מקצוע
  CREATE TABLE IF NOT EXISTS professionals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    trade        TEXT    DEFAULT '',                      -- חשמלאי, אינסטלטור, גנן...
    company      TEXT    DEFAULT '',
    phone        TEXT    DEFAULT '',
    email        TEXT    DEFAULT '',
    rating       INTEGER DEFAULT 0,                       -- 0-5
    notes        TEXT    DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- תעודות אחריות
  CREATE TABLE IF NOT EXISTS warranties (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name      TEXT    NOT NULL,
    category       TEXT    DEFAULT '',                    -- מקרר, מזגן, דוד שמש...
    brand          TEXT    DEFAULT '',
    model          TEXT    DEFAULT '',
    serial         TEXT    DEFAULT '',
    area           TEXT    DEFAULT '',                    -- מיקום בבית
    vendor         TEXT    DEFAULT '',                    -- מאיפה נקנה
    purchase_date  TEXT,
    warranty_months INTEGER NOT NULL DEFAULT 12,
    expiry_date    TEXT,                                  -- דריסה ידנית (אופציונלי)
    cost           REAL    NOT NULL DEFAULT 0,
    professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
    doc_url        TEXT    DEFAULT '',                    -- קישור לסריקת התעודה
    notes          TEXT    DEFAULT '',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- רכיבי בית ותחזוקה תקופתית (מסננים, מזגנים, משאבת בריכה...)
  CREATE TABLE IF NOT EXISTS components (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,                     -- מסנן מים למטבח
    system          TEXT    DEFAULT 'כללי',              -- מים, חשמל, מיזוג, בריכה, גינה...
    area            TEXT    DEFAULT '',
    professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
    last_replaced   TEXT,                                 -- תאריך החלפה אחרון
    interval_months INTEGER NOT NULL DEFAULT 12,          -- כל כמה חודשים להחליף
    cost_estimate   REAL    NOT NULL DEFAULT 0,
    notes           TEXT    DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- יומן תחזוקה / החלפות
  CREATE TABLE IF NOT EXISTS maintenance_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    component_id    INTEGER REFERENCES components(id) ON DELETE CASCADE,
    service_date    TEXT    NOT NULL,
    description     TEXT    DEFAULT '',
    cost            REAL    NOT NULL DEFAULT 0,
    professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- תאורה: סוגי נורות ומנורות לפי חדר
  CREATE TABLE IF NOT EXISTS lighting (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    area          TEXT    DEFAULT '',                     -- חדר / אזור
    fixture       TEXT    DEFAULT '',                     -- שם המנורה / גוף התאורה
    bulb_type     TEXT    DEFAULT 'LED',                  -- LED / הלוגן / פלואורסנט
    base          TEXT    DEFAULT '',                     -- E27 / E14 / GU10 ...
    wattage       REAL    DEFAULT 0,
    color_temp    TEXT    DEFAULT '',                     -- 3000K / 4000K ...
    quantity      INTEGER NOT NULL DEFAULT 1,
    last_replaced TEXT,
    notes         TEXT    DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(tx_date);
  CREATE INDEX IF NOT EXISTS idx_tx_cat      ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_comp_prof   ON components(professional_id);
  CREATE INDEX IF NOT EXISTS idx_mlog_comp   ON maintenance_log(component_id);
`);

// ---- Seed default data on first run ----
const seedNeeded = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c === 0;
if (seedNeeded) {
  const insCat = db.prepare(
    'INSERT INTO categories (name, kind, is_home, color) VALUES (?, ?, ?, ?)'
  );
  const expense = [
    ['חשמל', '#f59e0b'], ['מים וביוב', '#0ea5e9'], ['גז', '#ef4444'],
    ['ארנונה', '#8b5cf6'], ['ועד בית', '#6366f1'], ['אינטרנט וטלוויזיה', '#3b82f6'],
    ['טלפון וסלולר', '#06b6d4'], ['ביטוח דירה ומבנה', '#14b8a6'],
    ['בריכה – תחזוקה', '#0891b2'], ['בריכה – כימיקלים', '#22d3ee'],
    ['גינון ותחזוקת גינה', '#16a34a'], ['השקיה וצמחייה', '#65a30d'],
    ['ניקיון ועזרת בית', '#a855f7'], ['תיקונים ותחזוקה', '#d97706'],
    ['מכשירי חשמל וריהוט', '#e11d48'], ['אבטחה ומיגון', '#475569'],
    ['מזון וסופר', '#f97316'], ['דלק ורכב', '#84cc16'],
    ['מיסים ואגרות', '#7c3aed'], ['אחר', '#6b7280'],
  ];
  for (const [name, color] of expense) insCat.run(name, 'expense', 1, color);
  // הכנסות / העברות שאינן עלות אחזקת בית
  insCat.run('משכורת', 'income', 0, '#16a34a');
  insCat.run('הכנסה אחרת', 'income', 0, '#22c55e');
  insCat.run('העברה בין חשבונות', 'expense', 0, '#94a3b8');

  const insProf = db.prepare('INSERT INTO professionals (name, trade) VALUES (?, ?)');
  // רשומות דוגמה ריקות של תחומים נפוצים (שם ריק כדי שהמשתמש ימלא) — מדלגים
  void insProf;
}

export default db;
