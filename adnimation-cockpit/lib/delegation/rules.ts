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

export const newDelegationSchema = z.object({
  delegatedTo: z.string().uuid('Pick who this is going to'),
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
