-- Whether a forwarded invoice has also been taken out of the inbox.
--
-- Kept apart from forwarded_at because they can fail independently: the
-- forward is the point and the archive is tidying, and an invoice can be
-- safely delivered while the scope to archive it is still missing.
alter table invoice_forwards
  add column if not exists archived_at timestamptz;
