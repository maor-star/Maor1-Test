import { asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, delegations, people, tasks } from '@/lib/db';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
import { sendMail } from '@/lib/mail/send';
import { createSlackAdapter } from '@/lib/integrations/slack';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import type { SlackAdapter, SlackPostResult, ThreadMessage } from '@/lib/integrations/types';
import { writeAudit } from '@/lib/audit';
import {
  classify, inView, newDelegationSchema,
  type DelegationRow, type DelegationView, type NewDelegationInput, handoverMessage, handoverTitle } from './rules';

export * from './rules';

/**
 * Running the delegations, rather than only watching them.
 *
 * The tracker used to be a list you could not add to: a delegation could only
 * be created from an existing task, and once created there was nothing to do
 * with it. Everything a hand-off actually needs is here — start one, read what
 * came back, answer it, chase it, close it.
 *
 * The conversation itself is not copied into the database. It lives in the
 * Slack thread, and is read on demand: a mirror would go stale the moment
 * somebody replied in Slack, which is where the conversation really happens.
 */

export async function listDelegations(
  view: DelegationView = 'open',
  now = new Date(),
): Promise<DelegationRow[]> {
  const rows = await db
    .select({
      id: delegations.id,
      title: delegations.title,
      note: delegations.note,
      status: delegations.status,
      priority: delegations.priority,
      dueDate: delegations.dueDate,
      delegatedAt: delegations.delegatedAt,
      lastMovementAt: delegations.lastMovementAt,
      slackMessageUrl: delegations.slackMessageUrl,
      slackChannelId: delegations.slackChannelId,
      slackThreadTs: delegations.slackThreadTs,
      slackShared: delegations.slackShared,
      clickupTaskId: delegations.clickupTaskId,
      replyChannel: delegations.replyChannel,
      replyAt: delegations.replyAt,
      replyAuthor: delegations.replyAuthor,
      replyExcerpt: delegations.replyExcerpt,
      replyUrl: delegations.replyUrl,
      repliesCheckedAt: delegations.repliesCheckedAt,
      nudgeCount: delegations.nudgeCount,
      lastNudgeAt: delegations.lastNudgeAt,
      closedAt: delegations.closedAt,
      closedNote: delegations.closedNote,
      personId: people.id,
      personName: people.name,
      personEmail: people.email,
      personSlackId: people.slackId,
      taskTitle: tasks.title,
    })
    .from(delegations)
    .innerJoin(people, eq(delegations.delegatedTo, people.id))
    .leftJoin(tasks, eq(delegations.taskId, tasks.id))
    .where(isNull(delegations.archivedAt))
    .orderBy(desc(delegations.lastMovementAt));

  const mapped: DelegationRow[] = rows.map((r) => ({
    ...r,
    // A delegation created from a task takes its title; a standalone one
    // carries its own. One of the two is always there.
    title: r.title ?? r.taskTitle ?? 'Untitled',
    ...classify(r, now),
  }));

  return mapped.filter((r) => inView(r, view));
}

export interface DelegationCounts {
  open: number;
  waiting: number;
  answered: number;
  stuck: number;
  done: number;
}

export async function delegationCounts(now = new Date()): Promise<DelegationCounts> {
  const all = await listDelegations('open', now);
  const done = await listDelegations('done', now);
  return {
    open: all.length,
    waiting: all.filter((r) => r.waiting).length,
    answered: all.filter((r) => r.replyAt !== null).length,
    stuck: all.filter((r) => r.stuck).length,
    done: done.length,
  };
}

/** Who work can be handed to — everyone but the CEO himself. */
export async function delegatableTeam(ownerEmail: string) {
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      slackId: people.slackId,
      role: people.role,
    })
    .from(people)
    .where(eq(people.active, true))
    .orderBy(asc(people.name));

  return rows.filter((p) => p.email.toLowerCase() !== ownerEmail.toLowerCase());
}

export interface CreateResult {
  id: string;
  /** True when the Slack conversation includes him as well as them. */
  shared: boolean;
  slackOk: boolean;
  slackError?: string;
  clickupOk: boolean;
  clickupError?: string;
}

/**
 * Hands something over, from the tracker rather than from a task.
 *
 * Slack is the conversation and is what matters; ClickUp is optional because
 * not everything handed over is a ticket. As before, a failure on either side
 * still records the delegation — losing the record because Slack was down is
 * worse than a half-delivered hand-off he can see and retry.
 */
