import { afterEach, describe, expect, it, vi } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import { db, collaboratorLogins, people, taskAccess, taskInvites, tasks } from '@/lib/db';
import { inviteLetter } from '@/lib/tasks/invite-message';
import { setAssignees } from '@/lib/tasks/assignees';

/**
 * Letting somebody in.
 *
 * Granting access already worked and still got nobody in: a grant is half a
 * door, and the only sign-in this server has is a password provider that
 * accepts the owner address alone — Google OAuth is not configured, so that
 * button is not even drawn. The invitation is the other half.
 */
const STAMP = Date.now();
const OWNER = 'maor@adnimation.com';
const GUEST = `guest-${STAMP}@partner.example`;

// The mail goes nowhere in a test, and has to be seen to have been asked for.
const posted: { to: string; subject: string; body: string }[] = [];
vi.mock('@/lib/mail/send', () => ({
  sendMail: async (m: { to: string; subject: string; body: string }) => {
    posted.push(m);
    return { ok: true };
  },
  canReply: () => true,
}));

const { acceptInvite, inviteToTasks, openInvite, revokeInvite, verifyCollaborator } = await import(
  '@/lib/tasks/invite-service'
);

const madeTasks: string[] = [];
const madePeople: string[] = [];

afterEach(async () => {
  posted.length = 0;
  await db.delete(taskInvites).where(sql`lower(${taskInvites.email}) like ${'%@partner.example'}`);
  await db.delete(collaboratorLogins).where(sql`${collaboratorLogins.email} like ${'%@partner.example'}`);
  await db.delete(taskAccess).where(sql`lower(${taskAccess.email}) like ${'%@partner.example'}`);
  if (madeTasks.length > 0) await db.delete(tasks).where(inArray(tasks.id, madeTasks));
  if (madePeople.length > 0) await db.delete(people).where(inArray(people.id, madePeople));
  madeTasks.length = 0;
  madePeople.length = 0;
});

async function aTask(over: Partial<typeof tasks.$inferInsert> = {}) {
  const [row] = await db
    .insert(tasks)
    .values({
      layer: 'mine',
      title: 'Connect ZetaGlobal as demand',
      description: 'They want in-app inventory. Needs a seat and a rev share.',
      status: 'in_progress',
      priority: 'P1',
      dueDate: '2026-10-05',
      nextStep: 'send them the seat terms',
      source: 'manual',
      ...over,
    })
    .returning();
  madeTasks.push(row!.id);
  return row!;
}

const invite = (over: Record<string, unknown> = {}) =>
  inviteToTasks({
    email: GUEST,
    name: 'Dana',
    level: 'view',
    actor: OWNER,
    actorName: 'Maor Davidovich',
    ...over,
  });

describe('inviting somebody to the tasks board', () => {
  it('mails them a link and opens the door at the same time', async () => {
    const result = await invite();

    expect(result.ok).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.to).toBe(GUEST);
    expect(posted[0]?.body).toContain('/join/');

    // The grant is written too — a link to a door that is still locked is
    // worse than no link at all.
    const [granted] = await db
      .select()
      .from(taskAccess)
      .where(sql`lower(${taskAccess.email}) = ${GUEST}`);
    expect(granted?.level).toBe('view');
  });

  it('puts the task inside the mail when it is sent from one', async () => {
    const person = await db
      .insert(people)
      .values({ name: `Tomer${STAMP}`, email: `t-${STAMP}@test.local`, slackId: 'U1' })
      .returning();
    madePeople.push(person[0]!.id);
    const task = await aTask();
    await setAssignees(task.id, [person[0]!.id]);

    await invite({ taskId: task.id });

    const body = posted[0]?.body ?? '';
    expect(posted[0]?.subject).toContain('Connect ZetaGlobal as demand');
    expect(body).toContain('THE TASK: Connect ZetaGlobal as demand');
    expect(body).toContain('IN PROGRESS');
    expect(body).toContain('P1 — critical');
    expect(body).toContain('2026-10-05');
    expect(body).toContain('send them the seat terms');
    expect(body).toContain('They want in-app inventory');
    expect(body).toContain(`Tomer${STAMP}`);
  });

  /*
   * The star means the task is his alone. An invitation quoting one would put
   * it in somebody's inbox for good, where no amount of unstarring reaches it.
   */
  it('never quotes a starred task, and still invites them to the board', async () => {
    const task = await aTask({ isPrivate: true });

    const result = await invite({ taskId: task.id });

    expect(result.ok).toBe(true);
    expect(posted[0]?.body).not.toContain('Connect ZetaGlobal');
    expect(posted[0]?.body).not.toContain('in-app inventory');
    expect(posted[0]?.body).toContain('/join/');
  });

  it('refuses an address that is not one', async () => {
    const result = await invite({ email: 'not-an-address' });
    expect(result.ok).toBe(false);
    expect(posted).toHaveLength(0);
  });
});

