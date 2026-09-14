-- Two kinds of message now go out from a task, and the record has to say which.
--
-- "What's happening with this?" is the chase. The new one is the hand-over
-- itself: whoever he puts on a task is told in Slack, there and then, with the
-- task in the message — because a name added to a row is not a notification,
-- and until now the person found out when he chased them for a thing they had
-- never been told about.
--
-- Same table, because the delivery, the record and the "last sent" lookup are
-- identical and a second table would have been the same columns twice.
ALTER TABLE task_nudges ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'nudge';

CREATE INDEX IF NOT EXISTS idx_task_nudges_kind ON task_nudges(task_id, kind, sent_at DESC);
