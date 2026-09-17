-- Every department is on the list, CTV included.
--
-- Four of the fifteen were sitting inactive — RTB In-App, RTB Display, CTV and
-- Asia Expansion — which is why the Department dropdown on a task stopped at
-- Development and he could not file anything under CTV. They were switched off
-- before any of them had a task; they are departments he works in now.
--
-- `active` stays what it is (the flag that hides a department without deleting
-- it); this only turns these four back on.
UPDATE departments SET active = TRUE WHERE active = FALSE;
