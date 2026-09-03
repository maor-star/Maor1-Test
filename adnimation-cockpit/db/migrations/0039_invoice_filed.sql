-- When a forwarded invoice was filed under its Gmail label.
--
-- Forwarding to finance and filing the original are two different steps with
-- two different failure modes (send scope versus modify scope), so each is
-- recorded on its own. A row with forwarded_at and no filed_at is exactly the
-- set the next run goes back and files — which is also how everything
-- forwarded before the label existed gets its label.

alter table invoice_forwards
  add column if not exists filed_at timestamptz;
