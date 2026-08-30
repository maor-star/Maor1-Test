-- Delegations become something you can start, not only something that happens
-- to a task.
--
-- Until now a delegation could only be created from an existing entity, so the
-- tracker showed an empty list with no way to add to it. A delegation started
-- from the tracker itself has no source entity, so the column has to allow it.

ALTER TABLE delegations ALTER COLUMN source_entity_id DROP NOT NULL;

-- The Slack thread the conversation lives in. The permalink alone was enough to
-- read replies, but posting into the thread needs the channel and the parent
-- timestamp, and re-parsing them out of a URL on every reply is fragile.
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS slack_channel_id TEXT;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS slack_thread_ts  TEXT;

-- What was handed over, when it is wanted, and how it was closed. The title
-- used to live only on the linked task, which a standalone delegation has none
-- of.
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS title       TEXT;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS priority    TEXT NOT NULL DEFAULT 'P2';
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS closed_at   TIMESTAMPTZ;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS closed_note TEXT;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Nudges: how many times he has chased it, and when last. A tracker that
-- cannot tell you whether you already chased somebody makes you chase twice.
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS nudge_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deleg_live ON delegations (archived_at, last_movement_at DESC);
