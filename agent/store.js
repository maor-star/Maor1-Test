// שמירת לוג ריצות של הסוכן ב-SQLite (אותו קובץ DB של האפליקציה).
// מאפשר לעקוב אחרי מה הסוכן עשה בכל יום, כמה הצליח/נכשל, ומתי.

import db from '../db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task         TEXT    NOT NULL,
    status       TEXT    NOT NULL,              -- 'success' | 'error'
    started_at   TEXT    NOT NULL,
    finished_at  TEXT,
    processed    INTEGER NOT NULL DEFAULT 0,    -- כמה רשומות נגעו
    created      INTEGER NOT NULL DEFAULT 0,    -- כמה נוצרו
    updated      INTEGER NOT NULL DEFAULT 0,    -- כמה עודכנו
    dry_run      INTEGER NOT NULL DEFAULT 0,
    message      TEXT    DEFAULT '',            -- סיכום / הודעת שגיאה
    details      TEXT    DEFAULT ''             -- JSON חופשי
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_time ON agent_runs(started_at);
`);

export function startRun(task, dryRun) {
  const info = db.prepare(
    `INSERT INTO agent_runs (task, status, started_at, dry_run)
     VALUES (?, 'running', datetime('now'), ?)`
  ).run(task, dryRun ? 1 : 0);
  return info.lastInsertRowid;
}

export function finishRun(id, { status, processed = 0, created = 0, updated = 0, message = '', details = null }) {
  db.prepare(
    `UPDATE agent_runs
     SET status = ?, finished_at = datetime('now'),
         processed = ?, created = ?, updated = ?, message = ?, details = ?
     WHERE id = ?`
  ).run(
    status, processed, created, updated,
    String(message).slice(0, 2000),
    details ? JSON.stringify(details).slice(0, 8000) : '',
    id
  );
}

export function recentRuns(limit = 20) {
  return db.prepare(
    `SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?`
  ).all(limit);
}
