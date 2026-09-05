-- Who a hand-over went to, when it was not one of the five people on record.
--
-- He asked for three things this makes room for: everybody in the Slack
-- workspace rather than the handful seeded here, a channel as a target in its
-- own right, and handing something over by email to somebody with no Slack at
-- all.
--
-- `delegated_to` stays required and keeps pointing at a person, because the
-- tracker is built on it. A channel or an email address is recorded alongside
-- it: the person is who owns the answer, the target is where the message was
-- actually delivered.

alter table delegations
  add column if not exists target_kind text not null default 'person',
  add column if not exists target_ref  text;

-- Where it was sent, for the card to say so and for the reply check to know
-- which thread to look in.
create index if not exists idx_delegations_target on delegations (target_kind, target_ref);

-- Slack ids and emails for everyone, not just the seeded five. A person the
-- roster sync finds in Slack and cannot match to an email keeps a placeholder
-- address, so the column stays usable as a key.
alter table people
  add column if not exists from_slack boolean not null default false;
