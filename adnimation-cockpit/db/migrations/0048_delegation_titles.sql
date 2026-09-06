-- Give the hand-overs that never stored a title the one they went out under.
--
-- A delegation made from a task wrote a null: the title was built, put in the
-- Slack message and written to the audit row, and then left out of the insert.
-- The screen covered for it by falling back to the task's own title, so it read
-- correctly while the record was empty — which holds only until the task is
-- renamed or archived, and then the hand-over says "Untitled" and nobody can
-- tell what it was waiting on.
--
-- The task's title is exactly what the message said, so it is the right thing
-- to write back, in the same words the tracker uses everywhere else.
update delegations d
set title = 'מחכה לעדכון בנושא: ' || t.title
from tasks t
where d.task_id = t.id
  and d.title is null
  and t.title is not null
  and t.title <> '';

-- A standalone hand-over with no task behind it has nothing to recover from,
-- and there is no honest value to invent. It keeps its null and the screen goes
-- on saying "Untitled" for it, which is at least true.
