-- Delegation reply radar.
--
-- A delegation is answered somewhere else — Mor replies in the Slack thread, or
-- by email. Until the cockpit reads those two places, "no movement" only means
-- "nobody told the cockpit", which is exactly the failure the tracker exists to
-- prevent. These columns hold what was found and where, so the answer is
-- visible next to the ask.

ALTER TABLE delegations ADD COLUMN IF NOT EXISTS reply_channel      TEXT;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS reply_at           TIMESTAMPTZ;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS reply_author       TEXT;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS reply_excerpt      TEXT;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS reply_url          TEXT;
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS replies_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deleg_unanswered
  ON delegations (replies_checked_at)
  WHERE reply_at IS NULL;
