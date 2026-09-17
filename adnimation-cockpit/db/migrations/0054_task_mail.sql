-- The emails a task is about, found and kept up to date.
--
-- He asked for the tasks to fish the relevant mail out of the mailbox and to
-- keep fishing. The mailbox is already mirrored into mail_threads; this is the
-- link between a task and the threads that turned out to be about it.
--
-- The subject and the counterpart are SNAPSHOT here rather than joined from
-- mail_threads. The mirror is a moving window over a mailbox of 151,000
-- messages, and a link that renders as a blank row because its thread has
-- rolled out of the window is worse than one that still says what it was.
--
-- dismissed_at is the whole quality control. The matcher is deliberately
-- strict, but it will still be wrong sometimes, and a wrong link he cannot get
-- rid of is how he stops reading them. Dismissed is remembered, so the next
-- run does not propose it again — and the row stays, because nothing here
-- deletes.
CREATE TABLE IF NOT EXISTS task_mail (
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  thread_id   TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  reasons     TEXT[] NOT NULL DEFAULT '{}',
  subject     TEXT,
  counterpart TEXT,
  last_message_at TIMESTAMPTZ,
  -- 'auto' for the matcher, an email address when he attached it himself.
  matched_by  TEXT NOT NULL DEFAULT 'auto',
  matched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at TIMESTAMPTZ,
  dismissed_by TEXT,
  PRIMARY KEY (task_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_task_mail_task ON task_mail(task_id, dismissed_at, score DESC);
CREATE INDEX IF NOT EXISTS idx_task_mail_thread ON task_mail(thread_id);

-- When the matcher last swept, so the screen can say how fresh this is and the
-- job can be seen to be running at all.
CREATE TABLE IF NOT EXISTS task_mail_runs (
  id          BIGSERIAL PRIMARY KEY,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  tasks_seen  INTEGER NOT NULL DEFAULT 0,
  threads_seen INTEGER NOT NULL DEFAULT 0,
  links_added INTEGER NOT NULL DEFAULT 0,
  note        TEXT
);
