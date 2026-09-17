-- The emails themselves, not only a link to them.
--
-- "תעתיק את המייל עצמו לתוך המערכת ולא רק את הלינק." A link is a second
-- journey: he is reading a task, and finding out what the mail actually said
-- meant opening Gmail, finding his place, and coming back. The thread the
-- matcher already found is now copied in and readable where the task is.
--
-- Only the threads a task is linked to are copied. The mirror holds three
-- thousand threads and he will read the eighty that are on his work; fetching
-- every body would be a large, slow and entirely wasted copy of his mailbox.
--
-- Plain text only, and capped. This is for reading what was said, not for
-- reproducing the mail — no HTML, no attachments (those already open through
-- the attachments panel), and a very long message is stored truncated with a
-- flag saying so rather than silently cut.
CREATE TABLE IF NOT EXISTS mail_messages (
  message_id  TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  from_name   TEXT,
  from_email  TEXT,
  to_line     TEXT,
  sent_at     TIMESTAMPTZ,
  -- His own messages in the thread, so the screen can show a conversation
  -- rather than a pile.
  from_me     BOOLEAN NOT NULL DEFAULT FALSE,
  body        TEXT NOT NULL,
  truncated   BOOLEAN NOT NULL DEFAULT FALSE,
  has_files   BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages(thread_id, sent_at);

-- When this thread's messages were last copied in, so the job knows what is
-- already done and what has grown since.
ALTER TABLE mail_threads ADD COLUMN IF NOT EXISTS bodies_at TIMESTAMPTZ;
ALTER TABLE mail_threads ADD COLUMN IF NOT EXISTS bodies_count INTEGER NOT NULL DEFAULT 0;