export async function createDelegation(
  input: NewDelegationInput,
  actor: string,
  deps = { slack: createSlackAdapter(), clickup: createClickUpAdapter() },
): Promise<CreateResult> {
  const parsed = newDelegationSchema.parse(input);

  const [person] = await db
    .select()
    .from(people)
    .where(eq(people.id, parsed.delegatedTo))
    .limit(1);
  if (!person) throw new Error('No person with that id');
  if (!person.slackId) {
    throw new Error(
      `${person.name} has no Slack id on record, so nothing can be delivered to them. ` +
        'Run the people sync, or add it in the team settings.',
    );
  }

  const note = parsed.note ?? null;
  const dueDate = parsed.dueDate ?? null;

  /*
   * A bot DM to the person is a conversation between the bot and them: it never
   * shows up in his own Slack, which is not what pressing send looks like it
   * does. So try for a conversation with both of them first, and fall back to
   * the plain DM when the workspace has not granted the mpim scopes. The moment
   * they are granted this starts working with no code change.
   */
  const owner = process.env.SLACK_CEO_USER_ID;
  const kind = parsed.targetKind ?? 'person';
  const ref = parsed.targetRef ?? null;

  // A channel is delivered to the channel; a person, to a conversation with
  // them. The person still owns the answer either way — that is what the
  // tracker chases.
  let target = kind === 'channel' && ref ? ref : person.slackId;
  let shared = false;

  if (kind === 'person' && owner && owner !== person.slackId) {
    const group = await deps.slack
      .openConversation([owner, person.slackId])
      .catch(() => ({ ok: false as const, channelId: null }));
    if (group.ok && group.channelId) {
      target = group.channelId;
      shared = true;
    }
  }

  const body = handoverMessage(parsed.title, note, dueDate);

  /*
   * By email, for the people with no Slack.
   *
   * It goes out as its own mail rather than a Slack post, and the tracker
   * watches the mailbox for their answer instead of a thread. Nothing else
   * about the hand-over changes — same words, same title, same chase.
   */
  let posted: SlackPostResult;
  if (kind === 'email') {
    const address = ref ?? person.email;
    const sent = await sendMail({
      to: address,
      subject: handoverTitle(parsed.title),
      body,
    }).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : 'unknown',
    }));

    posted = {
      ok: sent.ok,
      messageUrl: null,
      channelId: null,
      ts: null,
      ...(sent.ok ? {} : { error: sent.error ?? 'mail refused' }),
    };
    await (sent.ok ? recordSuccess('gmail') : recordFailure('gmail', sent.error ?? 'send_failed'));
  } else {
    posted = await deps.slack
      .postMessage({
        target,
        text: body,
        contextLines: [
          shared
            ? 'Handed over from the cockpit — reply in this thread and it is tracked.'
            : 'Handed over from the cockpit — reply here and it will be tracked.',
        ],
      })
      .catch(
        (e: unknown): SlackPostResult => ({
          ok: false,
          messageUrl: null,
          channelId: null,
          ts: null,
          error: e instanceof Error ? e.message : 'unknown',
        }),
      );

    await (posted.ok ? recordSuccess('slack') : recordFailure('slack', posted.error ?? 'post_failed'));
  }

  /*
   * No ClickUp task.
   *
   * "I no longer need to update ClickUp, it all stays in my system, and most
   * people do not have ClickUp anyway." A ticket nobody opens tracked nothing;
   * what is tracked is the message and whether it was answered.
   */
  const clickupTaskId: string | null = null;
  const clickupError: string | undefined = undefined;

  const [row] = await db
    .insert(delegations)
    .values({
      sourceEntityType: 'standalone',
      sourceEntityId: null,
      delegatedTo: person.id,
      title: handoverTitle(parsed.title),
      targetKind: kind,
      targetRef: kind === 'email' ? (ref ?? person.email) : ref,
      note,
      dueDate,
      priority: parsed.priority,
      clickupTaskId,
      slackMessageUrl: posted.messageUrl,
      slackChannelId: posted.channelId ?? null,
      slackThreadTs: posted.ts ?? null,
      slackShared: shared,
      status: 'sent',
    })
    .returning({ id: delegations.id });

  if (!row) throw new Error('Delegation insert returned nothing');

  await writeAudit({
    actor,
    action: 'delegation.create',
    entityType: 'delegation',
    entityId: row.id,
    after: { title: parsed.title, to: person.name, slack: posted.ok, clickup: clickupTaskId },
  });

  return {
    id: row.id,
    shared,
    slackOk: posted.ok,
    ...(posted.error ? { slackError: posted.error } : {}),
    clickupOk: clickupTaskId !== null,
    ...(clickupError ? { clickupError } : {}),
  };
}

