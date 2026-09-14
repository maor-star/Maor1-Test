import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, collaboratorLogins, people, taskInvites, tasks } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/password';
import { sendMail } from '@/lib/mail/send';
import { normaliseEmail, type AccessLevel } from '@/lib/tasks/access';
import { grantAccess } from '@/lib/tasks/access-service';
import { assigneesOf } from '@/lib/tasks/assignees';
import { inviteLetter, type InviteTask } from '@/lib/tasks/invite-message';

/**
 * Inviting somebody in, and letting them build their own way through the door.
 *
 * The grant was never the problem — it stored fine and the middleware honoured
 * it. The problem was that the cockpit has exactly one working sign-in, the
 * password provider, and it accepts the owner address and nothing else; Google
 * OAuth is not configured on this server, so that button is not even drawn. A
 * colleague he granted access to had a valid grant, a valid role, and no way
 * on earth to obtain a session.
 *
 * So the invitation IS the sign-up: a one-time link in a mail, a password they
 * choose behind it, and from then on they sign in like anybody else. The grant
 * still decides what they see, and it is re-read on every sign-in, so taking
 * it back locks them out the same minute.
 */

/** Long enough that guessing is not a strategy. */
const TOKEN_BYTES = 32;
// Shared with the sign-up form, which cannot import this module — see
// lib/tasks/invite-limits.ts.
export { INVITE_DAYS, MIN_PASSWORD } from './invite-limits';
import { INVITE_DAYS, MIN_PASSWORD } from './invite-limits';

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Only the hash is stored — the raw token exists in the mail and nowhere else. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

function newToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * Where the link points.
 *
 * A wrong base here sends every invitation to a page that does not exist, so
 * it is read from the deployment's own configuration rather than guessed, and
 * refuses rather than inventing localhost.
 */
export function inviteBase(): string | null {
  const raw =
    process.env.APP_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? null;
  if (!raw) return null;
  return raw.replace(/\/+$/, '').replace(/\/api\/auth$/, '');
}

export interface SendInviteResult {
  ok: boolean;
  error?: string;
  /** True when everything was recorded but the mail itself did not go. */
  mailFailed?: boolean;
  link?: string;
  inviteId?: string;
}

export async function inviteToTasks(input: {
  email: string;
  name?: string | null;
  level: AccessLevel;
  taskId?: string | null;
  note?: string | null;
  actor: string;
  actorName: string;
}): Promise<SendInviteResult> {
  const email = normaliseEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'That does not look like an email address' };
  }

  const base = inviteBase();
  if (!base) {
    return {
      ok: false,
      error: 'The server does not know its own address — set APP_URL and redeploy.',
    };
  }

  /*
   * The grant is written first, and on purpose.
   *
   * If the mail fails he can send the link himself, and the person will get in
   * — whereas a grant written only once the mail succeeds leaves somebody
   * holding a working link to a door that is still locked.
   */
  const granted = await grantAccess(email, input.level, input.actor);
  if (!granted.ok) return { ok: false, error: granted.error };

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600_000);

  const [row] = await db
    .insert(taskInvites)
    .values({
      email,
      name: input.name?.trim() || null,
      level: input.level,
      taskId: input.taskId ?? null,
      tokenHash: await hashToken(token),
      invitedBy: input.actor,
      note: input.note?.trim() || null,
      expiresAt,
    })
    .returning({ id: taskInvites.id });

  const link = `${base}/join/${token}`;
  const letter = inviteLetter({
    inviterName: input.actorName,
    inviteeName: input.name ?? null,
    link,
    expiresAt,
    level: input.level,
    note: input.note ?? null,
    task: input.taskId ? await taskForInvite(input.taskId) : null,
  });

  const sent = await sendMail({ to: email, subject: letter.subject, body: letter.body }).catch(
    (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'unknown' }),
  );

  await db
    .update(taskInvites)
    .set({
      sentAt: sent.ok ? new Date() : null,
      sendError: sent.ok ? null : (sent.error ?? 'unknown'),
    })
    .where(eq(taskInvites.id, row!.id));

  await writeAudit({
    actor: input.actor,
    action: 'task_access.invite',
    entityType: 'task_access',
    entityId: email,
    before: null,
    after: { email, level: input.level, taskId: input.taskId ?? null, mailSent: sent.ok },
  });

  if (!sent.ok) {
    return {
      ok: false,
      mailFailed: true,
      link,
      inviteId: row!.id,
      error: `They now have access, but the mail did not go out: ${sent.error ?? 'unknown'}. Send them this link yourself.`,
    };
  }
  return { ok: true, link, inviteId: row!.id };
}

