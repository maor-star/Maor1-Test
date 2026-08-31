-- An opportunity that has matured into a real deal.
--
-- The two modules describe different stages of the same thing: an opportunity
-- is something worth doing that nobody has decided on, a pipeline client is a
-- deal already being worked. Promotion is the moment it crosses over, and it
-- has to leave a trail in both directions — otherwise the opportunity looks
-- abandoned and the deal looks like it came from nowhere.

alter table opportunities
  add column if not exists pipeline_client_id uuid references pipeline_clients(id),
  add column if not exists promoted_at timestamptz;

create index if not exists idx_opportunities_promoted
  on opportunities (pipeline_client_id) where pipeline_client_id is not null;

-- Where a pipeline client came from, so the deal can point back.
alter table pipeline_clients
  add column if not exists opportunity_id uuid references opportunities(id);
