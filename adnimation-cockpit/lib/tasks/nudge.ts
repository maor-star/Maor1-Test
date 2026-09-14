import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, people, taskNudges, tasks } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { createSlackAdapter } from '@/lib/integrations/slack';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import { secret } from '@/lib/secrets/store';
import type { SlackAdapter } from '@/lib/integrations/types';
import { assigneesOf } from './assignees';

/**
 * "What's happening with this?" — the chase, as one button.
 *
 * Everything on this board is work he handed to somebody, and the follow-up is
 * the same six words every time. Typing them into Slack means finding the
 * person, finding the task title, and pasting a link, which is enough friction
 * that it does not happen and the task simply goes quiet instead.
 *
 * Two things it is careful about.
 *
 * It goes to each person SEPARATELY, as a direct message. A chase in a group
 * is a different message — it puts the person on the spot in front of their
 * colleagues — and he asked for a personal one.
 *
 * And it goes out in HIS name. Truly as him needs a Slack user token with the
 * `chat:write` user scope, which posts under his own identity; without one the
 * bot sends it wearing his name and picture, which Slack marks as an app. The
 * text is identical either way, and `asHimself` on the record says which of
 * the two actually happened rather than leaving him to guess from the avatar.
 */

/** His words. The same ones the hand-over uses, asking the other question. */
export const NUDGE_BODY = 'מה קורה עם זה?';

/**
 * What somebody is told when he puts them on a task.
 *
 * Adding a name to a row is not a notification. Until this existed, the person
 * found out they owned something when he chased them about it — so the chase
 * was the first they had heard of the work, which is the wrong way round and
 * reads as an accusation.
 *
 * His wording, the same as the hand-over: over to you please, and let me know.
 * The task travels with it — the title, what state it is in, when it is due
 * and the next move — because a message saying only "you have a new task"
 * sends the person looking for it.
 */
