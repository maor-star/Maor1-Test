/**
 * Bootstrap. Creates the two sign-in accounts and the real team, and nothing
 * else. Safe to re-run.
 *
 *   DATABASE_URL=... npx tsx scripts/seed.ts
 *
 * There is deliberately no sample data here. Everything the cockpit shows comes
 * from a real source — tasks from ClickUp, revenue from the Ad Ops Architect
 * system, contracts entered by hand — so a plausible-looking invented task or
 * delegation on the CEO's screen would be worse than an empty one. An earlier
 * version seeded five demo tasks and a demo delegation; `scripts/purge-demo.ts`
 * removes them from any database that still carries them.
 *
 * The people below are the workspace's actual members, read from ClickUp.
 */
import { sql } from 'drizzle-orm';
import { db, people, tasks, users } from '../lib/db';
import { parseAllowedEmails } from '../lib/auth/allowlist';

async function main() {
  const allowed = parseAllowedEmails(process.env.ALLOWED_EMAILS);
  const [ownerEmail = 'maor@adnimation.com', operatorEmail = 'mor@adnimation.com'] = allowed;

  await db
    .insert(users)
    .values([
      { email: ownerEmail, name: 'Maor Davidovich', role: 'owner' },
      { email: operatorEmail, name: 'Mor Azagury', role: 'operator' },
    ])
    .onConflictDoNothing();

  // The ClickUp workspace members. Emails matter: the mirror attaches a task to
  // a person by matching the ClickUp assignee's email against this table.
  const team = [
    {
      name: 'Maor Davidovich',
      email: ownerEmail,
      slackId: process.env.SLACK_CEO_USER_ID ?? null,
      clickupId: '113491082',
      role: 'CEO',
    },
    { name: 'Mor Azagury', email: operatorEmail, slackId: null, clickupId: '296486895', role: 'Chief of Staff' },
    { name: 'Tomer Treves', email: 'treves@adnimation.com', slackId: null, clickupId: '113525629', role: 'Demand & Supply' },
    { name: 'Amir Malka', email: 'amir@adnimation.com', slackId: null, clickupId: '113548970', role: 'Core Publishers' },
    { name: 'Mohd Zeeshan', email: 'mohd@adnimation.com', slackId: null, clickupId: '113625979', role: 'Bidder' },
  ];
  await db.insert(people).values(team).onConflictDoNothing();

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks);
  console.log(
    `Bootstrap complete. ${team.length} people, ${count} tasks (tasks come from the ClickUp sync).`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
