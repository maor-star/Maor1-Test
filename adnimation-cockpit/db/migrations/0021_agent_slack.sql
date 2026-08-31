-- Whether an agent tells him what it did, in Slack.
--
-- Per agent rather than global: the contract reader running four times a day
-- is worth knowing about, and the mailbox tidier filing twelve newsletters is
-- the kind of notification that trains you to ignore notifications.
--
-- Default false, like everything else about an agent — a new one is silent
-- until he says otherwise.
alter table agents
  add column if not exists notify_slack boolean not null default false;
