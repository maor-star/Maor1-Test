/**
 * Removes every trace of sample data, so the cockpit shows only what a real
 * source put there.
 *
 *   DATABASE_URL=... npx tsx scripts/purge-demo.ts
 *
 * Three things go:
 *  1. the five tasks and one delegation an earlier version of scripts/seed.ts
 *     invented, matched by their exact titles;
 *  2. the two fabricated people those rows referenced, who are not members of
 *     the ClickUp workspace;
 *  3. rows left behind by the automated tests — the mirror rows the fake
 *     ClickUp adapter created, and the timestamped tasks the E2E suite makes;
 *  4. mirrored ClickUp tasks that are already finished — the cockpit carries
 *     open work only.
 *
 * Safe to re-run: everything is matched exactly and a second run finds nothing.
 * Deliberately conservative — it names the rows it removes rather than
 * truncating tables, so a real task that happens to be open is never at risk.
 */
import { and, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { db, delegations, people, tasks } from '../lib/db';

/** The exact titles the old seed created. Nothing else is touched. */
const DEMO_TASK_TITLES = [
  'Close the IO renewal with PubMatic',
  'Fill Rate drop in RTB In-App',
  'Approve the new sellers.json for the Asia brand',
  'Quarterly feedback round with department heads',
  'Review the CTV proposal from Yao',
];

/** People the old seed invented who are not in the ClickUp workspace. */
const DEMO_PEOPLE_EMAILS = ['ravit@adnimation.com', 'tomer@adnimation.com'];

/**
 * ClickUp ids the fake adapter mints. Real ClickUp ids are unbroken
 * alphanumeric strings, so a hyphenated prefix cannot collide with one.
 */
const FAKE_CLICKUP_PREFIXES = ['fake-', 'cu-'];

/**
 * Titles the E2E suite generates. Each ends in the millisecond timestamp of the
 * run, which is what makes the pattern safe to match on.
 */
const E2E_TITLE_PREFIXES = ['Automated delegation ', 'Automated check ', 'To close '];

async function main() {
  // Delegations first — they reference tasks.
  const demoTasks = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(inArray(tasks.title, DEMO_TASK_TITLES), isNull(tasks.clickupId)));

  let removedDelegations = 0;
  if (demoTasks.length > 0) {
    const gone = await db
      .delete(delegations)
      .where(inArray(delegations.taskId, demoTasks.map((t) => t.id)))
      .returning({ id: delegations.id });
    removedDelegations = gone.length;
  }

  const removedTasks = demoTasks.length
    ? (
        await db
          .delete(tasks)
          .where(inArray(tasks.id, demoTasks.map((t) => t.id)))
          .returning({ id: tasks.id })
      ).length
    : 0;

  // Rows the automated tests left behind.
  const testRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      or(
        ...FAKE_CLICKUP_PREFIXES.map((p) => like(tasks.clickupId, `${p}%`)),
        ...E2E_TITLE_PREFIXES.map((p) =>
          and(like(tasks.title, `${p}%`), sql`${tasks.title} ~ '[0-9]{10,}$'`),
        ),
      )!,
    );

  let removedTestRows = 0;
  if (testRows.length > 0) {
    const ids = testRows.map((t) => t.id);
    await db.delete(delegations).where(inArray(delegations.taskId, ids));
    removedTestRows = (
      await db.delete(tasks).where(inArray(tasks.id, ids)).returning({ id: tasks.id })
    ).length;
  }

  // Finished ClickUp tasks: the mirror holds open work only.
  const removedFinished = (
    await db
      .delete(tasks)
      .where(and(eq(tasks.layer, 'company'), isNotNull(tasks.clickupId), eq(tasks.status, 'done')))
      .returning({ id: tasks.id })
  ).length;

  // The invented people, but only once nothing points at them any more.
  let removedPeople = 0;
  for (const email of DEMO_PEOPLE_EMAILS) {
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.email, email))
      .limit(1);
    if (!person) continue;

    const stillUsed = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.ownerPersonId, person.id))
      .limit(1);
    if (stillUsed.length > 0) {
      console.log(`Kept ${email}: still owns at least one task.`);
      continue;
    }

    const stillDelegated = await db
      .select({ id: delegations.id })
      .from(delegations)
      .where(eq(delegations.delegatedTo, person.id))
      .limit(1);
    if (stillDelegated.length > 0) {
      console.log(`Kept ${email}: still has an open delegation.`);
      continue;
    }

    await db.delete(people).where(eq(people.id, person.id));
    removedPeople += 1;
  }

  console.log(
    [
      `Removed ${removedTasks} sample task(s)`,
      `${removedDelegations} sample delegation(s)`,
      `${removedTestRows} test artefact(s)`,
      `${removedFinished} finished ClickUp task(s)`,
      `${removedPeople} fabricated person record(s)`,
    ].join(', ') + '.',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
