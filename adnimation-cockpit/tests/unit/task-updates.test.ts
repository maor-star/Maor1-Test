import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, people, taskComments, taskNudges, tasks } from '@/lib/db';
import { FakeSlackAdapter } from '@/lib/integrations/slack';
import { setAssignees } from '@/lib/tasks/assignees';
import { notifyUpdate, updateMessage } from '@/lib/tasks/nudge';
import { updatesForMany, updatesFor } from '@/lib/tasks/updates';
import { authorLabel } from '@/lib/tasks/update-shape';
import { addComment } from '@/lib/tasks/mutations';

/**
 * Writing down what happened.
 *
 * The updates existed, on the task's own page — the one place he is not when
 * he thinks of one. Writing a line cost a trip off the board and back, so the
 * board never showed them and he never wrote them.
 */
const STAMP = Date.now();
const ACTOR = `maor-${STAMP}@test.local`;
const OUTSIDER = `chief-${STAMP}@test.local`;

const madeTasks: string[] = [];
const madePeople: string[] = [];

afterEach(async () => {
  if (madeTasks.length > 0) await db.delete(tasks).where(inArray(tasks.id, madeTasks));
  if (madePeople.length > 0) await db.delete(people).where(inArray(people.id, madePeople));
  madeTasks.length = 0;
  madePeople.length = 0;
});

async function aTask(title = 'Close the seat lease') {
  const [row] = await db
    .insert(tasks)
    .values({ layer: 'mine', title, priority: 'P2', status: 'open', source: 'manual' })
    .returning();
  madeTasks.push(row!.id);
  return row!;
}

async function aPerson(name: string, slackId: string | null, email?: string) {
  const [row] = await db
    .insert(people)
    .values({ name, email: email ?? `${name.toLowerCase()}-${STAMP}@test.local`, slackId })
    .returning();
  madePeople.push(row!.id);
  return row!;
}

describe('the updates on a task', () => {
  it('reads newest first on the board, and oldest first on the page', async () => {
    const t = await aTask();
    await addComment(t.id, 'first thing', ACTOR);
    await new Promise((r) => setTimeout(r, 5));
    await addComment(t.id, 'second thing', ACTOR);

    const board = (await updatesForMany([t.id])).get(t.id);
    expect(board?.latest.map((u) => u.body)).toEqual(['second thing', 'first thing']);

    // A page is a history and reads forwards.
    expect((await updatesFor(t.id)).map((u) => u.body)).toEqual(['first thing', 'second thing']);
  });

  it('caps what the panel carries, and says how many there are in all', async () => {
    const t = await aTask();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await addComment(t.id, `update ${n}`, ACTOR);
      await new Promise((r) => setTimeout(r, 2));
    }

    const trail = (await updatesForMany([t.id], 4)).get(t.id);

    expect(trail?.latest).toHaveLength(4);
    expect(trail?.total).toBe(6);
    expect(trail?.latest[0]?.body).toBe('update 6');
  });

  it('keeps each task to its own, in one query', async () => {
    const a = await aTask('A');
    const b = await aTask('B');
    await addComment(a.id, 'about A', ACTOR);
    await addComment(b.id, 'about B', ACTOR);

    const map = await updatesForMany([a.id, b.id]);

    expect(map.get(a.id)?.latest.map((u) => u.body)).toEqual(['about A']);
    expect(map.get(b.id)?.latest.map((u) => u.body)).toEqual(['about B']);
  });

  it('has nothing to say about a task nobody has written on', async () => {
    const t = await aTask();
    expect((await updatesForMany([t.id])).get(t.id)).toBeUndefined();
  });

  it('signs an update with a name when it knows one, and a handle when it does not', () => {
    const roster = [{ email: 'mor@adnimation.com', name: 'Mor Azagury' }];
    expect(authorLabel('mor@adnimation.com', roster)).toBe('Mor Azagury');
    expect(authorLabel('MOR@adnimation.com', roster)).toBe('Mor Azagury');
    expect(authorLabel('someone@elsewhere.com', roster)).toBe('someone');
  });
});

/**
 * Writing it down and telling them are two different acts — the note is saved
 * either way, and the tick decides whether it also leaves the building.
 */
describe('passing an update on', () => {
  it('reaches everyone on the task except the person writing it', async () => {
    const t = await aTask();
    const maor = await aPerson(`Maor${STAMP}`, 'U-MAOR', ACTOR);
    const tomer = await aPerson(`Tomer${STAMP}`, 'U-TOMER');
    await setAssignees(t.id, [maor.id, tomer.id]);
    const slack = new FakeSlackAdapter();

    const told = await notifyUpdate(t.id, 'ה־seat אושר, מחכים לחוזה', ACTOR, { slack });

    expect(slack.sent.map((m) => m.target)).toEqual(['U-TOMER']);
    expect(slack.sent[0]?.text).toContain('ה־seat אושר');
    expect(slack.sent[0]?.text).toContain('Close the seat lease');
    expect(told).toHaveLength(1);

    await db.delete(taskNudges).where(eq(taskNudges.taskId, t.id));
  });

  it('says nothing about a starred task', async () => {
    const t = await aTask();
    await db.update(tasks).set({ isPrivate: true }).where(eq(tasks.id, t.id));
    const tomer = await aPerson(`Tomer${STAMP}`, 'U-TOMER');
    await setAssignees(t.id, [tomer.id]);
    const slack = new FakeSlackAdapter();

    expect(await notifyUpdate(t.id, 'anything', OUTSIDER, { slack })).toEqual([]);
    expect(slack.sent).toHaveLength(0);
  });

  it('has nobody to tell on a task nobody is on', async () => {
    const t = await aTask();
    const slack = new FakeSlackAdapter();
    expect(await notifyUpdate(t.id, 'anything', OUTSIDER, { slack })).toEqual([]);
  });

  it('carries the task and the note, and signs off as him', () => {
    const text = updateMessage('Seat lease', 'אושר', 'https://cockpit.example/tasks/1');
    expect(text).toContain('*Seat lease*');
    expect(text).toContain('אושר');
    expect(text).toContain('https://cockpit.example/tasks/1');
    expect(text.trimEnd().endsWith('מאור')).toBe(true);
  });
});

// The comments cascade with the task; the nudge rows do not always.
afterEach(async () => {
  if (madeTasks.length > 0) {
    await db.delete(taskComments).where(inArray(taskComments.taskId, madeTasks));
  }
});
