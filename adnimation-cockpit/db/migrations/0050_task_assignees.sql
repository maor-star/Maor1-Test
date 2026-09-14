-- Several people on one task, and a nudge he can send them.
--
-- The board had one owner per task because ClickUp's first assignee was all
-- the mirror kept. Real work here is shared — "Meeting with Taboola" is his
-- and Tomer's — and a single owner made the other names disappear, so the
-- board answered "who is carrying this" wrongly for every shared task.
--
-- owner_person_id stays, as the LEAD: the first name on the task. Heat
-- scoring, grouping by owner and the ClickUp mirror all read it, and one of
-- several people has to be the one the row sorts under. task_assignees holds
-- everyone, the lead included, so "who is on this" has one answer and not two.

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- 0 is the lead, which is the one mirrored into tasks.owner_person_id.
  position   INTEGER NOT NULL DEFAULT 0,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_person ON task_assignees(person_id);

-- Every task that already has an owner starts with that one name on it, so the
-- new table is the whole truth from its first day rather than only for tasks
-- edited since.
INSERT INTO task_assignees (task_id, person_id, position)
SELECT id, owner_person_id, 0 FROM tasks WHERE owner_person_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- "What's happening with this?" — sent to each person on a task, as a Slack
-- DM in his own name.
--
-- Recorded rather than fired and forgotten, because the question he asks next
-- is "did I already chase them, and when" — and a button that cannot answer
-- that gets pressed three times on a Tuesday.
CREATE TABLE IF NOT EXISTS task_nudges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id     UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  actor         TEXT NOT NULL,
  body          TEXT NOT NULL,
  -- Whether Slack took it, and where it landed, so a reply can be read later.
  delivered     BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,
  message_url   TEXT,
  channel_id    TEXT,
  message_ts    TEXT,
  -- True when it went out under his own Slack identity rather than the bot's.
  as_himself    BOOLEAN NOT NULL DEFAULT false,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_nudges_task ON task_nudges(task_id, sent_at DESC);
