-- The company's departments are the ClickUp lists it actually works in, not the
-- eight units the spec sketched. Idempotent: safe to re-run.
ALTER TYPE dept_code ADD VALUE IF NOT EXISTS 'TRADING';
ALTER TYPE dept_code ADD VALUE IF NOT EXISTS 'GENERAL';
ALTER TYPE dept_code ADD VALUE IF NOT EXISTS 'HR';
ALTER TYPE dept_code ADD VALUE IF NOT EXISTS 'DEMAND';
ALTER TYPE dept_code ADD VALUE IF NOT EXISTS 'MKT';
ALTER TYPE dept_code ADD VALUE IF NOT EXISTS 'FIN';
ALTER TYPE dept_code ADD VALUE IF NOT EXISTS 'DEV';
