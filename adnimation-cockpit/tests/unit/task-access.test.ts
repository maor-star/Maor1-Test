import { describe, expect, it } from 'vitest';
import {
  canEditTask, canManageAccess, canSeePrivate, canSeeTask, isAccountHolder,
  mayReach, normaliseEmail, roleFor, type Viewer,
} from '@/lib/tasks/access';

/**
 * Who may see which tasks.
 *
 * He asked to open the tasks board to other people while keeping some tasks to
 * himself. These are the decisions behind that, and they are the ones that
 * must not be wrong: a private task that turned out not to be private cannot
 * be made private again after somebody has read it.
 */

const owner: Viewer = { email: 'maor@adnimation.com', role: 'owner' };
const operator: Viewer = { email: 'cos@adnimation.com', role: 'operator' };
const guestView: Viewer = { email: 'assaf@adnimation.com', role: 'collaborator', level: 'view' };
const guestEdit: Viewer = { email: 'tomer@adnimation.com', role: 'collaborator', level: 'edit' };

const shared = { isPrivate: false };
const starred = { isPrivate: true };

describe('a starred task', () => {
  it('is his and nobody else’s', () => {
    expect(canSeeTask(starred, owner)).toBe(true);
    expect(canSeeTask(starred, guestView)).toBe(false);
    expect(canSeeTask(starred, guestEdit)).toBe(false);
  });

  it('is hidden from the chief of staff too', () => {
    // "So that only I see it" — the strict reading, deliberately. Widening it
    // later is a word; a task that turned out not to be private is not
    // recoverable.
    expect(canSeeTask(starred, operator)).toBe(false);
    expect(canSeePrivate(operator)).toBe(false);
  });

  it('cannot be edited by somebody who cannot see it', () => {
    // An id typed into a form must not be a way around the list.
    expect(canEditTask(starred, guestEdit)).toBe(false);
    expect(canEditTask(starred, operator)).toBe(false);
    expect(canEditTask(starred, owner)).toBe(true);
  });
});

describe('a task that is not starred', () => {
  it('is visible to everybody who was let in', () => {
    for (const v of [owner, operator, guestView, guestEdit]) {
      expect(canSeeTask(shared, v)).toBe(true);
    }
  });

  it('is only editable by a guest he gave edit to', () => {
    expect(canEditTask(shared, guestView)).toBe(false);
    expect(canEditTask(shared, guestEdit)).toBe(true);
    expect(canEditTask(shared, operator)).toBe(true);
  });
});

/**
 * The part that would do real damage if it were wrong: a grant is for the
 * tasks board, and letting somebody see a task list must not hand them the
 * revenue, the P&L, the contracts, the mail or the pipeline.
 */
describe('what a guest can reach', () => {
  it('is the tasks board', () => {
    expect(mayReach('/tasks', guestView)).toBe(true);
    expect(mayReach('/tasks/abc-123', guestView)).toBe(true);
  });

  it('is not the rest of the cockpit', () => {
    for (const page of ['/', '/revenue', '/contracts', '/mail', '/pipeline', '/crm', '/settings', '/agents', '/copilot', '/delegations', '/trading', '/seats/demand']) {
      expect(mayReach(page, guestView)).toBe(false);
      expect(mayReach(page, guestEdit)).toBe(false);
    }
  });

  it('is not a path that merely starts with the same letters', () => {
    // A prefix check would let /tasksomething and /tasks-secret through.
    expect(mayReach('/tasks-secret', guestView)).toBe(false);
    expect(mayReach('/tasksomething', guestView)).toBe(false);
    expect(mayReach('/tasksettings', guestView)).toBe(false);
  });

  it('is everything, for the two real accounts', () => {
    for (const page of ['/', '/revenue', '/contracts', '/settings']) {
      expect(mayReach(page, owner)).toBe(true);
      expect(mayReach(page, operator)).toBe(true);
    }
  });
});

describe('who keeps the guest list', () => {
  it('is him alone', () => {
    expect(canManageAccess(owner)).toBe(true);
    expect(canManageAccess(operator)).toBe(false);
    expect(canManageAccess(guestEdit)).toBe(false);
  });

  it('tells an account from a guest', () => {
    expect(isAccountHolder(owner)).toBe(true);
    expect(isAccountHolder(operator)).toBe(true);
    expect(isAccountHolder(guestView)).toBe(false);
  });
});

describe('what role an address gets', () => {
  it('is a guest when there is a live grant and no account', () => {
    const v = roleFor('assaf@adnimation.com', null, { level: 'edit' });
    expect(v).toEqual({ email: 'assaf@adnimation.com', role: 'collaborator', level: 'edit' });
  });

  it('is nothing at all when there is neither', () => {
    // The old code fell back to 'operator' for any address that reached it,
    // which was safe while only two addresses could ever sign in and is not
    // safe now.
    expect(roleFor('stranger@example.com', null, null)).toBe(null);
  });

  it('never demotes an account holder because a grant row exists', () => {
    // A grant to his own address must not take away the rest of his cockpit.
    const v = roleFor('maor@adnimation.com', 'owner', { level: 'view' });
    expect(v?.role).toBe('owner');
  });

  it('compares addresses one way, however they were typed', () => {
    expect(normaliseEmail('  Assaf@Adnimation.COM ')).toBe('assaf@adnimation.com');
    expect(roleFor('MAOR@ADNIMATION.COM', 'owner', null)?.email).toBe('maor@adnimation.com');
  });
});
