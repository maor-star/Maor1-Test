-- The sales pipeline the CEO works: every client he is in touch with, with the
-- classifications he tracks them by. Separate from crm_companies, which is a
-- read-only mirror of HubSpot — this table is his own working state, so an
-- edit here is never overwritten by the next CRM sync.
CREATE TABLE IF NOT EXISTS pipeline_clients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  domain         TEXT,
  /* demand | supply | publisher | seat_lease | vendor | other */
  client_type    TEXT NOT NULL DEFAULT 'other',
  /* lead | intro | qualified | negotiation | proposal_sent | contract_out | integration | live | dormant | lost */
  stage          TEXT NOT NULL DEFAULT 'lead',
  /* hot | warm | cold */
  temperature    TEXT NOT NULL DEFAULT 'warm',
  owner_person_id UUID REFERENCES people(id),
  /* Spec 3: saving without a next step and a date is rejected server-side. */
  next_step      TEXT,
  next_step_date DATE,
  value_cents    BIGINT,
  probability    SMALLINT,
  source         TEXT,
  /* Free-text the CEO keeps himself. */
  notes          TEXT,
  last_contact_at TIMESTAMPTZ,
  hubspot_company_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_clients (stage) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pipeline_next_step ON pipeline_clients (next_step_date) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_name ON pipeline_clients (lower(name)) WHERE archived_at IS NULL;

-- Every touch, so "when did we last speak" is a fact rather than a memory.
CREATE TABLE IF NOT EXISTS pipeline_touches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES pipeline_clients(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,           -- call | meeting | email | slack | note
  summary     TEXT NOT NULL,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT NOT NULL DEFAULT 'ceo'
);
CREATE INDEX IF NOT EXISTS idx_pipeline_touches ON pipeline_touches (client_id, happened_at DESC);
