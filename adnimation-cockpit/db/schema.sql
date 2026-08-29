-- Adnimation CEO Cockpit — PostgreSQL schema
-- Money is stored in minor units (cents) as BIGINT. Never use floats for money.
-- All timestamps are UTC (timestamptz). Render in Asia/Jerusalem.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE dept_code        AS ENUM ('CORE','SEAT','APP','DISP','CTV','BID','VID','ASIA');
CREATE TYPE task_priority    AS ENUM ('P0','P1','P2','P3');
CREATE TYPE task_source      AS ENUM ('manual','alert','slack','email','meeting','contract','anomaly','agent');
CREATE TYPE task_layer       AS ENUM ('mine','company');   -- native vs ClickUp mirror
CREATE TYPE partner_type     AS ENUM ('demand','supply','publisher','vendor','strategic');
CREATE TYPE deal_stage       AS ENUM ('lead','intro','qualified','negotiation','proposal_sent',
                                      'contract_out','integration','live','lost','dormant');
CREATE TYPE deal_source      AS ENUM ('calendly','conference','referral','outbound','inbound','other');
CREATE TYPE contract_category AS ENUM ('demand','supply','general');
CREATE TYPE contract_status  AS ENUM ('draft','negotiation','out_for_signature','awaiting_my_signature',
                                      'signed','expired','cancelled');
CREATE TYPE renewal_type     AS ENUM ('auto','manual');
CREATE TYPE version_source   AS ENUM ('inbound_mail','generated','counterparty','manual_upload');
CREATE TYPE risk_level       AS ENUM ('none','minor','material','redline');
CREATE TYPE clause_stance    AS ENUM ('opening','compromise','redline');
CREATE TYPE sig_auth_mode    AS ENUM ('per_doc','batch','conditional');
CREATE TYPE sig_status       AS ENUM ('pending','sent','signed','declined','expired','cancelled');
CREATE TYPE alert_type       AS ENUM ('REVENUE_ANOMALY','SITE_CHANGE','PARTNER_RISK','CONTRACT_DUE',
                                      'TASK_OVERDUE','PAYMENT_LATE','INTEGRATION_FAILURE','PEOPLE_EVENT',
                                      'SECURITY','PIPELINE','MANUAL');
CREATE TYPE severity         AS ENUM ('info','watch','warning','critical');
CREATE TYPE platform_type    AS ENUM ('web','app','ctv');
CREATE TYPE channel_type     AS ENUM ('slack','mail','whatsapp','meeting','call');
CREATE TYPE agent_outcome    AS ENUM ('done','halted','failed','dry_run');
CREATE TYPE delegation_status AS ENUM ('sent','acknowledged','in_progress','done','stale');

-- ============================================================
-- CORE
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','operator')),
  slack_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          dept_code NOT NULL UNIQUE,
  name_he       TEXT NOT NULL,
  owner_email   TEXT,
  monthly_target_cents BIGINT,
  active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE people (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  slack_id      TEXT,
  clickup_id    TEXT,
  role          TEXT,
  manager_id    UUID REFERENCES people(id),
  dept_id       UUID REFERENCES departments(id),
  is_external   BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true
);

-- ============================================================
-- TASKS
-- ============================================================

CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layer           task_layer NOT NULL,
  clickup_id      TEXT UNIQUE,               -- set for mirrored tasks
  clickup_url     TEXT,
  parent_id       UUID REFERENCES tasks(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  dept_id         UUID REFERENCES departments(id),
  owner_person_id UUID REFERENCES people(id),
  priority        task_priority NOT NULL DEFAULT 'P2',
  status          TEXT NOT NULL DEFAULT 'open',
  due_date        DATE,
  start_date      DATE,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  heat_score      INTEGER NOT NULL DEFAULT 0,
  blocked_people  UUID[] NOT NULL DEFAULT '{}',
  snooze_until    TIMESTAMPTZ,
  snooze_count    INTEGER NOT NULL DEFAULT 0,   -- 3+ marks it a Zombie
  money_impact_cents BIGINT,
  source          task_source NOT NULL DEFAULT 'manual',
  source_ref      TEXT,
  recurrence_rule TEXT,                         -- RRULE
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at  TIMESTAMPTZ
);
CREATE INDEX idx_tasks_layer_status ON tasks(layer, status) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_due   ON tasks(due_date) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_heat  ON tasks(heat_score DESC) WHERE archived_at IS NULL;

