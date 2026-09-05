import { z } from 'zod';
import { DELEGATION_STALE_DAYS, TASK_PRIORITIES } from '@/lib/tasks/types';

/**
 * What a delegation is, and which view it belongs in — with no database
 * underneath, so the rules that decide "stuck" and "waiting" can be tested
 * directly.
 */

export const DELEGATION_VIEWS = ['open', 'waiting', 'answered', 'stuck', 'done'] as const;
export type DelegationView = (typeof DELEGATION_VIEWS)[number];

export const VIEW_LABEL: Record<DelegationView, string> = {
  open: 'OPEN',
  waiting: 'WAITING ON THEM',
  answered: 'ANSWERED',
  stuck: 'STUCK',
  done: 'DONE',
};

/**
 * How he hands something over, in his own words.
 *
 * He wrote it out: "לטיפולך בבקשה ועדכן. תודה, מאור" — over to you please, and
 * let me know. That is the whole message. Anything longer is the cockpit
 * talking instead of him, and the person on the other end can tell.
 *
 * The subject is the same every time too: waiting for an update on X. Most of
 * the team has no ClickUp and never will, so the thing being tracked is this
 * message, and its title has to say what it is about on its own.
 */
export const HANDOVER_BODY = 'לטיפולך בבקשה ועדכן.\n\nתודה,\nמאור';

/** The title a hand-over is tracked under. */
export const handoverTitle = (subject: string): string =>
  `מחכה לעדכון בנושא: ${String(subject ?? '').trim()}`.slice(0, 300);

/**
 * The message itself: his words, then what it is about, then anything he added.
 */
export function handoverMessage(
  subject: string,
  note?: string | null,
  dueDate?: string | null,
): string {
  return [
    `*${String(subject ?? '').trim()}*`,
    '',
    HANDOVER_BODY,
    note?.trim() ? `\n${note.trim()}` : '',
    dueDate ? `\n*עד:* ${dueDate}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Where a hand-over is delivered.
 *
 * A person is a direct message, which is what most of them are. A channel is
 * for work that belongs to a team rather than a name — he asked for channels
 * as an option and he is right: "whoever picks this up" is a real way to hand
 * something over. An email is for the people with no Slack at all.
 *
 * Whichever it is, a person still owns the answer: the tracker is built on
 * that, and "the channel owes me an update" is not something anyone chases.
 */
export const DELEGATION_TARGETS = ['person', 'channel', 'email'] as const;
export type DelegationTarget = (typeof DELEGATION_TARGETS)[number];

export const TARGET_LABEL: Record<DelegationTarget, string> = {
  person: 'A PERSON, IN SLACK',
  channel: 'A SLACK CHANNEL',
  email: 'BY EMAIL',
};

export const newDelegationSchema = z.object({
  delegatedTo: z.string().uuid('Pick who this is going to'),
  /** Where it is delivered. Defaults to a direct message, as it always was. */
  targetKind: z.enum(DELEGATION_TARGETS).default('person'),
  /** The channel or the address, when it is one of those. */
  targetRef: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(200).nullable(),
  ).optional(),
  title: z.string().trim().min(1, 'Say what you are handing over').max(300),
  note: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(5000).nullable(),
  ).optional(),
  dueDate: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullable(),
  ).optional(),
  priority: z.enum(TASK_PRIORITIES).default('P2'),
  /** Also create the matching ClickUp task. Off for a pure conversation. */
  alsoClickUp: z.boolean().default(true),
  /**
   * Which ClickUp list the task lands in — the company's departments are its
   * lists. Unset falls back to CLICKUP_DEFAULT_LIST_ID.
   */
  clickupListId: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(40).nullable(),
  ).optional(),
});

export type NewDelegationInput = z.input<typeof newDelegationSchema>;

export interface DelegationRow {
  id: string;
  title: string;
  note: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  delegatedAt: Date;
  lastMovementAt: Date;
  daysQuiet: number;
  personId: string;
  personName: string;
  personEmail: string;
  personSlackId: string | null;
  slackMessageUrl: string | null;
  slackChannelId: string | null;
  slackThreadTs: string | null;
  /** True when he is in the Slack conversation too, not only the bot and them. */
  slackShared: boolean;
  clickupTaskId: string | null;
  replyChannel: string | null;
  replyAt: Date | null;
  replyAuthor: string | null;
  replyExcerpt: string | null;
  replyUrl: string | null;
  repliesCheckedAt: Date | null;
  nudgeCount: number;
  lastNudgeAt: Date | null;
  closedAt: Date | null;
  closedNote: string | null;
  /** True when it was handed over and nothing has come back. */
  waiting: boolean;
  stuck: boolean;
  /** Set when Slack never accepted the message — it was never delivered. */
  undelivered: boolean;
}


export const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));

/** The three states derived from the row, rather than stored on it. */
export function classify(
  row: { status: string; replyAt: Date | null; lastMovementAt: Date; slackMessageUrl: string | null },
  now: Date,
): { daysQuiet: number; waiting: boolean; stuck: boolean; undelivered: boolean } {
  const daysQuiet = daysBetween(row.lastMovementAt, now);
  return {
    daysQuiet,
    // Waiting means it went out and nothing has come back. A finished
    // delegation is never waiting, however long it sat before it closed.
    waiting: row.replyAt === null && row.status !== 'done',
    stuck: row.status !== 'done' && daysQuiet >= DELEGATION_STALE_DAYS && row.replyAt === null,
    // Slack never accepted it, so nobody was told — which must not look like
    // an ordinary hand-off nobody has answered yet.
    undelivered: row.slackMessageUrl === null,
  };
}

export function inView(row: DelegationRow, view: DelegationView): boolean {
  switch (view) {
    case 'open':
      return row.status !== 'done';
    case 'waiting':
      return row.waiting;
    case 'answered':
      return row.replyAt !== null && row.status !== 'done';
    case 'stuck':
      return row.stuck;
    case 'done':
      return row.status === 'done';
  }
}