/** The task as the invitation describes it. */
async function taskForInvite(taskId: string): Promise<InviteTask | null> {
  const [row] = await db
    .select({
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      nextStep: tasks.nextStep,
      description: tasks.description,
      isPrivate: tasks.isPrivate,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) return null;

  /*
   * A starred task is his alone, so it never travels in a mail — the whole
   * point of the star is that nobody else sees it, and an invitation quoting
   * one would put it in somebody's inbox forever.
   */
  if (row.isPrivate) return null;

  const who = await assigneesOf(taskId);
  return {
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    nextStep: row.nextStep,
    description: row.description,
    people: who.map((p) => p.name),
  };
}

export interface PendingInvite {
  id: string;
  email: string;
  name: string | null;
  level: AccessLevel;
  sentAt: Date | null;
  sendError: string | null;
  expiresAt: Date;
  taskTitle: string | null;
}

/** Invitations still waiting to be taken up, newest first. */
export async function pendingInvites(): Promise<PendingInvite[]> {
  const rows = await db
    .select({
      id: taskInvites.id,
      email: taskInvites.email,
      name: taskInvites.name,
      level: taskInvites.level,
      sentAt: taskInvites.sentAt,
      sendError: taskInvites.sendError,
      expiresAt: taskInvites.expiresAt,
      taskTitle: tasks.title,
    })
    .from(taskInvites)
    .leftJoin(tasks, eq(tasks.id, taskInvites.taskId))
    .where(
      and(
        isNull(taskInvites.acceptedAt),
        isNull(taskInvites.revokedAt),
        gt(taskInvites.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(taskInvites.createdAt));

  return rows.map((r) => ({
    ...r,
    level: r.level === 'edit' ? 'edit' : 'view',
  }));
}

export interface OpenInvite {
  id: string;
  email: string;
  name: string | null;
  level: AccessLevel;
  invitedByName: string;
  taskTitle: string | null;
  alreadyHasLogin: boolean;
}

/**
 * The invitation behind a link, if the link is still worth anything.
 *
 * One answer for every way of being invalid — unknown, expired, used, revoked
 * — because the page is public, and telling a stranger which of those it was
 * turns the URL into a way to enumerate who has been invited.
 */
export async function openInvite(token: string): Promise<OpenInvite | null> {
  if (!token || token.length < 32) return null;

  const [row] = await db
    .select({
      id: taskInvites.id,
      email: taskInvites.email,
      name: taskInvites.name,
      level: taskInvites.level,
      invitedBy: taskInvites.invitedBy,
      taskId: taskInvites.taskId,
      expiresAt: taskInvites.expiresAt,
      acceptedAt: taskInvites.acceptedAt,
      revokedAt: taskInvites.revokedAt,
    })
    .from(taskInvites)
    .where(eq(taskInvites.tokenHash, await hashToken(token)))
    .limit(1);

  if (!row) return null;
  if (row.acceptedAt || row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  const [inviter] = await db
    .select({ name: people.name })
    .from(people)
    .where(sql`lower(${people.email}) = ${normaliseEmail(row.invitedBy)}`)
    .limit(1);

  const [task] = row.taskId
    ? await db
        .select({ title: tasks.title, isPrivate: tasks.isPrivate })
        .from(tasks)
        .where(eq(tasks.id, row.taskId))
        .limit(1)
    : [];

  const [existing] = await db
    .select({ email: collaboratorLogins.email })
    .from(collaboratorLogins)
    .where(eq(collaboratorLogins.email, row.email))
    .limit(1);

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    level: row.level === 'edit' ? 'edit' : 'view',
    invitedByName: inviter?.name ?? row.invitedBy,
    taskTitle: task && !task.isPrivate ? task.title : null,
    alreadyHasLogin: Boolean(existing),
  };
}

export async function acceptInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const invite = await openInvite(input.token);
  if (!invite) {
    return { ok: false, error: 'This invitation is no longer valid. Ask for a new one.' };
  }

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: 'Please put in your name' };
  if (input.password.length < MIN_PASSWORD) {
    return { ok: false, error: `A password needs at least ${MIN_PASSWORD} characters` };
  }

  const passwordHash = await hashPassword(input.password);

  await db
    .insert(collaboratorLogins)
    .values({ email: invite.email, name, passwordHash, inviteId: invite.id })
    .onConflictDoUpdate({
      target: collaboratorLogins.email,
      // Taking up a second invitation resets the password rather than failing,
      // which is also how somebody who has forgotten theirs gets back in: he
      // invites them again.
      set: { name, passwordHash, inviteId: invite.id },
    });

  await db
    .update(taskInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(taskInvites.id, invite.id));

  await writeAudit({
    actor: invite.email,
    action: 'task_access.invite_accepted',
    entityType: 'task_access',
    entityId: invite.email,
    before: null,
    after: { name, level: invite.level },
  });

  return { ok: true, email: invite.email };
}

/**
 * Whether this is a real collaborator with this password.
 *
 * Called by the sign-in provider. It checks the password and nothing else —
 * whether they may still come in is the grant's business, re-read separately
 * on the same sign-in, so a revoked grant closes the door immediately even
 * though the password is still perfectly good.
 */
export async function verifyCollaborator(
  email: string,
  password: string,
): Promise<{ email: string; name: string } | null> {
  const clean = normaliseEmail(email);
  const [row] = await db
    .select()
    .from(collaboratorLogins)
    .where(eq(collaboratorLogins.email, clean))
    .limit(1);
  if (!row) return null;

  const { verifyPassword } = await import('@/lib/auth/password');
  if (!(await verifyPassword(password, row.passwordHash))) return null;

  await db
    .update(collaboratorLogins)
    .set({ lastLoginAt: new Date() })
    .where(eq(collaboratorLogins.email, clean));

  return { email: clean, name: row.name };
}

/** Cancels an invitation that has not been taken up. */
export async function revokeInvite(id: string, actor: string): Promise<{ ok: boolean }> {
  await db
    .update(taskInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(taskInvites.id, id), isNull(taskInvites.acceptedAt)));
  await writeAudit({
    actor,
    action: 'task_access.invite_revoked',
    entityType: 'task_access',
    entityId: id,
    before: null,
    after: null,
  });
  return { ok: true };
}
