-- HubSpot mirror. The CRM stays the system of record; these tables are the
-- cockpit's own copy, so sales works without leaving the app and keeps working
-- when HubSpot is unreachable.
CREATE TABLE IF NOT EXISTS crm_companies (
  hubspot_id        TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  domain            TEXT,
  lifecycle_stage   TEXT,
  owner_id          TEXT,
  owner_name        TEXT,
  industry          TEXT,
  country           TEXT,
  city              TEXT,
  phone             TEXT,
  contact_count     INTEGER NOT NULL DEFAULT 0,
  hs_created_at     TIMESTAMPTZ,
  hs_updated_at     TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_companies_name ON crm_companies (lower(name));
CREATE INDEX IF NOT EXISTS idx_crm_companies_stage ON crm_companies (lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_crm_companies_updated ON crm_companies (hs_updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_contacts (
  hubspot_id        TEXT PRIMARY KEY,
  first_name        TEXT,
  last_name         TEXT,
  email             TEXT,
  phone             TEXT,
  job_title         TEXT,
  company_name      TEXT,
  company_id        TEXT,
  lifecycle_stage   TEXT,
  owner_id          TEXT,
  owner_name        TEXT,
  last_activity_at  TIMESTAMPTZ,
  hs_created_at     TIMESTAMPTZ,
  hs_updated_at     TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_company ON crm_contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts (lower(email));
CREATE INDEX IF NOT EXISTS idx_crm_contacts_updated ON crm_contacts (hs_updated_at DESC);
