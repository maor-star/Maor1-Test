-- The rest of the contract intake. Split from 0014 because a new enum value
-- cannot be used in the same transaction that adds it.

alter table contracts
  -- Where it came from, so a contract keeps its trail back to the conversation.
  add column if not exists source text not null default 'manual',
  add column if not exists source_ref text,
  add column if not exists source_url text,
  add column if not exists received_at timestamptz,
  -- What it is linked to. A contract almost always belongs to something the
  -- cockpit already knows about; holding both means neither module has to
  -- guess which one is authoritative.
  add column if not exists opportunity_id uuid references opportunities(id),
  add column if not exists pipeline_client_id uuid references pipeline_clients(id),
  add column if not exists drive_path text,
  add column if not exists notes text,
  add column if not exists archived_at timestamptz;

create index if not exists idx_contracts_live
  on contracts (status, status_changed_at desc) where archived_at is null;

alter table contract_versions
  add column if not exists drive_path text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists source_ref text,
  add column if not exists source_url text,
  -- Set once the bytes are actually in Drive. Until then the row records that
  -- the contract exists and where it came from, which is worth having even
  -- while Drive is not yet authorised.
  add column if not exists uploaded_at timestamptz;

-- Spec 10: deduplicate by file hash before creating a record. The same
-- agreement forwarded twice, or arriving by both mail and Slack, is one
-- version, not two.
create unique index if not exists idx_contract_versions_hash
  on contract_versions (contract_id, file_hash);

-- One row per attachment we have already looked at, so a re-scan of the same
-- mailbox does not re-propose what he has already dealt with.
create table if not exists contract_intake_seen (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  source_ref  text not null,
  file_name   text,
  file_hash   text,
  decided     text not null default 'pending',
  contract_id uuid references contracts(id),
  seen_at     timestamptz not null default now(),
  unique (source, source_ref)
);
