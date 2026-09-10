import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, delegations, people } from '@/lib/db';
import { delegationsForMany } from '@/lib/delegation/for-many';

/**
 * The DELEGATE TO column — "so I know if I passed it on".
 *
 * A row said nothing about this before, so a task he handed over on Tuesday
 * looked exactly like one nobody had touched and the only way to check was to
 * leave the screen. What the cell shows comes from here.
 */

const MARK = `mark-test-${Date.now()}`;
const ENTITY_A = '11111111-1111-4111-8111-111111111111';
const ENTITY_B = '22222222-2222-4222-8222-222222222222';
let personId: string;

afterEach(async () => {
  await db.delete(delegations).where(inArray(delegations.sourceEntityId, [ENTITY_A, ENTITY_B]));
  if (personId) await db.delete(people).where(eq(people.id, personId));
});

async function seedPerson(name = 'Assaf Kalderon') {
  const [p] = await db
    .insert(people)
    .values({ name, email: `${MARK}-${Math.random()}@slack.local` })
    .returning({ id: people.id });
  personId = p!.id;
  return p!.id;
}

async function handOver(over: Partial<typeof delegations.$inferInsert> = {}) {
  const id = personId ?? (await seedPerson());
  await db.insert(delegations).values({
    sourceEntityType: 'task',
    sourceEntityId: ENTITY_A,
    delegatedTo: id,
    title: 'מחכה לעדכון בנושא: משהו',
    status: 'sent',
    ...over,
  });
}

describe('who is holding each row', () => {
  it('says nothing about something nobody has', async () => {
    await seedPerson();
    const marks = await delegationsForMany('task', [ENTITY_A]);
    expect(marks.get(ENTITY_A)).toBeUndefined();
  });

  it('names the person once it has gone out', async () => {
    await seedPerson();
    await handOver();
    const marks = await delegationsForMany('task', [ENTITY_A]);
    expect(marks.get(ENTITY_A)?.personName).toBe('Assaf Kalderon');
  });

  it('separates sent from answered', async () => {
    // The whole reason he asked. A tracker that only records who it went to
    // shows those two the same, and they mean opposite things.
    await seedPerson();
    await handOver();
    expect((await delegationsForMany('task', [ENTITY_A])).get(ENTITY_A)?.repliedAt).toBeNull();

    await db.delete(delegations).where(eq(delegations.sourceEntityId, ENTITY_A));
    await handOver({ replyAt: new Date(), status: 'acknowledged' });
    expect((await delegationsForMany('task', [ENTITY_A])).get(ENTITY_A)?.repliedAt).not.toBeNull();
  });

  it('shows where it is now when it has been handed over twice', async () => {
    // Passed to one person, taken back, passed to another. The row should say
    // who has it, not who used to.
    const first = await seedPerson('First Holder');
    await db.insert(delegations).values({
      sourceEntityType: 'task', sourceEntityId: ENTITY_A, delegatedTo: first,
      title: 'x', status: 'sent', delegatedAt: new Date('2026-09-01T10:00:00Z'),
    });
    await db.insert(delegations).values({
      sourceEntityType: 'task', sourceEntityId: ENTITY_A, delegatedTo: first,
      title: 'y', status: 'sent', delegatedAt: new Date('2026-09-08T10:00:00Z'),
    });

    const mark = (await delegationsForMany('task', [ENTITY_A])).get(ENTITY_A);
    expect(mark?.delegatedAt.toISOString()).toBe('2026-09-08T10:00:00.000Z');
  });

  it('forgets one he archived', async () => {
    // An archived hand-over is a decision he reversed. Showing it would say a
    // task is with somebody who is not holding it.
    await seedPerson();
    await handOver({ archivedAt: new Date() });
    expect((await delegationsForMany('task', [ENTITY_A])).get(ENTITY_A)).toBeUndefined();
  });

  it('keeps one kind of thing out of another kind of row', async () => {
    // Ids are unique, but a contract and a task must never borrow each
    // other's hand-over just because a lookup was sloppy.
    await seedPerson();
    await handOver();
    expect((await delegationsForMany('contract', [ENTITY_A])).get(ENTITY_A)).toBeUndefined();
  });

  it('answers for a whole screen in one go, and for none at all', async () => {
    await seedPerson();
    await handOver();
    const marks = await delegationsForMany('task', [ENTITY_A, ENTITY_B]);
    expect(marks.size).toBe(1);
    expect((await delegationsForMany('task', [])).size).toBe(0);
  });
});
