-- Contracts as an intake, not just a register.
--
-- Everything arriving by mail or Slack lands here for him to classify, is
-- filed into Drive by category, counterparty and status, and is linked back to
-- the opportunity or the deal it belongs to.

-- The two statuses the board is actually run on. Postgres will not add an enum
-- value inside a transaction block that then uses it, so these come first.
alter type contract_status add value if not exists 'unclassified' before 'draft';
alter type contract_status add value if not exists 'in_review' after 'draft';
