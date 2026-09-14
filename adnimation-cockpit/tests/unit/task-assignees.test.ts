import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, people, taskAssignees, taskNudges, tasks } from '@/lib/db';
import { FakeSlackAdapter } from '@/lib/integrations/slack';
import { assigneesForMany, assigneesOf, chipsFor, setAssignees } from '@/lib/tasks/assignees';
import { lastNudges, nudgeMessage, nudgeTask } from '@/lib/tasks/nudge';

/**
 * Several people on one task, and the chase that follows.
 *
 * The board carried one owner because ClickUp's first assignee was all the
 * mirror kept — so a task two people share showed one name and lost the other,
 * and "who is carrying this" was answered wrongly on every shared task.
 */
const STAMP = Date.now();
const ACTOR = 'maor@adnimation.com';

async function person(name: string, slackId: string | null) {
  const [row] = await db
    .insert(people)
    .values({ name, email: `${name.toLowerCase()}-${STAMP}@test.local`, slackId })
    .returning();
  return row!;
}

async function task(title = 'Close the seat lease') {
  const [row] = await db
    .insert(tasks)
    .values({ layer: 'mine', title, priority: 'P2', status: 'open', source: 'manual' })
    .returning();
  return row!;
}

const madePeople: string[] = [];
const madeTasks: string[] = [];

afterEach(async () => {
  if (madeTasks.length > 0) await db.delete(tasks).where(inArray(tasks.id, madeTasks));
  if (madePeople.length > 0) await db.delete(people).where(inArray(people.id, madePeople));
  madeTasks.length = 0;
  madePeople.length = 0;
});

async function scene() {
  const maor = await person(`Maor${STAMP}`, 'U-MAOR');
  const tomer = await person(`Tomer${STAMP}`, 'U-TOMER');
  const silent = await person(`Silent${STAMP}`, null);
  const t = await task();
  madePeople.push(maor.id, tomer.id, silent.id);
  madeTasks.push(t.id);
  return { maor, tomer, silent, t };
}

describe('who is on a task', () => {
  it('keeps everyone, in the order he picked them', async () => {
    const { maor, tomer, t } = await scene();

    const lead = await setAssignees(t.id, [tomer.id, maor.id]);

    expect(lead).toBe(tomer.id);
    expect((await assigneesOf(t.id)).map((p) => p.id)).toEqual([tomer.id, maor.id]);
  });

  it('drops a repeat and an empty slot rather than refusing the save', async () => {
    const { maor, tomer, t } = await scene();

    await setAssignees(t.id, ['', maor.id, maor.id, ' ', tomer.id]);

    expect((await assigneesOf(t.id)).map((p) => p.id)).toEqual([maor.id, tomer.id]);
  });

  it('ignores an id that is not a person — a stale tab must not invent one', async () => {
    const { maor, t } = await scene();

    const lead = await setAssignees(t.id, ['11111111-1111-1111-1111-111111111111', maor.id]);

    expect(lead).toBe(maor.id);
    expect((await assigneesOf(t.id)).map((p) => p.id)).toEqual([maor.id]);
  });

  it('takes the last person off', async () => {
    const { maor, t } = await scene();
    await setAssignees(t.id, [maor.id]);

    expect(await setAssignees(t.id, [])).toBeNull();
    expect(await assigneesOf(t.id)).toEqual([]);
  });

  it('fetches the whole list in one go, each task with its own people', async () => {
    const { maor, tomer, t } = await scene();
    const other = await task('Another');
    madeTasks.push(other.id);
    await setAssignees(t.id, [maor.id, tomer.id]);
    await setAssignees(other.id, [tomer.id]);

    const map = await assigneesForMany([t.id, other.id]);

    expect(map.get(t.id)?.map((p) => p.id)).toEqual([maor.id, tomer.id]);
    expect(map.get(other.id)?.map((p) => p.id)).toEqual([tomer.id]);
  });
});

/*
 * A mirrored task arrives with an owner and no row in the assignees table —
 * the ClickUp poll knows nothing about it — so an empty answer there has to
 * mean "the lead alone" rather than "nobody", or most of his board would read
 * as unassigned.
 */
