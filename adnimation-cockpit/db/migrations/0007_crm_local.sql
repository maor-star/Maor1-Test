-- The CRM stops being a mirror and becomes the book itself.
--
-- HubSpot is being wound down, so the cockpit has to hold records that were
-- never in it, edits that must survive every future sync, and a way to retire a
-- record without losing it. Three columns carry all of that:
--
--   source     'hubspot' for a copied record, 'local' for one created here.
--   edited_at  set the moment a person edits the record here. From then on the
--              sync leaves the row alone — his edit is the truth, not HubSpot's.
--   archived_at  retired, not deleted. Nothing in this system deletes data.

ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'hubspot';
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS notes       TEXT;
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS edited_at   TIMESTAMPTZ;
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS edited_by   TEXT;
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE crm_contacts  ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'hubspot';
ALTER TABLE crm_contacts  ADD COLUMN IF NOT EXISTS notes       TEXT;
ALTER TABLE crm_contacts  ADD COLUMN IF NOT EXISTS edited_at   TIMESTAMPTZ;
ALTER TABLE crm_contacts  ADD COLUMN IF NOT EXISTS edited_by   TEXT;
ALTER TABLE crm_contacts  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Every list view filters out archived rows, so the index has to carry it.
CREATE INDEX IF NOT EXISTS idx_crm_companies_live ON crm_companies (archived_at, name);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_live  ON crm_contacts  (archived_at);

-- The companies list is ordered by how many people we have at a company, then
-- by name. At sixty thousand rows that sort runs on every page of every filter,
-- so it gets its own index.
CREATE INDEX IF NOT EXISTS idx_crm_companies_rank
  ON crm_companies (contact_count DESC, name)
  WHERE archived_at IS NULL;
