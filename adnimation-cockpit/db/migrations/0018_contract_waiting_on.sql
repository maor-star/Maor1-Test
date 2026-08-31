-- Whose move it is, said outright.
--
-- It was derived from the status, which covers the obvious cases — out for
-- signature is with them, awaiting my signature is with me — and misses the
-- common one: he has read it, sent back changes, and is waiting on their
-- revision. That is "in review" and it is with them, and there was no way to
-- say so. Now the status still decides the default and this overrides it.
alter table contracts
  add column if not exists waiting_on_override text
    check (waiting_on_override in ('you', 'them'));
