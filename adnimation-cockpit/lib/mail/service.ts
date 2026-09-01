import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, mailThreads, pipelineClients } from '@/lib/db';
import { createTask } from '@/lib/tasks/mutations';

/**
 * The mailbox, as the cockpit reads it.
 *
 * He is already in Gmail all day, so a second copy of his inbox is worth
 * nothing. What is worth something is the part Gmail will not tell him: which
 * conversations are waiting on *him*, and which of those are with people the
 * company actually does business with.
 *
 * So the default view is not "mail". It is "the last word was theirs".
 */

export const MAIL_VIEWS = ['all', 'waiting', 'important', 'recent', 'handled', 'filtered'] as const;
export type MailView = (typeof MAIL_VIEWS)[number];

export const MAIL_VIEW_LABEL: Record<MailView, string> = {
  all: 'EVERYTHING',
  waiting: 'NEEDS A REPLY',
  important: 'IMPORTANT & WAITING',
  recent: 'CARRYING THE INBOX LABEL',
  handled: 'MARKED HANDLED',
  filtered: 'FILTERED PAST THE INBOX',
};

export interface MailRow {
  threadId: string;
  subject: string | null;
  snippet: string | null;
  counterpartName: string | null;
  counterpartEmail: string | null;
  messageCount: number;
  lastMessageAt: Date;
  lastFromMe: boolean;
  unread: boolean;
  starred: boolean;
  gmailImportant: boolean;
  knownContact: boolean;
  knownCompany: string | null;
  dismissedAt: Date | null;
  /** Days since the last message — how long they have been waiting. */
  daysWaiting: number;
  url: string;
}

const daysSince = (d: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));

/**
 * Important means somebody the company deals with, not Gmail's guess.
 *
 * A CRM contact, a known company domain, or a colleague. Gmail's own IMPORTANT
 * flag counts only when it agrees with a starred thread — on its own, in a
 * mailbox of 151,000 messages, it is noise.
 */
/**
 * The inbox, as Gmail defines it.
 *
 * His filters route most mail straight past the inbox into labels, and that
 * routing IS his triage — a screen that shows everything mirrored shows him
 * the mail he has already decided not to look at. The mirror stays wide
 * because the opportunity detector reads it; the screen narrows to what
 * actually landed in front of him.
 */
const inInbox = sql`${mailThreads.labels} @> array['INBOX']`;

const isImportant = sql`(
  ${mailThreads.knownContact} = true
  or (${mailThreads.gmailImportant} = true and ${mailThreads.starred} = true)
)`;

export async function listMail(view: MailView = 'waiting', limit = 100): Promise<MailRow[]> {
  const waiting = and(eq(mailThreads.lastFromMe, false), isNull(mailThreads.dismissedAt));

  const scoped =
    view === 'waiting'
      ? waiting
      : view === 'important'
        ? and(waiting, isImportant)
        : view === 'handled'
          ? sql`${mailThreads.dismissedAt} is not null`
          : undefined;

  /*
   * Every view is the inbox — filtered mail is filtered on purpose, and his
   * rules are his triage.
   *
   * `filtered` is the one exception: the mail his rules routed away, still
   * unanswered. It is not the default and never counted as waiting, but it is
   * reachable, because "I know it skipped my inbox and I still want to see
   * what is unanswered" is a real question.
   */
  /*
   * "Everything" is the default, and INBOX is only one of the views.
   *
   * Gmail's INBOX label turned out to be a poor stand-in for what he sees: the
   * mail he was looking at — read, replied to, sitting in front of him — was
   * labelled IMPORTANT and CATEGORY_PERSONAL and nothing else. A screen that
   * hides those is a screen he cannot trust against the mailbox beside it.
   * So the default is every conversation the mirror holds, newest first, and
   * the label-based views are filters on top of it.
   */
  const where =
    view === 'all'
      ? undefined
      : view === 'filtered'
        ? and(sql`not (${mailThreads.labels} @> array['INBOX'])`, waiting)
        : scoped
          ? and(inInbox, scoped)
          : inInbox;

  const rows = await db
    .select()
    .from(mailThreads)
    .where(where ?? sql`true`)
    .orderBy(desc(mailThreads.lastMessageAt))
    .limit(limit);

  const now = new Date();
  return rows.map((r) => ({
    threadId: r.threadId,
    subject: r.subject,
    snippet: r.snippet,
    counterpartName: r.counterpartName,
    counterpartEmail: r.counterpartEmail,
    messageCount: r.messageCount,
    lastMessageAt: r.lastMessageAt,
    lastFromMe: r.lastFromMe,
    unread: r.unread,
    starred: r.starred,
    gmailImportant: r.gmailImportant,
    knownContact: r.knownContact,
    knownCompany: r.knownCompany,
    dismissedAt: r.dismissedAt,
    daysWaiting: daysSince(r.lastMessageAt, now),
    url: `https://mail.google.com/mail/u/0/#all/${r.threadId}`,
  }));
}