async function threadRef(id: string) {
  const [row] = await db
    .select({
      channel: delegations.slackChannelId,
      ts: delegations.slackThreadTs,
      url: delegations.slackMessageUrl,
    })
    .from(delegations)
    .where(eq(delegations.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * The conversation, read live from Slack.
 *
 * Older delegations stored only a permalink, so the channel and timestamp are
 * recovered from it and written back — a one-time repair that keeps every
 * delegation on the same path from then on.
 */
export async function readConversation(
  id: string,
  slack: SlackAdapter = createSlackAdapter(),
): Promise<{ messages: ThreadMessage[]; error: string | null }> {
  const ref = await threadRef(id);
  if (!ref) return { messages: [], error: 'No such delegation' };

  let channel = ref.channel;
  let ts = ref.ts;

  if ((!channel || !ts) && ref.url) {
    const { parsePermalink } = await import('@/lib/integrations/slack');
    const parsed = parsePermalink(ref.url);
    if (parsed) {
      channel = parsed.channel;
      ts = parsed.ts;
      await db
        .update(delegations)
        .set({ slackChannelId: channel, slackThreadTs: ts })
        .where(eq(delegations.id, id));
    }
  }

  if (!channel || !ts) {
    return { messages: [], error: 'This delegation has no Slack thread — it was never delivered.' };
  }

  try {
    return { messages: await slack.readThread(channel, ts), error: null };
  } catch (e) {
    return { messages: [], error: e instanceof Error ? e.message : 'Could not read the thread' };
  }
}

/** Answer in the thread, as the cockpit. */
export async function replyToDelegation(
  id: string,
  text: string,
  actor: string,
  slack: SlackAdapter = createSlackAdapter(),
): Promise<{ ok: boolean; error?: string }> {
  const ref = await threadRef(id);
  if (!ref?.channel || !ref.ts) return { ok: false, error: 'This delegation has no Slack thread.' };

  const posted = await slack.postThreadReply(ref.channel, ref.ts, text).catch(
    (e: unknown): SlackPostResult => ({
      ok: false,
      messageUrl: null,
      error: e instanceof Error ? e.message : 'unknown',
    }),
  );

  if (!posted.ok) return { ok: false, error: posted.error ?? 'Slack rejected the message' };

  // His own reply is movement too: he has picked the thread back up.
  await db
    .update(delegations)
    .set({ lastMovementAt: new Date() })
    .where(eq(delegations.id, id));

  await writeAudit({ actor, action: 'delegation.reply', entityType: 'delegation', entityId: id });
  return { ok: true };
}

/** Chase it. Records that he did, so he never chases the same thing twice. */
export async function nudgeDelegation(
  id: string,
  actor: string,
  text?: string,
  slack: SlackAdapter = createSlackAdapter(),
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({
      channel: delegations.slackChannelId,
      ts: delegations.slackThreadTs,
      title: delegations.title,
      nudgeCount: delegations.nudgeCount,
    })
    .from(delegations)
    .where(eq(delegations.id, id))
    .limit(1);

  if (!row?.channel || !row.ts) return { ok: false, error: 'This delegation has no Slack thread.' };

  const message = text?.trim() || 'Following up on this — where does it stand?';
  const posted = await slack.postThreadReply(row.channel, row.ts, message).catch(
    (): SlackPostResult => ({ ok: false, messageUrl: null, error: 'unknown' }),
  );

  if (!posted.ok) return { ok: false, error: posted.error ?? 'Slack rejected the message' };

  const now = new Date();
  await db
    .update(delegations)
    .set({ nudgeCount: row.nudgeCount + 1, lastNudgeAt: now, lastMovementAt: now })
    .where(eq(delegations.id, id));

  await writeAudit({ actor, action: 'delegation.nudge', entityType: 'delegation', entityId: id });
  return { ok: true };
}

const statusSchema = z.enum(['sent', 'acknowledged', 'in_progress', 'stale', 'done']);

/** Move it along, or close it. Closing keeps the record — nothing is deleted. */
export async function setDelegationStatus(
  id: string,
  status: string,
  actor: string,
  closedNote?: string,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: 'Not a status a delegation can be in' };

  const now = new Date();
  await db
    .update(delegations)
    .set({
      status: parsed.data,
      lastMovementAt: now,
      closedAt: parsed.data === 'done' ? now : null,
      closedNote: parsed.data === 'done' ? (closedNote?.trim() || null) : null,
    })
    .where(eq(delegations.id, id));

  await writeAudit({
    actor,
    action: 'delegation.status',
    entityType: 'delegation',
    entityId: id,
    after: { status: parsed.data },
  });
  return { ok: true };
}

/** Retire it from the tracker. The row survives. */
export async function archiveDelegation(id: string, actor: string) {
  await db.update(delegations).set({ archivedAt: new Date() }).where(eq(delegations.id, id));
  await writeAudit({ actor, action: 'delegation.archive', entityType: 'delegation', entityId: id });
}
