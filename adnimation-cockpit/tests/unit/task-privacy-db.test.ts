import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, tasks, taskAccess } from '@/lib/db';
import { getSubtasks, getTask, listTasks, burningToday } from '@/lib/tasks/queries';
import { grantAccess, grantFor, listGrants, revokeAccess } from '@/lib/tasks/access-service';

/**
 * A starred task never leaves the database for anybody but him.
 *
 * The rules are tested next door against plain objects. This is the other
 * half, and the half that actually protects anything: that the QUERIES apply
 * them, so a private task never reaches a page that then decides not to draw
 * it. One forgotten filter in a component, one JSON payload, one search index,
 * and it is out.
 */

const MARK = `priv-${Date.now()}`;
const made: string[] = [];
const grantedTo = `${MARK}@example.com`;

afterEach(async () => {
  if (made.length) await db.delete(tasks).where(inArray(tasks.id, made));
  made.length = 0;
  await db.delete(taskAccess).where(eq(taskAccess.email, grantedTo));
});

async function seed(title: string, isPrivate: boolean, over: Partial<typeof tasks.$inferInsert> = {}) {
  const [row] = await db
    .insert(tasks)
    .values({ title, layer: 'mine', status: 'open', priority: 'P2', isPrivate, ...over })
    .returning({ id: tasks.id });
  made.push(row!.id);
  return row!.id;
}

describe('the list', () => {
  it('leaves a starred task out unless the asker is him', async () => {
    const secret = await seed(`${MARK} secret`, true);
    const open = await seed(`${MARK} open`, false);

    const asGuest = await listTasks({ search: MARK });
    expect(asGuest.map((t) => t.id)).toEqual([open]);

    const asOwner = await listTasks({ search: MARK, canSeePrivate: true });
    expect(asOwner.map((t) => t.id).sort()).toEqual([open, secret].sort());
  });

  it('hides it by default, so a caller that says nothing gets the safe answer', async () => {
    // Every job, every agent and every screen that has not been told who is
    // asking lands here. The default has to be the strict one.
    await seed(`${MARK} secret`, true);
    expect((await listTasks({ search: MARK })).length).toBe(0);
  });
});

describe('the ways in that are not the list', () => {
  it('404s a starred task asked for by id', async () => {
    // `/tasks/<id>` typed into the address bar reaches getTask directly, so
    // the filter on the list would be a curtain rather than a wall.
    const secret = await seed(`${MARK} secret`, true);
    expect(await getTask(secret)).toBeNull();
    expect((await getTask(secret, true))?.id).toBe(secret);
  });

  it('does not surface one as a subtask of something shared', async () => {
    const parent = await seed(`${MARK} parent`, false);
    const child = await seed(`${MARK} child`, true, { parentId: parent });
    expect((await getSubtasks(parent)).map((t) => t.id)).toEqual([]);
    expect((await getSubtasks(parent, true)).map((t) => t.id)).toEqual([child]);
  });

  it('keeps one out of the burning strip and the brief behind it', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await seed(`${MARK} burning`, true, { priority: 'P0', dueDate: today });
    const shown = await burningToday(today, 50);
    expect(shown.rows.some((t) => t.title.includes(MARK))).toBe(false);
    const his = await burningToday(today, 50, true);
    expect(his.rows.some((t) => t.title.includes(MARK))).toBe(true);
  });
});

describe('the guest list', () => {
  it('lets somebody in, and says at what level', async () => {
    await grantAccess(grantedTo, 'edit', 'maor@adnimation.com');
    expect(await grantFor(grantedTo)).toEqual({ level: 'edit' });
    expect((await listGrants()).some((g) => g.email === grantedTo)).toBe(true);
  });

  it('moves an existing grant rather than adding a second one', async () => {
    // Two live rows for one person would leave the sign-in gate reading
    // whichever came back first.
    await grantAccess(grantedTo, 'view', 'maor@adnimation.com');
    await grantAccess(grantedTo, 'edit', 'maor@adnimation.com');
    expect((await listGrants()).filter((g) => g.email === grantedTo)).toHaveLength(1);
    expect(await grantFor(grantedTo)).toEqual({ level: 'edit' });
  });

  it('closes the door on revoke, and keeps the record that it was open', async () => {
    await grantAccess(grantedTo, 'view', 'maor@adnimation.com');
    await revokeAccess(grantedTo, 'maor@adnimation.com');

    expect(await grantFor(grantedTo)).toBeNull();
    expect((await listGrants()).some((g) => g.email === grantedTo)).toBe(false);

    // Revoked, not deleted (CLAUDE.md §2).
    const rows = await db.select().from(taskAccess).where(eq(taskAccess.email, grantedTo));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).not.toBeNull();
  });

  it('reads an address the same however it was typed', async () => {
    await grantAccess('  MiXeD@Example.COM ', 'view', 'maor@adnimation.com');
    expect(await grantFor('mixed@example.com')).toEqual({ level: 'view' });
    await db.delete(taskAccess).where(eq(taskAccess.email, 'mixed@example.com'));
  });

  it('refuses something that is not an address', async () => {
    const result = await grantAccess('not-an-email', 'view', 'maor@adnimation.com');
    expect(result.ok).toBe(false);
  });
});
