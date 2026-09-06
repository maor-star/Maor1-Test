import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, delegations, people, tasks } from '@/lib/db';
import { delegate } from '@/lib/delegation/service';
import { handoverTitle } from '@/lib/delegation/rules';
import type { SlackAdapter } from '@/lib/integrations/types';

/**
 * What a hand-over actually stores.
 *
 * He delegated a task to a colleague and asked where he could see it had gone
 * out. It had — the Slack message was fine — but the row behind it carried no
 * title at all. The title was built here, put in the message and written to
 * the audit trail, and then left out of the row itself.
 *
 * The screen hid it: a delegation made from a task falls back to the task's
 * own title, so it read correctly while the record was empty. That fallback is
 * why this went unnoticed, and it is exactly the kind of thing that surfaces
 * months later when the task is renamed or archived and the hand-over suddenly
 * says "Untitled".
 */

const MARK = `deleg-test-${Date.now()}`;
let madeTaskId: string | null = null;
let madePersonId: string | null = null;

afterEach(async () => {
  if (madeTaskId) {
    await db.delete(delegations).where(eq(delegations.taskId, madeTaskId));
    await db.delete(tasks).where(eq(tasks.id, madeTaskId));
    madeTaskId = null;
  }
  if (madePersonId) {
    await db.delete(people).where(eq(people.id, madePersonId));
    madePersonId = null;
  }
});

/** Slack that always accepts, and reports where the message landed. */
const slack = {
  postMessage: async () => ({
    ok: true as const,
    messageUrl: 'https://slack.com/archives/D123/p1788640763076759',
    channelId: 'D123',
    ts: '1788640763.076759',
  }),
} as unknown as SlackAdapter;

const clickup = {} as never;

async function seed() {
  const [person] = await db
    .insert(people)
    .values({ name: 'Assaf Test', email: `${MARK}@slack.local`, slackId: 'U0Y3M6LFM' })
    .returning({ id: people.id });
  madePersonId = person!.id;

  const [task] = await db
    .insert(tasks)
    .values({ title: 'לבחור שרת פרסומות ל סי טי וי', status: 'open', priority: 'P2', layer: 'mine' })
    .returning({ id: tasks.id });
  madeTaskId = task!.id;

  return { personId: person!.id, taskId: task!.id };
}

async function handOver() {
  const { personId, taskId } = await seed();
  await delegate(
    {
      sourceEntityType: 'task',
      sourceEntityId: taskId,
      delegatedTo: personId,
      title: 'לבחור שרת פרסומות ל סי טי וי',
      note: 'צריך ממך החלטה לגבי זה',
      dueDate: null,
      priority: 'P1',
      clickupListId: 'unused',
    },
    { slack, clickup, actor: 'maor@adnimation.com' },
  );

  const [row] = await db.select().from(delegations).where(eq(delegations.taskId, taskId));
  return row!;
}

describe('the row a hand-over leaves behind', () => {
  it('stores the title, in his words', async () => {
    const row = await handOver();
    expect(row.title).toBe(handoverTitle('לבחור שרת פרסומות ל סי טי וי'));
    expect(row.title).toContain('מחכה לעדכון בנושא');
  });

  it('never stores a null title', async () => {
    // The actual defect: the column was left out of the insert entirely, so
    // every hand-over made from a task wrote a null and the screen quietly
    // borrowed the task's title instead.
    const row = await handOver();
    expect(row.title).not.toBeNull();
    expect(row.title?.trim()).not.toBe('');
  });

  it('keeps the priority he chose', async () => {
    // Also missing, and it decides how the delegations screen sorts.
    const row = await handOver();
    expect(row.priority).toBe('P1');
  });

  it('records where the message landed, not just its link', async () => {
    // The reply watcher reads the thread from these. Without them it has to
    // pick them back out of the permalink, which only works when Slack
    // returned one.
    const row = await handOver();
    expect(row.slackChannelId).toBe('D123');
    expect(row.slackThreadTs).toBe('1788640763.076759');
  });

  it('keeps his note as he typed it', async () => {
    const row = await handOver();
    expect(row.note).toBe('צריך ממך החלטה לגבי זה');
  });
});