CREATE TABLE task_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_dependencies (
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'blocks',
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE TABLE delegations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_type TEXT NOT NULL,
  source_entity_id   UUID NOT NULL,
  task_id            UUID REFERENCES tasks(id),
  delegated_to       UUID NOT NULL REFERENCES people(id),
  clickup_task_id    TEXT,
  slack_message_url  TEXT,
  note               TEXT,
  due_date           DATE,
  status             delegation_status NOT NULL DEFAULT 'sent',
  delegated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_movement_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deleg_open ON delegations(status, last_movement_at);

-- ============================================================
-- REVENUE
-- ============================================================

CREATE TABLE revenue_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE NOT NULL,
  dept_id           UUID NOT NULL REFERENCES departments(id),
  partner_id        UUID,
  property_id       UUID,
  format            TEXT,
  gross_cents       BIGINT NOT NULL DEFAULT 0,
  net_cents         BIGINT NOT NULL DEFAULT 0,
  impressions       BIGINT NOT NULL DEFAULT 0,
  requests          BIGINT,
  ecpm_cents        BIGINT,
  fill_rate         NUMERIC(6,4),
  win_rate          NUMERIC(6,4),
  bid_density       NUMERIC(10,4),
  discrepancy_pct   NUMERIC(6,4),
  ivt_pct           NUMERIC(6,4),
  source_system     TEXT NOT NULL,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, dept_id, partner_id, property_id, format, source_system)
);
CREATE INDEX idx_rev_date_dept ON revenue_records(date DESC, dept_id);

CREATE TABLE revenue_baselines (
  scope_type    TEXT NOT NULL,          -- dept | partner | property | format
  scope_id      TEXT NOT NULL,
  dow           SMALLINT NOT NULL CHECK (dow BETWEEN 0 AND 6),
  median_net_cents BIGINT NOT NULL,
  stddev_cents  BIGINT,
  window_days   INTEGER NOT NULL DEFAULT 28,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id, dow)
);

-- ============================================================
-- PIPELINE (SALES)
-- ============================================================

CREATE TABLE deals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counterparty_name     TEXT NOT NULL,
  counterparty_domain   TEXT,
  partner_id            UUID,                       -- set when it goes live
  type                  partner_type NOT NULL,
  dept_id               UUID REFERENCES departments(id),
  stage                 deal_stage NOT NULL DEFAULT 'lead',
  stage_entered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_person_id       UUID NOT NULL REFERENCES people(id),
  -- next_step and next_step_date are MANDATORY for any open deal.
  next_step             TEXT,
  next_step_date        DATE,
  expected_monthly_revenue_cents BIGINT,
  probability           SMALLINT CHECK (probability BETWEEN 0 AND 100),
  expected_golive       DATE,
  source                deal_source NOT NULL DEFAULT 'other',
  source_detail         TEXT,
  geos                  TEXT[] NOT NULL DEFAULT '{}',
  formats               TEXT[] NOT NULL DEFAULT '{}',
  terms_notes           TEXT,
  blockers              TEXT,
  competitors           TEXT,
  contract_id           UUID,
  lost_reason           TEXT,
  last_touch_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deal_next_step_required CHECK (
    stage IN ('live','lost','dormant')
    OR (next_step IS NOT NULL AND next_step_date IS NOT NULL)
  ),
  CONSTRAINT deal_lost_needs_reason CHECK (
    stage <> 'lost' OR lost_reason IS NOT NULL
  )
);
CREATE INDEX idx_deals_stage ON deals(stage, stage_entered_at);
CREATE INDEX idx_deals_next  ON deals(next_step_date) WHERE stage NOT IN ('live','lost','dormant');

CREATE TABLE deal_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  channel     channel_type NOT NULL,
  summary     TEXT NOT NULL,
  source_url  TEXT,
  created_by  TEXT NOT NULL DEFAULT 'user',   -- user | agent:<name>
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_act ON deal_activities(deal_id, occurred_at DESC);

