import { desc, eq, sql } from 'drizzle-orm';
import { db, people } from '@/lib/db';

/**
 * The team, in the order he actually reaches for them.
 *
 * Alphabetical is the order nobody wants. Four or five names carry almost
 * every hand-over on this board and the rest are there for the once-a-quarter
 * case, so a picker sorted by name puts the person he needs eighth and someone
 * he has never given anything to first.
 *
 * What "common" counts is how often he has CHOSEN somebody — every time he put
 * them on a task, plus every hand-over he sent them. The first version of this
 * counted open tasks instead, which is a different question with a different
 * answer: somebody he assigns constantly who closes things fast ranks near
 * zero on open work and near the top on choices, and it is the choices that
 * predict the next one.
 *
 * Ties break on the most recent pick, so of two people he has used ten times
 * each, the one from this week comes first.
 *
 * The person column is written out as "people"."id" rather than interpolated.
 * Drizzle renders an interpolated column as a BARE name inside a raw template,
 * and a bare "id" inside `from tasks t` binds to the task's own id instead of
 * the row being counted for — which is not an error, just a subquery that
 * compares a task to itself and answers 0 every time.
 */
const PERSON = sql`"people"."id"`;
export interface RankedPerson {
  id: string;
  label: string;
  email: string;
  /** How many times he has put them on something — the sort key. */
  picks: number;
  /** What they are carrying now. Shown on hover; never the order. */
  onTasks: number;
}

/** Placeholder addresses the roster invents for a Slack account with no mail. */
const isReal = (email: string) => !email.endsWith('@slack.local');

export async function peopleByUse(): Promise<RankedPerson[]> {
  /*
   * Both ways he picks somebody, counted together.
   *
   * task_assignees is every name he has put on a task — including the backfill
   * from the mirror's owners, which is right: those are the people he works
   * with. delegations is every hand-over, which never touched task_assignees
   * and would otherwise leave the people he mostly delegates to looking unused.
   */
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      picks: sql<number>`(
        (select count(*) from task_assignees a where a.person_id = ${PERSON})
        + (select count(*) from delegations d where d.delegated_to = ${PERSON})
      )::int`,
      lastPick: sql<Date | null>`greatest(
        (select max(a.added_at) from task_assignees a where a.person_id = ${PERSON}),
        (select max(d.delegated_at) from delegations d where d.delegated_to = ${PERSON})
      )`,
      onTasks: sql<number>`(
        select count(distinct t.id)::int
          from tasks t
         where t.archived_at is null
           and t.status <> 'done'
           and (
             t.owner_person_id = ${PERSON}
             or exists (
               select 1 from task_assignees a
                where a.task_id = t.id and a.person_id = ${PERSON}
             )
           )
      )`,
    })
    .from(people)
    .where(eq(people.active, true))
    .orderBy(desc(sql`4`), desc(sql`5`), people.name);

  return rows
    .filter((p) => isReal(p.email))
    .map((p) => ({ id: p.id, label: p.name, email: p.email, picks: p.picks, onTasks: p.onTasks }));
}

/**
 * The team with no history to go on — plain alphabetical.
 *
 * Only the fallback; the query above is the real answer.
 */
export async function anyPeople(): Promise<RankedPerson[]> {
  const rows = await db
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(eq(people.active, true))
    .orderBy(people.name);
  return rows
    .filter((p) => isReal(p.email))
    .map((p) => ({ id: p.id, label: p.name, email: p.email, picks: 0, onTasks: 0 }));
}
