import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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

/**
 * Whether this assignee is the person doing the assigning.
 *
 * Matched on the address rather than an id, because the actor is the email
 * from the session and the assignee is a row in `people` — the two only ever
 * meet by address.
 */
const isActor = (person: { email: string }, actor: string): boolean =>
  person.email.trim().toLowerCase() === actor.trim().toLowerCase();

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

  /*
   * Never himself.
   *
   * Putting his own name on a task is not handing it to anybody, and the
   * cockpit sent him "over to you please, thanks, Maor" from himself the first
   * morning this ran. A message a person sends themselves is pure noise, and
   * it is the kind that teaches people to stop reading the channel it arrives
   * in.
   */
  const everyone = await assigneesOf(taskId);
  const newcomers = everyone.filter(
    (p) => personIds.includes(p.id) && !isActor(p, actor),
  );
  if (newcomers.length === 0) return [];

  const chosen = deps?.slack
    ? { slack: deps.slack, asHimself: deps.asHimself ?? false }
    : await signer();

  const base = process.env.APP_URL ?? process.env.AUTH_URL ?? null;
  const link = base ? `${base.replace(/\/+$/, '')}/tasks/${task.id}` : null;

  const sentAt = new Date();
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
      }, 'assigned', sentAt);
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
    await record(task.id, person.id, actor, body, chosen.asHimself, result, 'assigned', sentAt);
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

/**
 * An update he wrote, passed on to the people carrying the task.
 *
 * Writing it down and telling them are two different acts, so this is opt-in:
 * the note is saved either way, and the checkbox decides whether it also
 * leaves the building. Most updates are for the record; the ones worth a
 * message are the ones he ticks.
 *
 * Never to himself, and never about a starred task — the same two rules the
 * hand-over and the chase follow.
 */
export function updateMessage(title: string, body: string, link: string | null): string {
  return [
    `*${title.trim()}*`,
    '',
    body.trim(),
    link ? `\n${link}` : '',
    '',
    'מאור',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function notifyUpdate(
  taskId: string,
  body: string,
  actor: string,
  deps?: { slack?: SlackAdapter; asHimself?: boolean; sender?: { name: string; iconUrl?: string } },
): Promise<NudgeOutcome[]> {
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title, isPrivate: tasks.isPrivate })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task || task.isPrivate) return [];

  const who = (await assigneesOf(taskId)).filter((p) => !isActor(p, actor));
  if (who.length === 0) return [];

  const chosen = deps?.slack
    ? { slack: deps.slack, asHimself: deps.asHimself ?? false }
    : await signer();

  const base = process.env.APP_URL ?? process.env.AUTH_URL ?? null;
  const text = updateMessage(
    task.title,
    body,
    base ? `${base.replace(/\/+$/, '')}/tasks/${task.id}` : null,
  );
  const sentAt = new Date();
  const sent: NudgeOutcome[] = [];

  for (const person of who) {
    if (!person.slackId) {
      sent.push({ personId: person.id, name: person.name, ok: false, error: 'no_slack_id' });
      await record(task.id, person.id, actor, text, chosen.asHimself, {
        ok: false, messageUrl: null, error: 'no_slack_id',
      }, 'update', sentAt);
      continue;
    }

    const result = await chosen.slack
      .postMessage({
        target: person.slackId,
        text,
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
    await record(task.id, person.id, actor, text, chosen.asHimself, result, 'update', sentAt);
  }

  await writeAudit({
    actor,
    action: 'task.update_notified',
    entityType: 'task',
    entityId: task.id,
    before: null,
    after: { to: sent.map((x) => ({ name: x.name, ok: x.ok, error: x.error })) },
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

  // Chasing himself is the same noise as handing himself a task; see above.
  const who = (await assigneesOf(taskId)).filter((p) => !isActor(p, actor));
  if (who.length === 0) return { sent: [], asHimself: false };

  const chosen = deps?.slack
    ? { slack: deps.slack, asHimself: deps.asHimself ?? false }
    : await signer();

  const body = nudgeMessage(task.title, note);
  const sentAt = new Date();
  const sent: NudgeOutcome[] = [];

  for (const person of who) {
    if (!person.slackId) {
      sent.push({ personId: person.id, name: person.name, ok: false, error: 'no_slack_id' });
      await record(task.id, person.id, actor, body, chosen.asHimself, {
        ok: false,
        messageUrl: null,
        error: 'no_slack_id',
      }, 'nudge', sentAt);
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
    await record(task.id, person.id, actor, body, chosen.asHimself, result, 'nudge', sentAt);
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
  kind: 'nudge' | 'assigned' | 'update' = 'nudge',
  /*
   * One press, one timestamp — shared by every row it writes.
   *
   * A press sends a message per person, and those inserts land microseconds
   * apart. Letting each take its own now() made "how many times did I chase
   * this" a question about clock ticks: counting rows said four for two
   * presses on a shared task, and rounding to the minute said one for two
   * presses a moment apart. Stamping the push once makes the count exact.
   */
  sentAt: Date = new Date(),
): Promise<void> {
  await db.insert(taskNudges).values({
    taskId,
    personId,
    actor,
    kind,
    body,
    sentAt,
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
  /**
   * How many separate times he has chased this task.
   *
   * Worth counting rather than just dating: "asked 3 times" is a fact about
   * the task, not about the button. A thing he has had to chase three times
   * is not waiting on the other person's inbox any more, and the row should
   * say so out loud instead of making him remember it.
   */
  times: number;
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

  /*
   * How many separate presses, not how many messages.
   *
   * One press sends a message per person and stamps every row it writes with
   * the same instant (see record), so distinct timestamps are exactly the
   * presses — two people chased twice is 2, not 4.
   */
  const pushes = await db
    .select({
      taskId: taskNudges.taskId,
      times: sql<number>`count(distinct ${taskNudges.sentAt})::int`,
    })
    .from(taskNudges)
    .where(and(inArray(taskNudges.taskId, taskIds), eq(taskNudges.kind, 'nudge')))
    .groupBy(taskNudges.taskId);
  const timesByTask = new Map(pushes.map((p) => [p.taskId, p.times]));

  for (const row of rows) {
    const held = out.get(row.taskId);
    // Rows arrive newest first, so the first one seen for a task is the last
    // chase; everything sent in that same push joins it.
    if (!held) {
      out.set(row.taskId, {
        sentAt: row.sentAt,
        names: [row.name],
        delivered: row.delivered,
        times: timesByTask.get(row.taskId) ?? 1,
      });
    } else if (held.sentAt.getTime() === row.sentAt.getTime()) {
      // Same press, another recipient — rows of one press share the stamp.
      held.names.push(row.name);
      held.delivered = held.delivered || row.delivered;
    }
  }
  return out;
}