CREATE TABLE deal_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  title       TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE stage_thresholds (
  stage        deal_stage PRIMARY KEY,
  stale_days   INTEGER NOT NULL,
  default_probability SMALLINT
);

-- ============================================================
-- PARTNERS
-- ============================================================

CREATE TABLE partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  domain          TEXT,
  type            partner_type NOT NULL,
  dept_ids        UUID[] NOT NULL DEFAULT '{}',
  deal_id         UUID REFERENCES deals(id),
  owner_person_id UUID REFERENCES people(id),
  risk_score      SMALLINT NOT NULL DEFAULT 0,
  risk_reason     TEXT,
  commercial_terms TEXT,
  payment_terms   TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  went_live_at    DATE,
  last_interaction_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_partners_risk ON partners(risk_score DESC) WHERE status = 'active';

CREATE TABLE partner_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  title       TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE risk_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score       SMALLINT NOT NULL,
  factors     JSONB NOT NULL          -- {factor: {value, weight, contribution}}
);

-- ============================================================
-- CONTRACTS
-- ============================================================

CREATE TABLE contract_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  category    contract_category NOT NULL,
  merge_fields JSONB NOT NULL DEFAULT '{}',
  drive_file_id TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  locked      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE clauses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic       TEXT NOT NULL,
  stance      clause_stance NOT NULL,
  body        TEXT NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  UNIQUE (topic, stance)
);

CREATE TABLE template_clauses (
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  clause_id   UUID NOT NULL REFERENCES clauses(id),
  ordinal     INTEGER NOT NULL,
  PRIMARY KEY (template_id, clause_id)
);

CREATE TABLE contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          UUID REFERENCES partners(id),
  deal_id             UUID REFERENCES deals(id),
  counterparty_name   TEXT NOT NULL,
  category            contract_category NOT NULL,
  category_confirmed  BOOLEAN NOT NULL DEFAULT false,  -- false = filed by rule, not yet reviewed
  doc_type            TEXT NOT NULL,                -- MSA | IO | NDA | Amendment | Renewal
  dept_id             UUID REFERENCES departments(id),
  status              contract_status NOT NULL DEFAULT 'draft',
  status_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  start_date          DATE,
  end_date            DATE,
  renewal             renewal_type,
  notice_period_days  INTEGER,
  value_cents         BIGINT,
  commercial_terms    TEXT,
  payment_terms       TEXT,
  template_id         UUID REFERENCES contract_templates(id),
  deviations          JSONB NOT NULL DEFAULT '[]',
  drive_folder_id     TEXT,
  legal_owner         TEXT,
  biz_owner_person_id UUID REFERENCES people(id),
  current_version_id  UUID,
  next_alert_at       DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contracts_out ON contracts(status, status_changed_at)
  WHERE status IN ('out_for_signature','awaiting_my_signature','negotiation');
CREATE INDEX idx_contracts_expiry ON contracts(end_date) WHERE status = 'signed';

CREATE TABLE contract_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version_no        INTEGER NOT NULL,
  drive_file_id     TEXT,
  file_name         TEXT NOT NULL,
  file_hash         TEXT NOT NULL,
  source            version_source NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_approved_baseline BOOLEAN NOT NULL DEFAULT false,
  redline_summary   JSONB,
  risk_level        risk_level NOT NULL DEFAULT 'none',
  UNIQUE (contract_id, version_no),
  UNIQUE (file_hash)
);

CREATE TABLE routing_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL DEFAULT 'contract',
  match_conditions  JSONB NOT NULL,        -- {category, doc_type, dept, min_value_cents}
  recipient_person_ids UUID[] NOT NULL,
  channels          TEXT[] NOT NULL DEFAULT '{mail,slack}',
  notify_ceo        BOOLEAN NOT NULL DEFAULT false,
  ordinal           INTEGER NOT NULL DEFAULT 100,
  active            BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE signature_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version_id   UUID NOT NULL REFERENCES contract_versions(id),
  requested_by          UUID REFERENCES users(id),
  authorized_by         UUID REFERENCES users(id),
  auth_mode             sig_auth_mode NOT NULL,
  authorization_expires_at TIMESTAMPTZ,
  provider              TEXT NOT NULL,
  provider_envelope_id  TEXT,
  status                sig_status NOT NULL DEFAULT 'pending',
  value_cents           BIGINT,
  conditions_snapshot   JSONB NOT NULL,     -- exact state at approval time
  signed_at             TIMESTAMPTZ,
  signer_ip             INET,
  signer_device         TEXT,
  audit_trail_url       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signature log is append-only.
