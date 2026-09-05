import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { subDays } from 'date-fns';
import { z } from 'zod';
import { db, delegations, people, tasks } from '@/lib/db';
import type { ClickUpAdapter, SlackAdapter } from '@/lib/integrations/types';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import { DELEGATION_STALE_DAYS, TASK_PRIORITIES } from '@/lib/tasks/types';
import { handoverMessage, handoverTitle } from './rules';
import { writeAudit } from '@/lib/audit';

export const delegateInputSchema = z.object({
  sourceEntityType: z.enum(['task', 'alert', 'contract', 'partner', 'deal']),
  sourceEntityId: z.string().uuid(),
  delegatedTo: z.string().uuid(),
  title: z.string().trim().min(1, 'Title is required').max(300),
  note: z.string().trim().max(5000).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  priority: z.enum(TASK_PRIORITIES).default('P2'),
  clickupListId: z.string().min(1, 'CLICKUP_DEFAULT_LIST_ID is not configured'),
  backlinkUrl: z.string().url().optional(),
});

export type DelegateInput = z.input<typeof delegateInputSchema>;

export interface DelegateResult {
  delegationId: string;
  slack: { ok: boolean; url: string | null; error?: string };
  clickup: { ok: boolean; taskId: string | null; url: string | null; error?: string };
}

/**
 * Spec 6.1.3 — delegating fires both side effects at once: a Slack message to
 * the person, and a ClickUp task linked back here.
 *
 * DECISION: if one side fails the delegation is still recorded, with the
 * failure visible in the tracker. Losing the record because Slack was down is
 * worse than a half-delivered delegation the CEO can see and retry. The
 * alternative — rolling back on partial failure — would silently drop work he
 * believes he has handed off.
 */
export async function delegate(
  input: DelegateInput,
  deps: { slack: SlackAdapter; clickup: ClickUpAdapter; actor: string },
): Promise<DelegateResult> {
  const parsed = delegateInputSchema.parse(input);

  const [person] = await db.select().from(people).where(eq(people.id, parsed.delegatedTo)).limit(1);
  if (!person) throw new Error('No person with that id');

  const dueDateMs = parsed.dueDate ? Date.parse(`${parsed.dueDate}T12:00:00Z`) : null;

  /*
   * No ClickUp task any more.
   *
   * He said it plainly: he no longer needs to keep ClickUp up to date, it all
   * stays in his own system — and most of the team does not have ClickUp at
   * all, so a ticket nobody opens was tracking nothing. What is tracked is the
   * message and the reply to it.
   */
  const clickupTask = { ok: true as const, taskId: null, url: null, error: undefined };
  void dueDateMs;

  const slackText = handoverMessage(parsed.title, parsed.note, parsed.dueDate);

  const slackResult = person.slackId
    ? await deps.slack
        .postMessage({
          target: person.slackId,
          text: slackText,
          contextLines: [`Delegated by ${deps.actor}`],
          backlinkUrl: parsed.backlinkUrl,
        })
        .catch((e: unknown) => ({
          ok: false as const,
          messageUrl: null,
          error: e instanceof Error ? e.message : 'unknown',
        }))
    : { ok: false as const, messageUrl: null, error: 'no_slack_id' };

  await (slackResult.ok
    ? recordSuccess('slack')
    : recordFailure('slack', slackResult.error ?? 'post_failed'));

  const [row] = await db
    .insert(delegations)
    .values({
      sourceEntityType: parsed.sourceEntityType,
      sourceEntityId: parsed.sourceEntityId,
      taskId: parsed.sourceEntityType === 'task' ? parsed.sourceEntityId : null,
      delegatedTo: parsed.delegatedTo,
      clickupTaskId: clickupTask.taskId,
      slackMessageUrl: slackResult.messageUrl,
      note: parsed.note ?? null,
      dueDate: parsed.dueDate ?? null,
      status: 'sent',
    })
    .returning();

  if (!row) throw new Error('Failed to record the delegation');

  // Spec 6.1.3 step 5 — the source task moves to "delegated, waiting".
  if (parsed.sourceEntityType === 'task') {
    await db
      .update(tasks)
      .set({ status: 'delegated', updatedAt: new Date() })
      .where(eq(tasks.id, parsed.sourceEntityId));
  }

  await writeAudit({
    actor: deps.actor,
    action: 'delegation.create',
    entityType: 'delegation',
    entityId: row.id,
    after: {
      delegatedTo: person.email,
      title: handoverTitle(parsed.title),
      slackOk: slackResult.ok,
      clickupOk: clickupTask.ok,
    },
  });

  return {
    delegationId: row.id,
    slack: { ok: slackResult.ok, url: slackResult.messageUrl, error: slackResult.error },
    clickup: {
      ok: clickupTask.ok,
      taskId: clickupTask.taskId,
      url: clickupTask.url,
      error: clickupTask.error,
    },
  };
}

/** The statuses that still count as "out there, waiting on someone". */
export const OPEN_DELEGATION_STATUSES = ['sent', 'acknowledged', 'in_progress', 'stale'] as const;

/**
 * Spec 6.1.3 — a delegation with no movement for three days is stale and the
 * CEO gets a reminder. Returns the rows that just flipped, so the caller can
 * raise one alert per newly-stale item.
 */
export async function markStaleDelegations(now = new Date()) {
  const cutoff = subDays(now, DELEGATION_STALE_DAYS);
  return db
    .update(delegations)
    .set({ status: 'stale' })
    .where(
      and(
        or(eq(delegations.status, 'sent'), eq(delegations.status, 'acknowledged')),
        lt(delegations.lastMovementAt, cutoff),
      ),
    )
    .returning();
}

/** Records movement on a delegation, resetting its staleness clock. */
export async function recordDelegationMovement(
  clickupTaskId: string,
  status: 'acknowledged' | 'in_progress' | 'done',
  now = new Date(),
) {
  return db
    .update(delegations)
    .set({ status, lastMovementAt: now })
    .where(eq(delegations.clickupTaskId, clickupTaskId))
    .returning();
}

/** Delegation Tracker (spec 6.4) — what I gave, to whom, and how long it has sat. */
export async function listOpenDelegations() {
  return db
    .select({
      id: delegations.id,
      status: delegations.status,
      note: delegations.note,
      dueDate: delegations.dueDate,
      delegatedAt: delegations.delegatedAt,
      lastMovementAt: delegations.lastMovementAt,
      clickupTaskId: delegations.clickupTaskId,
      slackMessageUrl: delegations.slackMessageUrl,
      sourceEntityType: delegations.sourceEntityType,
      replyChannel: delegations.replyChannel,
      replyAt: delegations.replyAt,
      replyAuthor: delegations.replyAuthor,
      replyExcerpt: delegations.replyExcerpt,
      replyUrl: delegations.replyUrl,
      repliesCheckedAt: delegations.repliesCheckedAt,
      personName: people.name,
      personEmail: people.email,
      taskTitle: tasks.title,
    })
    .from(delegations)
    .innerJoin(people, eq(delegations.delegatedTo, people.id))
    .leftJoin(tasks, eq(delegations.taskId, tasks.id))
    .where(inArray(delegations.status, [...OPEN_DELEGATION_STATUSES]))
    .orderBy(desc(delegations.lastMovementAt));
}

/** Days a delegation has sat without movement — the tracker's headline number. */
export function daysStuck(lastMovementAt: Date, now = new Date()): number {
  const ms = now.getTime() - lastMovementAt.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
