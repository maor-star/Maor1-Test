import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db, delegations, people, taskAssignees, tasks } from '@/lib/db';
import { peopleByUse } from '@/lib/tasks/people-order';

/**
 * The order the pickers open in.
 *
 * Alphabetical put the person he needs eighth. The first ranking fixed that by
 * counting OPEN tasks, which answers a different question: somebody he assigns
 * constantly who closes things fast ranks near zero on open work and near the
 * top on choices — and it is the choices that predict the next one.
 */
const STAMP = Date.now();
const madePeople: string[] = [];
const madeTasks: string[] = [];

afterEach(async () => {
  if (madeTasks.length > 0) await db.delete(tasks).where(inArray(tasks.id, madeTasks));
  if (madePeople.length > 0) {
    await db.delete(delegations).where(inArray(delegations.delegatedTo, madePeople));
    await db.delete(people).where(inArray(people.id, madePeople));
  }
  madeTasks.length = 0;
  madePeople.length = 0;
});

async function person(name: string) {
  const [row] = await db
    .insert(people)
    .values({ name, email: `${name.toLowerCase()}-${STAMP}@test.local` })
    .returning();
  madePeople.push(row!.id);
  return row!;
}

async function taskFor(personId: string, status = 'open') {
  const [t] = await db
    .insert(tasks)
    .values({ layer: 'mine', title: `t-${STAMP}`, priority: 'P2', status, source: 'manual' })
    .returning();
  madeTasks.push(t!.id);
  await db.insert(taskAssignees).values({ taskId: t!.id, personId, position: 0 });
  return t!;
}

const find = (list: { id: string }[], id: string) => list.findIndex((p) => p.id === id);

describe('who the picker offers first', () => {
  /*
   * The case the old ranking got backwards: a closer. Everything he was given
   * is finished, so he carries nothing — and he is one of the people picked
   * most often.
   */
  it('puts somebody he picks often above somebody merely holding work', async () => {
    const closer = await person(`Closer${STAMP}`);
    const holder = await person(`Holder${STAMP}`);

    for (const _ of [1, 2, 3, 4]) await taskFor(closer.id, 'done');
    await taskFor(holder.id, 'open');

    const ranked = await peopleByUse();

    expect(find(ranked, closer.id)).toBeLessThan(find(ranked, holder.id));
    expect(ranked.find((p) => p.id === closer.id)?.picks).toBe(4);
    // The workload is still reported — it is just not the order.
    expect(ranked.find((p) => p.id === closer.id)?.onTasks).toBe(0);
    expect(ranked.find((p) => p.id === holder.id)?.onTasks).toBe(1);
  });

  it('counts a hand-over as a pick, so somebody he only delegates to still ranks', async () => {
    const delegatee = await person(`Deleg${STAMP}`);
    const assigned = await person(`Assign${STAMP}`);
    await taskFor(assigned.id);

    const [t] = await db
      .insert(tasks)
      .values({ layer: 'mine', title: `src-${STAMP}`, priority: 'P2', status: 'open', source: 'manual' })
      .returning();
    madeTasks.push(t!.id);
    for (const _ of [1, 2, 3]) {
      await db.insert(delegations).values({
        sourceEntityType: 'task',
        sourceEntityId: t!.id,
        delegatedTo: delegatee.id,
        title: 'waiting on it',
        priority: 'P2',
      });
    }

    const ranked = await peopleByUse();

    expect(ranked.find((p) => p.id === delegatee.id)?.picks).toBe(3);
    expect(find(ranked, delegatee.id)).toBeLessThan(find(ranked, assigned.id));
  });

  it('leaves out the placeholder addresses the Slack roster invents', async () => {
    const [ghost] = await db
      .insert(people)
      .values({ name: `Ghost${STAMP}`, email: `ghost-${STAMP}@slack.local` })
      .returning();
    madePeople.push(ghost!.id);

    expect((await peopleByUse()).some((p) => p.id === ghost!.id)).toBe(false);
  });

  it('still lists somebody he has never picked, just last', async () => {
    const never = await person(`Never${STAMP}`);
    const used = await person(`Used${STAMP}`);
    await taskFor(used.id);

    const ranked = await peopleByUse();

    expect(find(ranked, never.id)).toBeGreaterThan(-1);
    expect(find(ranked, never.id)).toBeGreaterThan(find(ranked, used.id));
    expect(ranked.find((p) => p.id === never.id)?.picks).toBe(0);
  });
});
