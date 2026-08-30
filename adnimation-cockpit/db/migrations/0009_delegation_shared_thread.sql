-- Whether the delegation's Slack conversation includes the CEO.
--
-- A bot DM to the person it was handed to is a conversation between the bot and
-- them: it never appears in his own Slack, which is not what anyone expects
-- when they press send. A group conversation with both of them fixes that, and
-- needs the mpim scopes — so the code tries for one and records which it got,
-- and the screen can say plainly where the message can be read.

ALTER TABLE delegations ADD COLUMN IF NOT EXISTS slack_shared BOOLEAN NOT NULL DEFAULT false;