CREATE OR REPLACE FUNCTION block_signature_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'signature_requests is append-only after signing';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sig_no_delete BEFORE DELETE ON signature_requests
  FOR EACH ROW EXECUTE FUNCTION block_signature_mutation();

CREATE TRIGGER trg_sig_no_update_after_signed BEFORE UPDATE ON signature_requests
  FOR EACH ROW WHEN (OLD.status = 'signed') EXECUTE FUNCTION block_signature_mutation();

-- ============================================================
-- PROPERTIES (SITES / APPS)
-- ============================================================

CREATE TABLE properties (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier        TEXT NOT NULL UNIQUE,      -- domain or bundle id
  name              TEXT,
  publisher_partner_id UUID REFERENCES partners(id),
  dept_id           UUID REFERENCES departments(id),
  platform          platform_type NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  launched_at       DATE,
  manager_person_id UUID REFERENCES people(id),
  last_scan_at      TIMESTAMPTZ,
  scan_interval_minutes INTEGER NOT NULL DEFAULT 1440
);

CREATE TABLE property_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ads_txt_hash  TEXT,
  ads_txt_body  TEXT,
  sellers_json_hash TEXT,
  tags          JSONB,
  cmp_vendor    TEXT,
  consent_rate  NUMERIC(6,4),
  http_status   INTEGER,
  ssl_expires_at DATE,
  ivt_pct       NUMERIC(6,4)
);
CREATE INDEX idx_prop_snap ON property_snapshots(property_id, scanned_at DESC);

CREATE TABLE ad_units (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  placement     TEXT NOT NULL,
  size          TEXT,
  format        TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  fill_rate     NUMERIC(6,4),
  ecpm_cents    BIGINT,
  top_demand_partner_id UUID REFERENCES partners(id)
);

-- ============================================================
-- ALERTS (ACTION INBOX)
-- ============================================================

CREATE TABLE alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                alert_type NOT NULL,
  severity            severity NOT NULL,
  entity_type         TEXT,
  entity_id           UUID,
  group_key           TEXT,                 -- for grouping/suppression
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  what_happened       TEXT NOT NULL,
  occurred_at         TIMESTAMPTZ NOT NULL,
  money_impact_cents  BIGINT,
  owner_person_id     UUID REFERENCES people(id),
  recommended_action  TEXT NOT NULL,
  created_by          TEXT NOT NULL DEFAULT 'system',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_by            UUID REFERENCES users(id),
  acked_at            TIMESTAMPTZ,
  snooze_until        TIMESTAMPTZ,
  spawned_task_id     UUID REFERENCES tasks(id)
);
CREATE INDEX idx_alerts_open ON alerts(created_at DESC) WHERE acked_at IS NULL;
CREATE INDEX idx_alerts_group ON alerts(group_key, created_at DESC);

-- ============================================================
-- AGENTS
-- ============================================================

CREATE TABLE agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL UNIQUE,
  description         TEXT,
  trigger_type        TEXT NOT NULL,        -- schedule | webhook | event
  trigger_config      JSONB NOT NULL DEFAULT '{}',
  conditions          JSONB NOT NULL DEFAULT '[]',
  actions             JSONB NOT NULL DEFAULT '[]',
  autonomy_level      SMALLINT NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 1 AND 4),
  has_irreversible_action BOOLEAN NOT NULL DEFAULT false,
  routing_rule_ids    UUID[] NOT NULL DEFAULT '{}',
  max_runs_per_hour   INTEGER NOT NULL DEFAULT 10,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  run_count           INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_level_change_at TIMESTAMPTZ,
  -- Irreversible agents may never run silently.
  CONSTRAINT agent_no_silent_irreversible
    CHECK (NOT (has_irreversible_action AND autonomy_level = 4))
);

