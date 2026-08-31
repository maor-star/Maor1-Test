import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, tasks } from '@/lib/db';
import { FakeClickUpAdapter } from '@/lib/integrations/clickup';
import { editMirroredTask } from '@/lib/tasks/clickup-edit';
import { purgeFinishedMirror, removeFinished, syncSingleTask } from '@/lib/sync/clickup-mirror';

/**
 * Editing a task the team owns.
 *
 * Two ways this goes wrong and both are worse than the read-only screen it
 * replaces: the cockpit showing an edit ClickUp never accepted, so he thinks
 * the team has been told; and the sync quietly reverting what he set, five
 * minutes later, with nothing on screen to say it happened.
 */
const CLICKUP_ID = `cu-${Date.now()}`;
const ACTOR = 'maor@adnimation.com';

async function seed(over: Partial<typeof tasks.$inferInsert> = {}) {
  const [row] = await db
    .insert(tasks)
    .values({
      layer: 'company',
      clickupId: CLICKUP_ID,
      clickupUrl: `https://clickup.test/t/${CLICKUP_ID}`,
      title: 'Ship the bidder integration',
      description: 'as agreed',
      priority: 'P2',
      status: 'open',
      dueDate: '2026-09-30',
      tags: ['clickup-tag'],
      source: 'manual',
      ...over,
    })
    .returning();
  return row!;
}

function adapterWith() {
  const adapter = new FakeClickUpAdapter();
  adapter.seed([
    {
      id: CLICKUP_ID,
      name: 'Ship the bidder integration',
      description: 'as agreed',
      status: 'to do',
      priority: 3,
      dueDateMs: null,
      startDateMs: null,
      parentId: null,
      assigneeEmails: [],
      tags: [],
      url: `https://clickup.test/t/${CLICKUP_ID}`,
      updatedAtMs: Date.now(),
      listId: 'l1',
      listName: 'Dev',
      dateClosedMs: null,
    },
  ]);
  return adapter;
}

afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.clickupId, CLICKUP_ID));
});

const reload = async (id: string) => {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row!;
};

describe('editing a mirrored ClickUp task', () => {
  it('writes what ClickUp owns to ClickUp, and mirrors it here', async () => {
    const row = await seed();
    const adapter = adapterWith();

    const result = await editMirroredTask(
      row.id,
      { title: 'Ship it this week', priority: 'P0', dueDate: '2026-10-05' },
      ACTOR,
      adapter,
    );

    expect(result.ok).toBe(true);
    expect(adapter.updates).toHaveLength(1);
    expect(adapter.updates[0]?.patch.name).toBe('Ship it this week');
    // P0 is ClickUp's "urgent", which is 1.
    expect(adapter.updates[0]?.patch.priority).toBe(1);

    const after = await reload(row.id);
    expect(after.title).toBe('Ship it this week');
    expect(after.priority).toBe('P0');
    expect(after.dueDate).toBe('2026-10-05');
  });

  it('changes nothing here when ClickUp refuses', async () => {
    const row = await seed();
    const adapter = adapterWith();
    adapter.failNextUpdate = true;

    const result = await editMirroredTask(row.id, { title: 'Renamed' }, ACTOR, adapter);

    expect(result.ok).toBe(false);
    // The whole point: he must not believe the team was told.
    expect((await reload(row.id)).title).toBe('Ship the bidder integration');
  });

  it('sends only what changed', async () => {
    const row = await seed();
    const adapter = adapterWith();

    await editMirroredTask(
      row.id,
      { title: 'Ship the bidder integration', priority: 'P0' },
      ACTOR,
      adapter,
    );

    expect(adapter.updates[0]?.patch.name).toBeUndefined();
    expect(adapter.updates[0]?.patch.priority).toBe(1);
  });

  it('keeps his own fields here, and pins them against the next sync', async () => {
    const row = await seed();
    const adapter = adapterWith();

    await editMirroredTask(row.id, { tags: ['mine'], moneyImpactCents: 250000 }, ACTOR, adapter);

    const after = await reload(row.id);
    expect(after.tags).toEqual(['mine']);
    expect(after.moneyImpactCents).toBe(250000);
    expect(after.pinnedFields).toContain('tags');
    // Nothing ClickUp owns changed, so nothing was sent.
    expect(adapter.updates).toHaveLength(0);
  });

  it('refuses a task that is not mirrored', async () => {
    const row = await seed({ layer: 'mine', clickupId: null, clickupUrl: null });
    const result = await editMirroredTask(row.id, { title: 'x' }, ACTOR, adapterWith());
    expect(result.ok).toBe(false);
    await db.delete(tasks).where(eq(tasks.id, row.id));
  });
});

describe('closing a mirrored task', () => {
  it('keeps the row so it can be reopened, rather than deleting it', async () => {
    const row = await seed();

    const closed = await removeFinished([CLICKUP_ID]);
    expect(closed).toBe(1);

    const after = await reload(row.id);
    expect(after.status).toBe('done');
  });

  it('leaves a recently finished task alone, and clears an old one', async () => {
    const row = await seed({ status: 'done' });
    await db
      .update(tasks)
      .set({ updatedAt: new Date() })
      .where(eq(tasks.id, row.id));

    expect(await purgeFinishedMirror(30)).toBe(0);

    await db
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 60 * 24 * 3600_000) })
      .where(eq(tasks.id, row.id));
    expect(await purgeFinishedMirror(30)).toBe(1);
  });
});

describe('the sync, over a task he has taken over', () => {
  it('updates what ClickUp owns and leaves what he set alone', async () => {
    const row = await seed({ tags: ['his-tag'], pinnedFields: ['tags'] });
    const adapter = adapterWith();

    // ClickUp's copy has a different title and different tags.
    await adapter.updateTask(CLICKUP_ID, { name: 'Renamed in ClickUp' });
    const outcome = await syncSingleTask(adapter, CLICKUP_ID);
    expect(outcome).toBe('upserted');

    const after = await reload(row.id);
    expect(after.title).toBe('Renamed in ClickUp');
    // The tags are his now; the poll must not have reverted them.
    expect(after.tags).toEqual(['his-tag']);
    expect(after.pinnedFields).toEqual(['tags']);
  });

  it('still overwrites a field he has not taken over', async () => {
    const row = await seed({ tags: ['stale'] });
    const adapter = adapterWith();

    await syncSingleTask(adapter, CLICKUP_ID);

    // ClickUp's task carries no tags, so the mirror's copy goes.
    expect((await reload(row.id)).tags).toEqual([]);
  });
});