describe('who to draw on the row', () => {
  it('falls back to the lead when nothing has been picked yet', () => {
    expect(chipsFor({ ownerPersonId: 'p1', ownerName: 'Mor' }, undefined)).toEqual([
      { id: 'p1', name: 'Mor' },
    ]);
    expect(chipsFor({ ownerPersonId: 'p1', ownerName: 'Mor' }, [])).toEqual([
      { id: 'p1', name: 'Mor' },
    ]);
  });

  it('prefers what he picked over the lead', () => {
    expect(
      chipsFor({ ownerPersonId: 'p1', ownerName: 'Mor' }, [
        { id: 'p2', name: 'Tomer' },
        { id: 'p1', name: 'Mor' },
      ]),
    ).toEqual([
      { id: 'p2', name: 'Tomer' },
      { id: 'p1', name: 'Mor' },
    ]);
  });

  it('says nobody when there is nobody', () => {
    expect(chipsFor({ ownerPersonId: null, ownerName: null }, [])).toEqual([]);
  });
});

describe('asking what is happening with it', () => {
  it('sends each person their own message, not one to the group', async () => {
    const { maor, tomer, t } = await scene();
    await setAssignees(t.id, [maor.id, tomer.id]);
    const slack = new FakeSlackAdapter();

    const result = await nudgeTask(t.id, ACTOR, null, { slack });

    expect(result.sent.every((s) => s.ok)).toBe(true);
    expect(slack.sent).toHaveLength(2);
    // Two direct messages, one per person — never a group conversation.
    expect(slack.sent.map((m) => m.target).sort()).toEqual(['U-MAOR', 'U-TOMER']);
    for (const message of slack.sent) expect(message.text).toContain('מה קורה עם זה?');
  });

  it('writes it in his name when it is the bot carrying it', async () => {
    const { maor, t } = await scene();
    await setAssignees(t.id, [maor.id]);
    const slack = new FakeSlackAdapter();

    await nudgeTask(t.id, ACTOR, null, {
      slack,
      asHimself: false,
      sender: { name: 'Maor Davidovich', iconUrl: 'https://slack.test/avatar.png' },
    });

    expect(slack.sent[0]?.username).toBe('Maor Davidovich');
    expect(slack.sent[0]?.iconUrl).toBe('https://slack.test/avatar.png');
  });

  it('leaves the identity alone when the message really is from him', async () => {
    const { maor, t } = await scene();
    await setAssignees(t.id, [maor.id]);
    const slack = new FakeSlackAdapter();

    await nudgeTask(t.id, ACTOR, null, { slack, asHimself: true, sender: { name: 'Maor' } });

    // His own token is already him; a username on a user post is not honoured.
    expect(slack.sent[0]?.username).toBeUndefined();
  });

  it('carries the line he added under the question', async () => {
    expect(nudgeMessage('Seat lease', 'ראיתי שזה תקוע מול Gravite')).toContain(
      'ראיתי שזה תקוע מול Gravite',
    );
    expect(nudgeMessage('Seat lease', null)).toContain('מה קורה עם זה?');
  });

  it('records who could not be reached instead of reporting it sent', async () => {
    const { maor, silent, t } = await scene();
    await setAssignees(t.id, [maor.id, silent.id]);
    const slack = new FakeSlackAdapter();

    const result = await nudgeTask(t.id, ACTOR, null, { slack });

    expect(slack.sent).toHaveLength(1);
    expect(result.sent.find((s) => s.personId === silent.id)?.ok).toBe(false);
    expect(result.sent.find((s) => s.personId === silent.id)?.error).toBe('no_slack_id');

    const stored = await db.select().from(taskNudges).where(eq(taskNudges.taskId, t.id));
    expect(stored).toHaveLength(2);
    expect(stored.filter((r) => r.delivered)).toHaveLength(1);
  });

  it('remembers when he last asked, so he does not ask twice on the same day', async () => {
    const { maor, tomer, t } = await scene();
    await setAssignees(t.id, [maor.id, tomer.id]);
    const slack = new FakeSlackAdapter();
    await nudgeTask(t.id, ACTOR, null, { slack });

    const mark = (await lastNudges([t.id])).get(t.id);

    expect(mark).toBeDefined();
    expect(mark?.names).toHaveLength(2);
    expect(mark?.delivered).toBe(true);
    expect(Date.now() - (mark?.sentAt.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it('has nothing to say about a task he has never chased', async () => {
    const { t } = await scene();
    expect((await lastNudges([t.id])).get(t.id)).toBeUndefined();
  });
});

// Cleans up the join rows the cascade does not reach in the fixture order.
afterEach(async () => {
  if (madeTasks.length > 0) {
    await db.delete(taskAssignees).where(inArray(taskAssignees.taskId, madeTasks));
  }
});
