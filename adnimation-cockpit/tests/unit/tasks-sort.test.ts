import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, tasks } from '@/lib/db';
import { listTasks } from '@/lib/tasks/queries';
import { createTask } from '@/lib/tasks/mutations';

/**
 * Ordering the list.
 *
 * Heat first is the default and has to stay it — the top of the list being
 * what to do next is the whole point of the score. The two new orders answer
 * different questions, and the tiebreak matters as much as the order: rows
 * that compare equal must not come back in a different order each load, which
 * reads as the list shuffling itself while he looks at it.
 */
const TAG = `sort-test-${Date.now()}`;
const ids: string[] = [];

beforeAll(async () => {
  const make = async (title: string, priority: 'P0' | 'P2', createdAt: Date) => {
    const t = await createTask(
      { title, priority, status: 'open', tags: [TAG], blockedPeople: [], source: 'manual' },
      'test@adnimation.com',
    );
    // createTask stamps now(); these need to be spread out to be ordered.
    await db.update(tasks).set({ createdAt }).where(eq(tasks.id, t.id));
    ids.push(t.id);
    return t.id;
  };

  await make(`${TAG} oldest`, 'P2', new Date('2026-01-01T09:00:00Z'));
  await make(`${TAG} middle`, 'P0', new Date('2026-05-01T09:00:00Z'));
  await make(`${TAG} newest`, 'P2', new Date('2026-08-01T09:00:00Z'));
});

afterAll(async () => {
  if (ids.length > 0) await db.delete(tasks).where(inArray(tasks.id, ids));
});

const titles = async (sort: 'heat' | 'newest' | 'oldest' | 'due') =>
  (await listTasks({ search: TAG, sort })).map((t) => t.title);

describe('ordering the task list', () => {
  it('puts the newest first when he asks for newest', async () => {
    expect(await titles('newest')).toEqual([
      `${TAG} newest`,
      `${TAG} middle`,
      `${TAG} oldest`,
    ]);
  });

  it('reverses exactly, when he asks for oldest', async () => {
    expect(await titles('oldest')).toEqual([
      `${TAG} oldest`,
      `${TAG} middle`,
      `${TAG} newest`,
    ]);
  });

  it('still leads with the hottest by default', async () => {
    // The P0 has the highest heat score, whatever its age.
    expect((await titles('heat'))[0]).toBe(`${TAG} middle`);
  });

  it('breaks a tie the same way every time', async () => {
    const once = await titles('heat');
    const twice = await titles('heat');
    expect(twice).toEqual(once);
  });
});
