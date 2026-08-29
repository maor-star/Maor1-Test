/**
 * Development seed. Creates the two users, the team, and a handful of tasks
 * that exercise the heat score and hygiene rules. Safe to re-run.
 *
 *   DATABASE_URL=... npx tsx scripts/seed.ts
 */
import { eq, sql } from 'drizzle-orm';
import { subDays } from 'date-fns';
import { db, delegations, departments, people, tasks, users } from '../lib/db';
import { computeHeat } from '../lib/tasks/heat';
import { parseAllowedEmails } from '../lib/auth/allowlist';

const now = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const allowed = parseAllowedEmails(process.env.ALLOWED_EMAILS);
  const [ownerEmail = 'maor@adnimation.com', operatorEmail = 'mor@adnimation.com'] = allowed;

  await db
    .insert(users)
    .values([
      { email: ownerEmail, name: 'מאור דוידוביץ׳', role: 'owner' },
      { email: operatorEmail, name: 'מור', role: 'operator' },
    ])
    .onConflictDoNothing();

  const team = [
    { name: 'מור', email: operatorEmail, slackId: 'U_MOR', role: 'Chief of Staff' },
    { name: 'רוית', email: 'ravit@adnimation.com', slackId: 'U_RAVIT', role: 'Legal & Contracts' },
    { name: 'אמיר', email: 'amir@adnimation.com', slackId: 'U_AMIR', role: 'Finance' },
    { name: 'תומר', email: 'tomer@adnimation.com', slackId: 'U_TOMER', role: 'Supply' },
    { name: 'מאור דוידוביץ׳', email: ownerEmail, slackId: process.env.SLACK_CEO_USER_ID ?? 'U_CEO', role: 'CEO' },
  ];
  await db.insert(people).values(team).onConflictDoNothing();

  const depts = await db.select().from(departments);
  const deptBy = (code: string) => depts.find((d) => d.code === code)?.id ?? null;
  const peopleRows = await db.select().from(people);
  const personBy = (email: string) => peopleRows.find((p) => p.email === email)?.id ?? null;

  const seedTasks = [
    {
      title: 'לסגור את חידוש ה-IO מול PubMatic',
      description: 'החוזה פג בסוף החודש. רוית מחכה לאישור התנאים המסחריים.',
      priority: 'P0' as const,
      dueDate: iso(subDays(now, 4)),
      deptId: deptBy('DISP'),
      ownerPersonId: null,
      moneyImpactCents: 4_200_000,
      tags: ['contract', 'demand'],
    },
    {
      title: 'ירידה ב-Fill Rate ב-RTB In-App',
      description: 'ה-Fill Rate ירד ב-18% מול השבוע שעבר. לבדוק מול הבידר.',
      priority: 'P0' as const,
      dueDate: iso(subDays(now, 1)),
      deptId: deptBy('APP'),
      ownerPersonId: personBy('tomer@adnimation.com'),
      moneyImpactCents: 1_800_000,
      tags: ['revenue', 'supply'],
    },
    {
      title: 'לאשר את sellers.json החדש למותג אסיה',
      description: 'מותג נפרד לחלוטין — לוודא שאין חפיפה עם ה-sellers.json הראשי.',
      priority: 'P1' as const,
      dueDate: iso(subDays(now, 2)),
      deptId: deptBy('ASIA'),
      ownerPersonId: null,
      moneyImpactCents: null,
      tags: ['asia'],
    },
    {
      title: 'סבב משוב רבעוני לראשי מחלקות',
      priority: 'P2' as const,
      dueDate: iso(subDays(now, -10)),
      deptId: null,
      ownerPersonId: personBy(operatorEmail),
      moneyImpactCents: null,
      tags: ['people'],
    },
    {
      title: 'לבדוק את הצעת ה-CTV מ-Yao',
      priority: 'P1' as const,
      dueDate: null, // trips the "P0/P1 without a due date" hygiene rule
      deptId: deptBy('CTV'),
      ownerPersonId: null,
      moneyImpactCents: 900_000,
      tags: ['ctv', 'pipeline'],
    },
  ];

  for (const t of seedTasks) {
    const existing = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.title, t.title)).limit(1);
    if (existing.length > 0) continue;
    await db.insert(tasks).values({
      layer: 'mine',
      title: t.title,
      description: 'description' in t ? t.description : null,
      priority: t.priority,
      status: 'open',
      dueDate: t.dueDate,
      deptId: t.deptId,
      ownerPersonId: t.ownerPersonId,
      tags: t.tags,
      moneyImpactCents: t.moneyImpactCents,
      blockedPeople: [],
      source: 'manual',
      heatScore: computeHeat(
        {
          priority: t.priority,
          dueDate: t.dueDate,
          moneyImpactCents: t.moneyImpactCents,
          blockedPeople: [],
          ownerPersonId: t.ownerPersonId,
        },
        now,
      ),
    });
  }

  // One delegation already past the three-day staleness threshold.
  const [contractTask] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.title, 'לסגור את חידוש ה-IO מול PubMatic'))
    .limit(1);
  const ravit = personBy('ravit@adnimation.com');
  if (contractTask && ravit) {
    const already = await db
      .select({ id: delegations.id })
      .from(delegations)
      .where(eq(delegations.taskId, contractTask.id))
      .limit(1);
    if (already.length === 0) {
      await db.insert(delegations).values({
        sourceEntityType: 'task',
        sourceEntityId: contractTask.id,
        taskId: contractTask.id,
        delegatedTo: ravit,
        note: 'לוודא מול הצד השני שהתנאים המסחריים לא השתנו.',
        dueDate: iso(subDays(now, 1)),
        status: 'sent',
        delegatedAt: subDays(now, 5),
        lastMovementAt: subDays(now, 5),
      });
    }
  }

  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks);
  console.log(`Seed complete. ${count} tasks in the database.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
