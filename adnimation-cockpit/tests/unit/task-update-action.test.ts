import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, tasks } from '@/lib/db';
import { FakeClickUpAdapter } from '@/lib/integrations/clickup';
import { db as _db, people } from '@/lib/db';
import { assigneesOf } from '@/lib/tasks/assignees';

/**
 * Changing a task from the board, whoever owns it.
 *
 * He moved several tasks to completed and none of them moved. The status cell
 * posts to updateTaskAction, which wrote through the cockpit's own updateTask
 * — and that refuses a mirrored task on purpose, because ClickUp is the system
 * of record and an edit has to reach it first. 209 of the 222 tasks on his
 * board are mirrored, so the change failed on all but thirteen, with nothing
 * on screen except a cell that snapped back.
 *
 * The failure was in the routing rather than in either write path, so this
 * tests the action: the thing the cell actually calls.
 */
const CLICKUP_ID = `cu-act-${Date.now()}`;
const OWNER = { id: 'u1', email: 'maor@adnimation.com', name: 'Maor', role: 'owner' as const };

const adapter = new FakeClickUpAdapter();

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/session', () => ({
  requireUser: async () => ({ id: 'u1', email: 'maor@adnimation.com', name: 'Maor', role: 'owner' }),
}));
vi.mock('@/lib/integrations/clickup', async (orig) => {
  const real = await orig<typeof import('@/lib/integrations/clickup')>();
  return { ...real, createClickUpAdapter: () => adapter };
});

const { updateTaskAction } = await import('@/app/actions/tasks');

async function seed(layer: 'mine' | 'company') {
  const [row] = await db
    .insert(tasks)
    .values({
      layer,
      ...(layer === 'company'
        ? { clickupId: CLICKUP_ID, clickupUrl: `https://clickup.test/t/${CLICKUP_ID}` }
        : {}),
      title: 'Close the seat lease',
      priority: 'P2',
      status: 'open',
      source: 'manual',
    })
    .returning();
  return row!;
}

beforeEach(() => {
  adapter.seed([
    {
      id: CLICKUP_ID,
      name: 'Close the seat lease',
      description: null,
      status: 'to do',
      priority: 3,
      dueDateMs: null,
      startDateMs: null,
      parentId: null,
      assigneeEmails: [OWNER.email],
      tags: [],
      url: `https://clickup.test/t/${CLICKUP_ID}`,
      updatedAtMs: Date.now(),
      listId: 'l1',
      listName: 'Dev',
      dateClosedMs: null,
    },
  ]);
});

afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.clickupId, CLICKUP_ID));
});

const reload = async (id: string) => {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row!;
};

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('changing a task from the board', () => {
  it('moves a mirrored task to done — in ClickUp, and here', async () => {
    const row = await seed('company');

    const result = await updateTaskAction(form({ id: row.id, status: 'done' }));

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    // The write reached ClickUp, in that list's own word for it.
    expect((await adapter.getTask(CLICKUP_ID))?.status).toBe('complete');
    expect((await reload(row.id)).status).toBe('done');
  });

  it('still writes his own tasks straight here', async () => {
    const row = await seed('mine');

    const result = await updateTaskAction(form({ id: row.id, status: 'done' }));

    expect(result.ok).toBe(true);
    expect((await reload(row.id)).status).toBe('done');

    await db.delete(tasks).where(eq(tasks.id, row.id));
  });

  /*
   * The status picker offers what the board is actually in, and the board is
   * mostly in words ClickUp's lists define. An enum here would have rejected
   * 31 of his tasks' own statuses before the write was even attempted.
   */
  it("accepts a status only this company's ClickUp list has", async () => {
    const row = await seed('company');

    const result = await updateTaskAction(form({ id: row.id, status: 'make_it_happened' }));

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect((await adapter.getTask(CLICKUP_ID))?.status).toBe('make it happened');
    expect((await reload(row.id)).status).toBe('make_it_happened');
  });

  /*
   * He does not work in ClickUp any more, so ClickUp not taking the copy it
   * keeps is news, not a failure — the task still moved.
   */
  it('saves it anyway when ClickUp will not take it, and says so', async () => {
    const row = await seed('company');
    adapter.failNext = true;

    const result = await updateTaskAction(form({ id: row.id, status: 'done' }));

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.notice).toContain('ClickUp was not updated');
    expect((await reload(row.id)).status).toBe('done');
  });
});

/**
 * Several people under the owner of a task.
 *
 * The first one ticked is the lead — the name the row sorts under, the one
 * heat scoring reads, and the one the mirror keeps — so it has to be written
 * to the task itself and not only to the join table, or the two disagree.
 */
describe('several people on one task', () => {
  const made: string[] = [];

  const someone = async (name: string) => {
    const [row] = await _db
      .insert(people)
      .values({ name, email: `${name}-${Date.now()}@test.local`.toLowerCase(), slackId: 'U1' })
      .returning();
    made.push(row!.id);
    return row!;
  };

  afterEach(async () => {
    for (const id of made) await _db.delete(people).where(eq(people.id, id));
    made.length = 0;
  });

  it('saves everyone, and makes the first of them the lead', async () => {
    const row = await seed('mine');
    const a = await someone('Alef');
    const b = await someone('Bet');

    const data = form({ id: row.id });
    data.append('assignees', b.id);
    data.append('assignees', a.id);
    const result = await updateTaskAction(data);

    expect(result.ok).toBe(true);
    expect((await assigneesOf(row.id)).map((p) => p.id)).toEqual([b.id, a.id]);
    expect((await reload(row.id)).ownerPersonId).toBe(b.id);

    await _db.delete(tasks).where(eq(tasks.id, row.id));
  });

  it('takes the last person off, and clears the lead with them', async () => {
    const row = await seed('mine');
    const a = await someone('Gimel');
    const first = form({ id: row.id });
    first.append('assignees', a.id);
    await updateTaskAction(first);

    const cleared = form({ id: row.id });
    cleared.append('assignees', '');
    const result = await updateTaskAction(cleared);

    expect(result.ok).toBe(true);
    expect(await assigneesOf(row.id)).toEqual([]);
    expect((await reload(row.id)).ownerPersonId).toBeNull();

    await _db.delete(tasks).where(eq(tasks.id, row.id));
  });

  it('leaves the people alone when the form does not carry them', async () => {
    const row = await seed('mine');
    const a = await someone('Dalet');
    const first = form({ id: row.id });
    first.append('assignees', a.id);
    await updateTaskAction(first);

    // A quick status change from the cell sends no assignees at all.
    await updateTaskAction(form({ id: row.id, status: 'in_progress' }));

    expect((await assigneesOf(row.id)).map((p) => p.id)).toEqual([a.id]);

    await _db.delete(tasks).where(eq(tasks.id, row.id));
  });
});
