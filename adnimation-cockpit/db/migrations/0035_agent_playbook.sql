-- The document behind an agent.
--
-- An agent already had two kinds of instruction: the dials, which the code
-- reads directly, and the brief — a few lines of correction. Neither is the
-- place for "here is how this job is actually done": the dials are too narrow
-- and the brief is a note, not a document.
--
-- The playbook is that document. It is written or pasted or uploaded once,
-- read at the top of every run alongside the brief, and it is where the shape
-- of the work lives: what counts, what never does, how to word things, who to
-- ask, the examples worth copying.

alter table agents add column if not exists playbook          text;
alter table agents add column if not exists playbook_name     text;
alter table agents add column if not exists playbook_updated_at timestamptz;
