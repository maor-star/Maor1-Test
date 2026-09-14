import { desc, eq, sql } from 'drizzle-orm';
import { db, people } from '@/lib/db';

/**
 * The team, in the order he actually uses them.
 *
 * Alphabetical is the order nobody wants. Four or five names carry almost
 * every task on this board and the rest are there for the once-a-quarter
 * case — so a picker sorted by name puts the person he needs eighth and the
 * one he has never assigned anything to first.
 *
 * "How often" counts tasks that are still open. Somebody who ran a project
 * last winter and left should not stay at the top of the list for it, and a
 * count over live work moves with the company rather than with its history.
 */
export interface RankedPerson {
  id: string;
  label: string;
  email: string;
  /** How many live tasks they are on — shown so the order is not a mystery. */
  onTasks: number;
}

export async function peopleByUse(): Promise<RankedPerson[]> {
  /*
   * Both places a name can be. task_assignees is the truth for anything he has
   * edited; a mirrored task he has never touched carries only the ClickUp
   * owner and has no row there, and those are most of the board — counting one
   * without the other would rank the team by which half it looked at.
   */
  const counts = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      onTasks: sql<number>`(
        select count(distinct t.id)::int
          from tasks t
         where t.archived_at is null
           and t.status <> 'done'
           and (
             t.owner_person_id = ${people.id}
             or exists (
               select 1 from task_assignees a
                where a.task_id = t.id and a.person_id = ${people.id}
             )
           )
      )`,
    })
    .from(people)
    .where(eq(people.active, true))
    .orderBy(desc(sql`3`), people.name);

  return counts
    // Placeholder addresses the roster invents for a Slack account with no
    // mail are not people he hands work to.
    .filter((p) => !p.email.endsWith('@slack.local'))
    .map((p) => ({ id: p.id, label: p.name, email: p.email, onTasks: p.onTasks }));
}

/**
 * Who a newly created task should offer first, when there is no history yet.
 *
 * Only used as the fallback ordering; the query above is the real answer.
 */
export async function anyPeople(): Promise<RankedPerson[]> {
  const rows = await db
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(eq(people.active, true))
    .orderBy(people.name);
  return rows
    .filter((p) => !p.email.endsWith('@slack.local'))
    .map((p) => ({ id: p.id, label: p.name, email: p.email, onTasks: 0 }));
}