export function assignedMessage(
  task: {
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    nextStep: string | null;
  },
  others: string[],
  link: string | null,
): string {
  const facts: string[] = [];
  if (task.dueDate) facts.push(`*עד:* ${task.dueDate}`);
  if (others.length > 0) facts.push(`*גם על זה:* ${others.join(', ')}`);

  return [
    `*${task.title.trim()}*`,
    '',
    'לטיפולך בבקשה ועדכן.',
    task.nextStep?.trim() ? `\n*הצעד הבא:* ${task.nextStep.trim()}` : '',
    facts.length > 0 ? `\n${facts.join('\n')}` : '',
    link ? `\n${link}` : '',
    '',
    'תודה,\nמאור',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function nudgeMessage(title: string, note?: string | null): string {
  return [
    `*${String(title ?? '').trim()}*`,
    '',
    NUDGE_BODY,
    note?.trim() ? `\n${note.trim()}` : '',
    '',
    'תודה,\nמאור',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * His name and his picture, for the bot to wear.
 *
 * Without the picture a message in his name shows the app's icon beside it,
 * which is the detail that gives it away at a glance. Slack will hand over the
 * avatar for a user id, so it is asked for once and any failure is simply
 * dropped — a nudge that goes out with the wrong picture is far better than
 * one that does not go out.
 */
export async function senderIdentity(
  actorEmail: string,
): Promise<{ name: string; iconUrl?: string }> {
  const [me] = await db
    .select({ name: people.name, slackId: people.slackId })
    .from(people)
    .where(eq(people.email, actorEmail.toLowerCase()))
    .limit(1);
  const name = me?.name ?? 'מאור';

  const slackId = me?.slackId ?? process.env.SLACK_CEO_USER_ID;
  const token = await secret('SLACK_BOT_TOKEN');
  if (!slackId || !token) return { name };

  const iconUrl = await fetch(`https://slack.com/api/users.info?user=${slackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json() as Promise<{ ok?: boolean; user?: { profile?: { image_192?: string } } }>)
    .then((b) => (b.ok ? b.user?.profile?.image_192 : undefined))
    .catch(() => undefined);

  return iconUrl ? { name, iconUrl } : { name };
}

export interface NudgeOutcome {
  personId: string;
  name: string;
  ok: boolean;
  error?: string;
  messageUrl?: string | null;
}

export interface NudgeResult {
  sent: NudgeOutcome[];
  /** True when Slack posted under his own identity rather than the bot's. */
  asHimself: boolean;
}

/**
 * Who signs the message.
 *
 * His own token when there is one, so the DM is genuinely from him. Otherwise
 * the bot, wearing his name and his picture — as close as an app can get, and
 * honestly recorded as not being him.
 */
async function signer(): Promise<{ slack: SlackAdapter; asHimself: boolean }> {
  const userToken = await secret('SLACK_USER_TOKEN');
  if (userToken?.startsWith('xoxp-')) {
    return { slack: createSlackAdapter(userToken), asHimself: true };
  }
  return { slack: createSlackAdapter(), asHimself: false };
}

/**
 * Telling the people he just put on a task that they are on it.
 *
 * Only the NEW names. Re-saving a task, or changing its due date, must not
 * send the same message again to somebody who has had it for a week — that is
 * how a useful message becomes one people mute.
 *
 * A failure here never fails the assignment. He has already decided who is on
 * the task; Slack being unreachable is worth recording and worth showing, and
 * is not a reason to refuse the edit.
 */
export async function notifyAssigned(
  taskId: string,
  personIds: string[],
  actor: string,
  deps?: { slack?: SlackAdapter; asHimself?: boolean; sender?: { name: string; iconUrl?: string } },
): Promise<NudgeOutcome[]> {
  if (personIds.length === 0) return [];

  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      nextStep: tasks.nextStep,
      isPrivate: tasks.isPrivate,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return [];

  /*
   * A starred task is his alone. Putting somebody on one is a contradiction he
   * is allowed to make — they may be helping quietly — but the cockpit must
   * not then announce it in Slack, where it is out of his hands for good.
   */
  if (task.isPrivate) return [];

  const everyone = await assigneesOf(taskId);
  const newcomers = everyone.filter((p) => personIds.includes(p.id));
  if (newcomers.length === 0) return [];

  const chosen = deps?.slack
    ? { slack: deps.slack, asHimself: deps.asHimself ?? false }
    : await signer();

  const base = process.env.APP_URL ?? process.env.AUTH_URL ?? null;
  const link = base ? `${base.replace(/\/+$/, '')}/tasks/${task.id}` : null;

  const sent: NudgeOutcome[] = [];
  for (const person of newcomers) {
    const body = assignedMessage(
      task,
      everyone.filter((p) => p.id !== person.id).map((p) => p.name),
      link,
    );

    if (!person.slackId) {
      sent.push({ personId: person.id, name: person.name, ok: false, error: 'no_slack_id' });
      await record(task.id, person.id, actor, body, chosen.asHimself, {
        ok: false,
        messageUrl: null,
        error: 'no_slack_id',
      }, 'assigned');
      continue;
    }

    const result = await chosen.slack
      .postMessage({
        target: person.slackId,
        text: body,
        ...(chosen.asHimself
          ? {}
          : {
              username: deps?.sender?.name ?? 'מאור',
              ...(deps?.sender?.iconUrl ? { iconUrl: deps.sender.iconUrl } : { icon: ':wave:' }),
            }),
      })
      .catch((e: unknown) => ({
        ok: false as const,
        messageUrl: null,
        error: e instanceof Error ? e.message : 'unknown',
      }));

    sent.push({
      personId: person.id,
      name: person.name,
      ok: result.ok,
      ...(result.ok ? { messageUrl: result.messageUrl } : { error: result.error }),
    });
    await record(task.id, person.id, actor, body, chosen.asHimself, result, 'assigned');
  }

  await writeAudit({
    actor,
    action: 'task.assigned_notified',
    entityType: 'task',
    entityId: task.id,
    before: null,
    after: { to: sent.map((s) => ({ name: s.name, ok: s.ok, error: s.error })) },
  });

  return sent;
}

export async function nudgeTask(
  taskId: string,
  actor: string,
  note: string | null,
  deps?: { slack?: SlackAdapter; asHimself?: boolean; sender?: { name: string; iconUrl?: string } },
): Promise<NudgeResult> {
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) throw new Error('No task with that id');

  const who = await assigneesOf(taskId);
  const chosen = deps?.slack
    ? { slack: deps.slack, asHimself: deps.asHimself ?? false }
    : await signer();

  const body = nudgeMessage(task.title, note);
  const sent: NudgeOutcome[] = [];

  for (const person of who) {
    if (!person.slackId) {
      sent.push({ personId: person.id, name: person.name, ok: false, error: 'no_slack_id' });
      await record(task.id, person.id, actor, body, chosen.asHimself, {
        ok: false,
        messageUrl: null,
        error: 'no_slack_id',
      });
      continue;
    }

    const result = await chosen.slack
      .postMessage({
        target: person.slackId,
        text: body,
        /*
         * A bot posting in his name needs to be told the name; his own token
         * already is him, and setting a username on a user post is ignored at
         * best and rejected at worst.
         */
        ...(chosen.asHimself
          ? {}
          : {
              username: deps?.sender?.name ?? 'מאור',
              ...(deps?.sender?.iconUrl ? { iconUrl: deps.sender.iconUrl } : { icon: ':wave:' }),
            }),
      })
      .catch((e: unknown) => ({
        ok: false as const,
        messageUrl: null,
        error: e instanceof Error ? e.message : 'unknown',
      }));

    sent.push({
      personId: person.id,
      name: person.name,
      ok: result.ok,
      ...(result.ok ? { messageUrl: result.messageUrl } : { error: result.error }),
    });
    await record(task.id, person.id, actor, body, chosen.asHimself, result);
  }

  const anyOk = sent.some((s) => s.ok);
  await (anyOk ? recordSuccess('slack') : recordFailure('slack', sent[0]?.error ?? 'nudge_failed'));

  await writeAudit({
    actor,
    action: 'task.nudge',
    entityType: 'task',
    entityId: task.id,
    before: null,
    after: {
      asHimself: chosen.asHimself,
      to: sent.map((s) => ({ name: s.name, ok: s.ok, error: s.error })),
    },
  });

  return { sent, asHimself: chosen.asHimself };
}

async function record(
  taskId: string,
  personId: string,
  actor: string,
  body: string,
  asHimself: boolean,
  result: { ok: boolean; messageUrl?: string | null; error?: string; channelId?: string | null; ts?: string | null },
  kind: 'nudge' | 'assigned' = 'nudge',
): Promise<void> {
  await db.insert(taskNudges).values({
    taskId,
    personId,
    actor,
    kind,
    body,
    asHimself,
    delivered: result.ok,
    error: result.ok ? null : (result.error ?? 'unknown'),
    messageUrl: result.messageUrl ?? null,
    channelId: result.channelId ?? null,
    messageTs: result.ts ?? null,
  });
}

export interface NudgeMark {
  sentAt: Date;
  names: string[];
  delivered: boolean;
}

/**
 * When each task was last chased, for the whole list at once.
 *
 * The button has to be able to say "asked 2 hours ago" — without it he presses
 * it again on Tuesday afternoon having pressed it on Tuesday morning, and the
 * person gets the same six words twice.
 */
export async function lastNudges(taskIds: string[]): Promise<Map<string, NudgeMark>> {
  const out = new Map<string, NudgeMark>();
  if (taskIds.length === 0) return out;

  const rows = await db
    .select({
      taskId: taskNudges.taskId,
      sentAt: taskNudges.sentAt,
      delivered: taskNudges.delivered,
      name: people.name,
    })
    .from(taskNudges)
    .innerJoin(people, eq(people.id, taskNudges.personId))
    // Chases only. The button says "last asked", and counting the hand-over
    // that created the task would have it claim he had already chased somebody
    // he had only just told.
    .where(and(inArray(taskNudges.taskId, taskIds), eq(taskNudges.kind, 'nudge')))
    .orderBy(desc(taskNudges.sentAt));

  for (const row of rows) {
    const held = out.get(row.taskId);
    // Rows arrive newest first, so the first one seen for a task is the last
    // chase; everything sent in that same push joins it.
    if (!held) {
      out.set(row.taskId, {
        sentAt: row.sentAt,
        names: [row.name],
        delivered: row.delivered,
      });
    } else if (held.sentAt.getTime() - row.sentAt.getTime() < 60_000) {
      held.names.push(row.name);
      held.delivered = held.delivered || row.delivered;
    }
  }
  return out;
}
