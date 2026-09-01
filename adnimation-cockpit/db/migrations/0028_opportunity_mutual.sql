-- The partner who is both.
--
-- An opportunity could be new demand or new supply and not both, which is the
-- arrangement he most wants: the same partner sending us supply and buying
-- demand. It was the one kind he could not file, so those landed on "other"
-- and stopped being findable as either.
alter table opportunities drop constraint if exists opportunities_kind_ck;
alter table opportunities add constraint opportunities_kind_ck check (kind in (
  'supply','demand','mutual','partnership','product','upsell','cost','hiring','investment','other'));
