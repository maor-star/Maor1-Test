-- Departments, named as the ClickUp lists name them.
INSERT INTO departments (code, name_he) VALUES
  ('TRADING','Trading'), ('GENERAL','General'), ('HR','HR'),
  ('DEMAND','Demand'), ('MKT','Marketing'), ('FIN','Finance'),
  ('DEV','Development')
ON CONFLICT (code) DO NOTHING;

-- The four the spec invented that the company has no list for. Kept rather than
-- deleted, because revenue rows may already reference them; hidden from pickers.
UPDATE departments SET active = false WHERE code IN ('APP','DISP','CTV','ASIA');
UPDATE departments SET active = true  WHERE code NOT IN ('APP','DISP','CTV','ASIA');