export interface MailCounts {
  waiting: number;
  important: number;
  total: number;
  oldestWaitingDays: number | null;
  lastSyncedAt: Date | null;
  /** Threads held in the mirror overall, including the filtered-away ones. */
  mirrored: number;
}

export async function mailCounts(now = new Date()): Promise<MailCounts> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      waiting: sql<number>`count(*) filter (where last_from_me = false and dismissed_at is null)::int`,
      important: sql<number>`count(*) filter (
        where last_from_me = false and dismissed_at is null
        and (known_contact = true or (gmail_important = true and starred = true))
      )::int`,
      oldest: sql<Date | null>`min(last_message_at) filter (where last_from_me = false and dismissed_at is null)`,
      syncedAt: sql<Date | null>`max(synced_at)`,
      /** Everything mirrored, inbox or not — what the detector reads. */
      mirrored: sql<number>`(select count(*)::int from mail_threads)`,
    })
    .from(mailThreads)
    .where(inInbox);

  return {
    total: row?.total ?? 0,
    waiting: row?.waiting ?? 0,
    important: row?.important ?? 0,
    oldestWaitingDays: row?.oldest ? daysSince(new Date(row.oldest), now) : null,
    lastSyncedAt: row?.syncedAt ?? null,
    mirrored: row?.mirrored ?? 0,
  };
}

/** The few that belong on the home page: important, waiting, oldest first. */
export async function mailNeedingReply(limit = 5): Promise<MailRow[]> {
  const rows = await db
    .select()
    .from(mailThreads)
    .where(
      and(inInbox, eq(mailThreads.lastFromMe, false), isNull(mailThreads.dismissedAt), isImportant),
    )
    .orderBy(mailThreads.lastMessageAt)
    .limit(limit);

  const now = new Date();
  return rows.map((r) => ({
    threadId: r.threadId,
    subject: r.subject,
    snippet: r.snippet,
    counterpartName: r.counterpartName,
    counterpartEmail: r.counterpartEmail,
    messageCount: r.messageCount,
    lastMessageAt: r.lastMessageAt,
    lastFromMe: r.lastFromMe,
    unread: r.unread,
    starred: r.starred,
    gmailImportant: r.gmailImportant,
    knownContact: r.knownContact,
    knownCompany: r.knownCompany,
    dismissedAt: r.dismissedAt,
    daysWaiting: daysSince(r.lastMessageAt, now),
    url: `https://mail.google.com/mail/u/0/#all/${r.threadId}`,
  }));
}

/**
 * Mark a thread as handled here.
 *
 * The cockpit cannot reply, so a thread he has dealt with elsewhere — by
 * phone, in person, or because it needed nothing — would otherwise sit in
 * "needs a reply" for ever. The next sync clears this the moment he actually
 * answers in Gmail, so it cannot hide a live conversation.
 */
