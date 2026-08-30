-- The mailbox, as the cockpit holds it.
--
-- Mirrored rather than read live: showing a hundred threads means a hundred
-- Gmail calls, which is a slow page and a rate limit waiting to happen. The
-- sync runs on a timer and the screen reads the table, exactly as the ClickUp
-- and CRM mirrors work.
--
-- Nothing here is ever written back to Gmail. The scope granted is readonly and
-- that is deliberate: the cockpit reads the mailbox, it does not run it.

CREATE TABLE IF NOT EXISTS mail_threads (
  thread_id        TEXT PRIMARY KEY,
  subject          TEXT,
  snippet          TEXT,
  -- Who the conversation is with — the other party, not the mailbox owner.
  counterpart_name  TEXT,
  counterpart_email TEXT,
  participants     TEXT[] NOT NULL DEFAULT '{}',
  message_count    INTEGER NOT NULL DEFAULT 1,
  last_message_at  TIMESTAMPTZ NOT NULL,
  first_message_at TIMESTAMPTZ,
  -- The whole point of the screen: the last word is theirs, so it is on him.
  last_from_me     BOOLEAN NOT NULL DEFAULT false,
  unread           BOOLEAN NOT NULL DEFAULT false,
  starred          BOOLEAN NOT NULL DEFAULT false,
  -- Gmail's own importance marker, kept separate from ours.
  gmail_important  BOOLEAN NOT NULL DEFAULT false,
  -- Ours: the sender is somebody the company actually deals with.
  known_contact    BOOLEAN NOT NULL DEFAULT false,
  known_company    TEXT,
  labels           TEXT[] NOT NULL DEFAULT '{}',
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Handled here, so it stops appearing in "needs a reply" even if the mail
  -- itself was answered somewhere else or needed no answer at all.
  dismissed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mail_recent ON mail_threads (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_waiting
  ON mail_threads (last_message_at DESC)
  WHERE last_from_me = false AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_counterpart ON mail_threads (lower(counterpart_email));
