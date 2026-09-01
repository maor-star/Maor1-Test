import { beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog, db, tasks } from '@/lib/db';
import { completeTask, createTask, updateTask } from '@/lib/tasks/mutations';
import { isUndoable, lastUndoableFor, restorableSnapshot, undoAudit } from '@/lib/undo';

/**
 * Undo, as a general mechanism.
 *
 * The point of building it on the audit log rather than on per-action inverses
 * is that a screen nobody has thought about yet is undoable the day it ships.
 * So the tests here are about the rules, not about tasks: tasks are simply the
 * cheapest row to move around while checking them.
 */

const ACTOR = `undo-test-${Date.now().toString(36)}@adnimation.com`;

let taskId: string;

beforeAll(async () => {
  const row = await createTask(
    {
      title: 'Undo test task',
      priority: 'P2',
      status: 'open',
      tags: [],
      blockedPeople: [],
      source: 'manual',
    },
    ACTOR,
  );
  taskId = row.id;
});

const current = async () => {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return row!;
};

const lastAuditId = async () => {
  const [row] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'task'), eq(auditLog.entityId, taskId)))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return row!.id;
};

describe('what undo will touch', () => {
  it('keeps only the columns it is allowed to write', () => {
    const snapshot = restorableSnapshot('task', {
      title: 'A', status: 'open', heatScore: 40, createdBy: 'someone',
    });
    expect(snapshot).toEqual({ title: 'A', status: 'open' });
  });

  it('says nothing is undoable for an entity it does not know', () => {
    expect(isUndoable('revenue_day', { amountCents: 1 })).toBe(false);
  });

  it('says nothing is undoable when the audit row recorded no before', () => {
    expect(isUndoable('task', null)).toBe(false);
    expect(isUndoable('task', {})).toBe(false);
  });

  it('is undoable when the before holds at least one restorable field', () => {
    expect(isUndoable('task', { status: 'open', heatScore: 9 })).toBe(true);
  });
});

describe('putting the last change back', () => {
  it('restores the fields the audit row recorded', async () => {
    await updateTask({ id: taskId, title: 'Renamed by the test', priority: 'P0' }, ACTOR);
    expect((await current()).title).toBe('Renamed by the test');

    const result = await undoAudit(await lastAuditId(), ACTOR);
    expect(result.ok).toBe(true);

    const back = await current();
    expect(back.title).toBe('Undo test task');
    expect(back.priority).toBe('P2');
  });

  it('audits itself, so an undo is as traceable as what it undid', async () => {
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'task'), eq(auditLog.entityId, taskId)))
      .orderBy(desc(auditLog.id))
      .limit(1);

    expect(entry?.action).toBe('task.update.undo');
    expect(entry?.actor).toBe(ACTOR);
  });

  it('can be undone in turn — the undo row puts the change back', async () => {
    const result = await undoAudit(await lastAuditId(), ACTOR);
    expect(result.ok).toBe(true);
    expect((await current()).title).toBe('Renamed by the test');
  });

  it('refuses when something else has changed the row since', async () => {
    await updateTask({ id: taskId, title: 'First' }, ACTOR);
    const stale = await lastAuditId();
    await updateTask({ id: taskId, title: 'Second' }, ACTOR);

    const result = await undoAudit(stale, ACTOR);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/changed since/i);
    // And it changed nothing while refusing.
    expect((await current()).title).toBe('Second');
  });

  it('puts back a closed task, which records only its status', async () => {
    await updateTask({ id: taskId, status: 'open' }, ACTOR);
    await completeTask(taskId, ACTOR);
    expect((await current()).status).toBe('done');

    const result = await undoAudit(await lastAuditId(), ACTOR);
    expect(result.ok).toBe(true);
    expect(result.restored).toEqual(['status']);
    expect((await current()).status).toBe('open');
  });

  it('has nothing to offer for an audit id that does not exist', async () => {
    const result = await undoAudit(-1, ACTOR);
    expect(result.ok).toBe(false);
  });
});

describe('finding the change to offer', () => {
  it('offers the last change this actor made', async () => {
    await updateTask({ id: taskId, title: 'Offered' }, ACTOR);
    const offer = await lastUndoableFor(ACTOR);
    expect(offer?.entityId).toBe(taskId);
    expect(offer?.action).toBe('task.update');
  });

  it('offers nothing to an actor who has changed nothing', async () => {
    expect(await lastUndoableFor('nobody@adnimation.com')).toBeNull();
  });

  it('offers nothing once the change is older than the window', async () => {
    expect(await lastUndoableFor(ACTOR, 0)).toBeNull();
  });
});
