-- What an agent has learned from his own mail.
--
-- Separate from `agents.instructions`, which is what he told it. Both feed the
-- same prompt and they are not interchangeable: one he wrote and can correct
-- in a sentence, the other was read off a year of his replies and is only as
-- good as what it read. Keeping them apart means retraining never overwrites
-- something he said, and correcting something he said never needs a retrain.
create table if not exists agent_learning (
  agent_name    text primary key,
  -- The distilled profile, in prose, as it goes into the prompt.
  profile       text,
  -- A handful of real pairs kept as examples, so he can see what it read.
  examples      jsonb not null default '[]'::jsonb,
  -- Plain facts, no model involved: counts, languages, lengths.
  facts         jsonb not null default '{}'::jsonb,
  threads_read  integer not null default 0,
  started_at    timestamptz,
  learned_at    timestamptz,
  error         text,
  -- True when he has edited the profile himself, so a retrain asks first.
  edited_by_him boolean not null default false
);

comment on table agent_learning is
  'What an agent read off his own mail. His own instructions live on agents.instructions.';
