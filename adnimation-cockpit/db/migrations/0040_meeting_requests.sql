-- What the meetings agent has answered, so it never answers twice.
--
-- One row per thread, written the moment a proposal goes out. Everything the
-- run decided is on it — which times were offered, which link, and why a
-- thread was left alone — because the question he will ask is not "how many"
-- but "why did it write to that person", and the answer has to be readable a
-- month later.
--
-- Nothing here is deleted. A thread that was left alone keeps its row and its
-- reason; that is the record of what the agent chose not to do.

create table if not exists meeting_requests (
  thread_id      text primary key,
  from_email     text,
  from_name      text,
  subject        text,
  -- 'propose' offered times from the calendar, 'calendly' sent the link only,
  -- 'ask' put the question to him in Slack first, 'left' answered nothing and
  -- says why in `why`.
  kind           text not null default 'propose',
  status         text not null default 'proposed',
  proposed_slots jsonb not null default '[]'::jsonb,
  reply          text,
  why            text,
  -- Filled in later, when he confirms a time and it goes in the calendar.
  chosen_slot    jsonb,
  event_id       text,
  -- When it asked him in Slack instead of answering: where the question is, so
  -- the next run can read his reply to it, and what he said.
  ask_channel    text,
  ask_ts         text,
  asked_at       timestamptz,
  answer         text,
  replied_at     timestamptz,
  filed_at       timestamptz,
  told_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists meeting_requests_created_idx on meeting_requests (created_at desc);