CREATE TABLE agent_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id              UUID NOT NULL REFERENCES agents(id),
  triggered_by          TEXT NOT NULL,
  dry_run               BOOLEAN NOT NULL DEFAULT false,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ,
  conditions_evaluated  JSONB NOT NULL DEFAULT '[]',  -- [{name, passed, detail}]
  actions_taken         JSONB NOT NULL DEFAULT '[]',
  recipients            TEXT[] NOT NULL DEFAULT '{}',
  outcome               agent_outcome,
  halt_reason           TEXT,
  error                 TEXT
);
CREATE INDEX idx_agent_runs ON agent_runs(agent_id, started_at DESC);

-- Agent run log is immutable.
CREATE OR REPLACE FUNCTION block_agent_run_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_runs is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agent_runs_no_delete BEFORE DELETE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION block_agent_run_mutation();

CREATE TRIGGER trg_agent_runs_no_update BEFORE UPDATE ON agent_runs
  FOR EACH ROW WHEN (OLD.finished_at IS NOT NULL) EXECUTE FUNCTION block_agent_run_mutation();

CREATE TABLE system_flags (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO system_flags (key, value) VALUES
  ('agents_global_kill', 'false'),
  ('max_auto_sign_value_cents', '0'),
  ('daily_alert_cap', '15');

-- ============================================================
-- COMMUNICATIONS, MEETINGS, DECISIONS, INITIATIVES
-- ============================================================

CREATE TABLE interactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       channel_type NOT NULL,
  partner_id    UUID REFERENCES partners(id),
  deal_id       UUID REFERENCES deals(id),
  person_id     UUID REFERENCES people(id),
  occurred_at   TIMESTAMPTZ NOT NULL,
  summary       TEXT,
  source_url    TEXT,
  needs_reply   BOOLEAN NOT NULL DEFAULT false,
  replied_at    TIMESTAMPTZ
);
CREATE INDEX idx_interactions_partner ON interactions(partner_id, occurred_at DESC);

CREATE TABLE meetings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcal_event_id     TEXT UNIQUE,
  title             TEXT NOT NULL,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  is_external       BOOLEAN NOT NULL DEFAULT false,
  dept_id           UUID REFERENCES departments(id),
  deal_id           UUID REFERENCES deals(id),
  partner_id        UUID REFERENCES partners(id),
  attendee_emails   TEXT[] NOT NULL DEFAULT '{}',
  my_response       TEXT,
  notes_doc_url     TEXT,
  notes_summary     TEXT,
  prep_sent_at      TIMESTAMPTZ
);

CREATE TABLE decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  body          TEXT,
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT NOT NULL,
  assumptions   TEXT,
  owner_person_id UUID REFERENCES people(id),
  review_date   DATE
);

CREATE TABLE initiatives (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  dept_id       UUID REFERENCES departments(id),
  owner_person_id UUID REFERENCES people(id),
  status        TEXT NOT NULL DEFAULT 'active',
  milestones    JSONB NOT NULL DEFAULT '[]',
  kpis          JSONB NOT NULL DEFAULT '[]'
);

-- ============================================================
-- INTEGRATION HEALTH + AUDIT
-- ============================================================

CREATE TABLE integration_health (
  system            TEXT PRIMARY KEY,
  last_success_at   TIMESTAMPTZ,
  last_attempt_at   TIMESTAMPTZ,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT
);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor         TEXT NOT NULL,          -- user email or agent:<name>
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  before        JSONB,
  after         JSONB,
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit ON audit_log(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

-- ============================================================
-- SEED
-- ============================================================

INSERT INTO departments (code, name_he) VALUES
  ('CORE','Core Publishers'), ('SEAT','Seat Lease'), ('APP','RTB In-App'),
  ('DISP','RTB Display'), ('CTV','CTV'), ('BID','Bidder'),
  ('VID','Video'), ('ASIA','Asia Expansion');

INSERT INTO stage_thresholds (stage, stale_days, default_probability) VALUES
  ('lead', 7, 5), ('intro', 7, 10), ('qualified', 14, 20),
  ('negotiation', 21, 40), ('proposal_sent', 14, 60),
  ('contract_out', 14, 80), ('integration', 30, 95), ('live', 9999, 100);
