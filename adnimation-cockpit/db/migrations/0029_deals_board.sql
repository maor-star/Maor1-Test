-- One board for opportunities and the pipeline.
--
-- The pipeline's eight stages collapse onto six, and every live opportunity
-- that was never promoted becomes a deal in its first stage. Nothing is
-- deleted (CLAUDE.md §2): the opportunity rows stay, marked as promoted and
-- pointing at the deal they became, so an old link still resolves.

-- 1. Old stages onto new ones. 'contact' was never a stage at all — one row
--    was inserted with it by hand — and lands with the other open ones.
update pipeline_clients set stage = case stage
  when 'lead'          then 'open_new'
  when 'intro'         then 'open_new'
  when 'qualified'     then 'open_new'
  when 'contact'       then 'open_new'
  when 'proposal_sent' then 'negotiation'
  when 'contract_out'  then 'contract'
  when 'dormant'       then 'open_existing'
  else stage end
where stage in ('lead','intro','qualified','contact','proposal_sent','contract_out','dormant');

alter table pipeline_clients alter column stage set default 'open_new';

-- 2. Live opportunities become deals. The counterparty is the deal's name
--    when he wrote one down; the title (usually a mail subject) goes into the
--    notes so nothing he typed is lost. An upsell is by definition with
--    somebody we already work with. Deal names are unique (idx_pipeline_name),
--    so one deal per counterparty: the newest opportunity for a name creates
--    it and the older ones attach to it in step 3.
with candidates as (
  select o.*,
         left(coalesce(nullif(trim(o.counterparty), ''), o.title), 200) as deal_name
    from opportunities o
   where o.archived_at is null
     and o.status in ('new', 'exploring', 'parked')
     and o.pipeline_client_id is null
     and not exists (select 1 from pipeline_clients p where p.opportunity_id = o.id)
),
fresh as (
  select distinct on (lower(deal_name)) *
    from candidates c
   where not exists (select 1 from pipeline_clients p where lower(p.name) = lower(c.deal_name))
   order by lower(deal_name), created_at desc
)
insert into pipeline_clients
  (name, client_type, stage, temperature, next_step, next_step_date, value_cents,
   source, notes, opportunity_id, created_at, updated_at)
select
  f.deal_name,
  case f.kind
    when 'supply' then 'supply'
    when 'demand' then 'demand'
    when 'mutual' then 'mutual'
    when 'cost'   then 'vendor'
    else 'other' end,
  case when f.kind = 'upsell' then 'open_existing' else 'open_new' end,
  case when f.status = 'parked' then 'cold' else 'warm' end,
  f.next_step,
  f.next_step_date,
  f.value_cents,
  'opportunity:' || f.source,
  concat_ws(E'\n\n',
    case when nullif(trim(f.counterparty), '') is not null then f.title end,
    f.note,
    case when f.status = 'parked' and f.revisit_on is not null
      then 'Parked — revisit on ' || f.revisit_on::text end,
    f.source_excerpt,
    f.source_url),
  f.id,
  f.created_at,
  now()
from fresh f;

-- 3. Mark every one of them promoted — the ones that created a deal and the
--    ones whose counterparty already had one — so the inbox stops offering them.
update opportunities o
   set pipeline_client_id = p.id,
       promoted_at = now(),
       status = 'won',
       decided_at = coalesce(o.decided_at, now()),
       decided_note = coalesce(o.decided_note, 'Merged into the deals board'),
       last_touched_at = now()
  from pipeline_clients p
 where o.archived_at is null
   and o.status in ('new', 'exploring', 'parked')
   and o.pipeline_client_id is null
   and (p.opportunity_id = o.id
        or lower(p.name) = lower(left(coalesce(nullif(trim(o.counterparty), ''), o.title), 200)));

-- 4. A contract that pointed at the opportunity now also points at the deal.
update contracts c
   set pipeline_client_id = p.id
  from pipeline_clients p
 where p.opportunity_id = c.opportunity_id
   and c.opportunity_id is not null
   and c.pipeline_client_id is null;