describe('taking up an invitation', () => {
  async function linkFrom(over: Record<string, unknown> = {}) {
    await invite(over);
    const link = /\/join\/([a-f0-9]{64})/.exec(posted[0]?.body ?? '');
    return link?.[1] ?? '';
  }

  it('shows who invited them, and the task, before they sign anything', async () => {
    const task = await aTask();
    const token = await linkFrom({ taskId: task.id });

    const open = await openInvite(token);

    expect(open?.email).toBe(GUEST);
    expect(open?.taskTitle).toBe('Connect ZetaGlobal as demand');
    expect(open?.alreadyHasLogin).toBe(false);
  });

  it('sets a password they can then sign in with', async () => {
    const token = await linkFrom();

    const accepted = await acceptInvite({ token, name: 'Dana Levi', password: 'correct-horse-9' });

    expect(accepted.ok).toBe(true);
    const who = await verifyCollaborator(GUEST, 'correct-horse-9');
    expect(who?.name).toBe('Dana Levi');
    expect(await verifyCollaborator(GUEST, 'wrong-password-1')).toBeNull();
  });

  it('will not take a password too short to be worth having', async () => {
    const token = await linkFrom();
    const result = await acceptInvite({ token, name: 'Dana', password: 'short' });
    expect(result.ok).toBe(false);
    expect(await verifyCollaborator(GUEST, 'short')).toBeNull();
  });

  it('works once — a link forwarded on is worth nothing', async () => {
    const token = await linkFrom();
    await acceptInvite({ token, name: 'Dana', password: 'correct-horse-9' });

    expect(await openInvite(token)).toBeNull();
    const again = await acceptInvite({ token, name: 'Someone Else', password: 'another-one-11' });
    expect(again.ok).toBe(false);
    // And the password they set is untouched by the attempt.
    expect(await verifyCollaborator(GUEST, 'correct-horse-9')).not.toBeNull();
  });

  it('answers the same way for every kind of invalid link', async () => {
    // Unknown, too short, and cancelled must be indistinguishable — otherwise
    // the URL becomes a way to find out who has been invited.
    expect(await openInvite('f'.repeat(64))).toBeNull();
    expect(await openInvite('short')).toBeNull();

    await invite();
    const [row] = await db
      .select({ id: taskInvites.id })
      .from(taskInvites)
      .where(sql`lower(${taskInvites.email}) = ${GUEST}`);
    const token = /\/join\/([a-f0-9]{64})/.exec(posted[0]?.body ?? '')?.[1] ?? '';
    await revokeInvite(row!.id, OWNER);
    expect(await openInvite(token)).toBeNull();
  });

  it('stores the token as a hash, never as itself', async () => {
    const token = await linkFrom();
    const [row] = await db
      .select({ hash: taskInvites.tokenHash })
      .from(taskInvites)
      .where(sql`lower(${taskInvites.email}) = ${GUEST}`);

    expect(row?.hash).not.toBe(token);
    expect(row?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('lets him re-invite somebody who forgot their password', async () => {
    const first = await linkFrom();
    await acceptInvite({ token: first, name: 'Dana', password: 'correct-horse-9' });

    posted.length = 0;
    const second = await linkFrom();
    const reset = await acceptInvite({ token: second, name: 'Dana', password: 'a-new-one-2026' });

    expect(reset.ok).toBe(true);
    expect(await verifyCollaborator(GUEST, 'a-new-one-2026')).not.toBeNull();
    expect(await verifyCollaborator(GUEST, 'correct-horse-9')).toBeNull();
  });

  it('does not know an address that was never invited', async () => {
    expect(await verifyCollaborator('nobody@partner.example', 'whatever-1234')).toBeNull();
  });
});

/**
 * The wording itself, with nothing underneath it.
 *
 * English on purpose: the people he hands work to do not all read Hebrew, and
 * this is the one message that has to be understood by somebody who has never
 * seen the system.
 */
describe('what the invitation says', () => {
  const base = {
    inviterName: 'Maor Davidovich',
    link: 'https://cockpit.example/join/abc',
    expiresAt: new Date('2026-10-01T00:00:00Z'),
    level: 'view' as const,
  };

  it('names the task in the subject when there is one', () => {
    const letter = inviteLetter({
      ...base,
      task: {
        title: 'Connect ZetaGlobal',
        status: 'make_it_happened',
        priority: 'P1',
        dueDate: null,
        nextStep: null,
        description: null,
        people: [],
      },
    });
    expect(letter.subject).toBe('Maor Davidovich shared a task with you: Connect ZetaGlobal');
    // A ClickUp status is read out, not shown as a slug.
    expect(letter.body).toContain('MAKE IT HAPPENED');
  });

  it('falls back to the board when there is no task', () => {
    const letter = inviteLetter(base);
    expect(letter.subject).toContain('invited you to the Adnimation task board');
    expect(letter.body).toContain(base.link);
  });

  it('says what the access does and does not reach', () => {
    expect(inviteLetter(base).body).toContain('and nothing else in the system');
    expect(inviteLetter({ ...base, level: 'edit' }).body).toContain('see and update');
  });

  it('trims a description that would otherwise be the whole brief', () => {
    const letter = inviteLetter({
      ...base,
      task: {
        title: 'Long one',
        status: 'open',
        priority: 'P2',
        dueDate: null,
        nextStep: null,
        description: 'x'.repeat(2000),
        people: [],
      },
    });
    expect(letter.body).toContain('…');
    expect(letter.body.length).toBeLessThan(1500);
  });
});