export async function dismissThread(threadId: string, undo = false) {
  await db
    .update(mailThreads)
    .set({ dismissedAt: undo ? null : new Date() })
    .where(eq(mailThreads.threadId, threadId));
}

/**
 * One thread, as a task would want it.
 *
 * The mail screen already holds everything a task needs — the subject, who it
 * is from, the link back — so making a task out of a conversation needs
 * nothing from Gmail and cannot fail because a token expired.
 */
export async function taskFromThread(
  threadId: string,
  actor: string,
): Promise<{ ok: true; id: string; title: string } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(mailThreads)
    .where(eq(mailThreads.threadId, threadId))
    .limit(1);
  if (!row) return { ok: false, error: 'That conversation is not in the mirror yet' };

  const who = row.counterpartName ?? row.counterpartEmail ?? 'unknown sender';
  const title = (row.subject ?? '').trim() || `Mail from ${who}`;

  const task = await createTask(
    {
      title: title.slice(0, 300),
      description: [
        `From ${who}${row.counterpartEmail && row.counterpartName ? ` <${row.counterpartEmail}>` : ''}`,
        row.snippet ?? '',
        '',
        `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
      ]
        .filter(Boolean)
        .join('\n'),
      priority: 'P2',
      status: 'open',
      tags: [],
      blockedPeople: [],
      source: 'email',
      sourceRef: threadId,
    },
    actor,
  );

  return { ok: true, id: task.id, title };
}

/**
 * A conversation, straight into the pipeline.
 *
 * The path used to be two screens: capture it as an opportunity, open the
 * opportunities page, promote it. That is the right sequence for something he
 * noticed and has not acted on — and the wrong one for a mail that IS the
 * deal starting, which is most of what arrives from a new partner.
 *
 * The thread supplies what the pipeline asks for: who they are, their domain,
 * and a first touch that says where the conversation started. What it cannot
 * supply is the next step, and the pipeline refuses a deal without one
 * (spec §8), so that is his to fill in — the form arrives with a sensible
 * suggestion rather than an empty box.
 */
export async function pipelineFromThread(
  threadId: string,
): Promise<
  | {
      ok: true;
      suggestion: {
        name: string;
        domain: string;
        nextStep: string;
        notes: string;
        source: string;
      };
      existingClientId: string | null;
    }
  | { ok: false; error: string }
> {
  const [row] = await db
    .select()
    .from(mailThreads)
    .where(eq(mailThreads.threadId, threadId))
    .limit(1);
  if (!row) return { ok: false, error: 'That conversation is not in the mirror yet' };

  const email = (row.counterpartEmail ?? '').toLowerCase();
  const domain = email.includes('@') ? (email.split('@')[1] ?? '') : '';

  // The company if the mirror knows it, otherwise the person, otherwise the
  // domain — a name he will recognise on the board either way.
  const name = row.knownCompany ?? row.counterpartName ?? (domain || email || 'Unknown');

  // Already on the board under the same domain? Then this is a conversation
  // with an existing deal, not a new one, and saying so beats a duplicate.
  const [existing] = domain
    ? await db
        .select({ id: pipelineClients.id })
        .from(pipelineClients)
        .where(and(eq(pipelineClients.domain, domain), isNull(pipelineClients.archivedAt)))
        .limit(1)
    : [];

  return {
    ok: true,
    suggestion: {
      name,
      domain,
      nextStep: row.lastFromMe ? 'Follow up on the thread' : `Reply to "${row.subject ?? 'their mail'}"`,
      notes: [
        row.subject ? `From the mail: ${row.subject}` : '',
        row.counterpartEmail ?? '',
        `https://mail.google.com/mail/u/0/#all/${threadId}`,
      ]
        .filter(Boolean)
        .join('\n'),
      source: 'inbound',
    },
    existingClientId: existing?.id ?? null,
  };
}
