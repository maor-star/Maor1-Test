import { listMail } from '@/lib/mail/service';
import { listContracts } from '@/lib/contracts/intake-module';
import { listPipeline } from '@/lib/pipeline/service';
import { listTasks } from '@/lib/tasks/queries';
import { listDelegations } from '@/lib/delegation/module';
import { readSlack, type SlackLine } from '@/lib/copilot/slack-view';
import { deskId, deskOrder, type DeskItem } from '@/lib/copilot/desk-rules';

/**
 * Everything that is waiting on him, from every place it waits.
 *
 * The cockpit already knew all of this — it was spread over six screens, and
 * knowing it meant visiting all six and remembering what was on the ones you
 * had left. This is the same data asked one question: what is owed, by me,
 * right now.
 *
 * Every source is optional. Slack can be unreachable, the mail mirror can be
 * behind, and the desk still renders with what it has and says which part is
 * missing — a screen that shows nothing because one integration is down is
 * indistinguishable from a quiet week.
 */

const DAY = 86_400_000;
const daysSince = (at: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY));

export interface Desk {
  items: DeskItem[];
  /** What could not be looked at, said out loud. */
  gaps: string[];
}

/** How many of each channel reach the desk. Beyond this it stops being a desk. */
const PER_CHANNEL = 12;

export async function collectDesk(now = new Date()): Promise<Desk> {
  const gaps: string[] = [];

  const [mail, contracts, deals, tasks, handed, slack] = await Promise.all([
    listMail('waiting', 60).catch(() => {
      gaps.push('The mail mirror did not answer.');
      return [];
    }),
    listContracts('all', now).catch(() => {
      gaps.push('The contracts board did not answer.');
      return [];
    }),
    listPipeline({}).catch(() => {
      gaps.push('The deals board did not answer.');
      return [];
    }),
    listTasks({}).catch(() => {
      gaps.push('The task list did not answer.');
      return [];
    }),
    listDelegations('stuck', now).catch(() => {
      gaps.push('The delegation tracker did not answer.');
      return [];
    }),
    // Slack is the one that can hang. Three seconds, then the desk goes on
    // without it and says so.
    Promise.race([
      readSlack({ limit: 20, maxChannels: 6, sinceHours: 72 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
    ]).catch(() => null),
  ]);

  if (!slack) gaps.push('Slack did not answer in time, so nothing from it is on the desk.');

  const items: DeskItem[] = [];

  /* Mail: the last word is theirs and nobody has answered. */
  for (const m of mail.filter((r) => !r.lastFromMe && r.dismissedAt === null).slice(0, PER_CHANNEL)) {
    items.push({
      id: deskId('mail', m.threadId),
      channel: 'mail',
      who: m.counterpartName ?? m.counterpartEmail ?? 'Unknown sender',
      title: m.subject?.trim() || '(no subject)',
      context: m.snippet ?? '',
      waitingDays: m.daysWaiting,
      url: m.url,
      entityId: null,
      entityType: null,
      act: 'send',
      target: m.threadId,
      fingerprint: m.lastMessageAt.toISOString(),
    });
  }

  /*
   * Contracts where the move is his: unclassified, in review, or explicitly
   * marked as waiting on him. A contract sitting in "with them" is not on the
   * desk — chasing it is a different job, and the chaser agent has it.
   */
  for (const c of contracts
    .filter(
      (r) =>
        r.status !== 'signed' &&
        (r.waitingOn === 'you' || r.status === 'unclassified' || !r.categoryConfirmed),
    )
    .slice(0, PER_CHANNEL)) {
    items.push({
      id: deskId('contract', c.id),
      channel: 'contract',
      who: c.counterpartyName,
      title: c.docType || 'A contract',
      context: [
        c.statusLabel,
        c.notes ?? '',
        c.versions.length > 0 ? `${c.versions.length} version(s) on file` : 'nothing on file yet',
      ]
        .filter(Boolean)
        .join(' · '),
      waitingDays: c.daysInStatus,
      url: c.sourceUrl,
      entityId: c.id,
      entityType: 'contract',
      act: 'review',
      target: null,
      fingerprint: `${c.status}:${c.versions.length}:${c.daysInStatus}`,
    });
  }

  /* Deals whose next move is late, or that have gone quiet. */
  for (const d of deals
    .filter((r) => r.closedAt === null && (r.stepOverdue || r.quietDays === null || r.quietDays >= 14))
    .slice(0, PER_CHANNEL)) {
    items.push({
      id: deskId('deal', d.id),
      channel: 'deal',
      who: d.name,
      title: d.nextStep?.trim() || 'No next move set',
      context: [
        d.stage,
        d.nextStepDate ? `due ${d.nextStepDate}` : 'no date',
        d.quietDays === null ? 'never touched' : `${d.quietDays}d since the last contact`,
      ].join(' · '),
      waitingDays: d.quietDays ?? 30,
      url: `/pipeline?q=${encodeURIComponent(d.name)}`,
      entityId: d.id,
      entityType: 'deal',
      act: 'do',
      target: null,
      fingerprint: `${d.stage}:${d.nextStep ?? ''}:${d.nextStepDate ?? ''}`,
    });
  }

  /* His own tasks that are overdue. */
  const today = now.toISOString().slice(0, 10);
  for (const t of tasks
    .filter((r) => r.status !== 'done' && r.dueDate !== null && r.dueDate < today)
    .slice(0, PER_CHANNEL)) {
    items.push({
      id: deskId('task', t.id),
      channel: 'task',
      who: t.ownerName ?? 'Me',
      title: t.title,
      context: [`due ${t.dueDate}`, t.nextStep ? `next: ${t.nextStep}` : ''].filter(Boolean).join(' · '),
      waitingDays: t.dueDate ? daysSince(new Date(`${t.dueDate}T00:00:00Z`), now) : 0,
      url: `/tasks/${t.id}`,
      entityId: t.id,
      entityType: 'task',
      act: 'do',
      target: null,
      fingerprint: `${t.status}:${t.dueDate ?? ''}:${t.nextStep ?? ''}`,
    });
  }

  /*
   * Work he handed over that has gone quiet. The tracker already knows which
   * ones those are — "stuck" is its own word for handed over, nothing back,
   * and past the point where that is normal.
   */
  for (const h of handed.slice(0, PER_CHANNEL)) {
    items.push({
      id: deskId('delegation', h.id),
      channel: 'delegation',
      who: h.personName,
      title: h.title,
      context: `handed over ${daysSince(h.delegatedAt, now)}d ago · nothing back${
        h.nudgeCount > 0 ? ` · chased ${h.nudgeCount}x` : ''
      }`,
      waitingDays: h.daysQuiet,
      url: '/delegations',
      entityId: null,
      entityType: null,
      act: 'send',
      target: h.slackChannelId,
      fingerprint: h.lastMovementAt.toISOString(),
    });
  }

  /* Slack: somebody addressed the company and the cockpit sees no answer after it. */
  for (const line of slack ? unanswered(slack.lines, now) : []) {
    items.push({
      id: deskId('slack', `${line.channel}:${line.at.getTime()}`),
      channel: 'slack',
      who: line.author,
      title: `#${line.channel}`,
      context: line.text,
      waitingDays: daysSince(line.at, now),
      url: line.url,
      entityId: null,
      entityType: null,
      act: 'send',
      target: line.channel,
      fingerprint: line.at.toISOString(),
    });
  }

  return { items: deskOrder(items), gaps };
}

/**
 * A question in Slack with nothing after it.
 *
 * Crude on purpose: the cockpit is not in every channel and cannot tell who a
 * message was aimed at. It looks for a message that asks something, from
 * somebody other than the cockpit, that nobody in the channel said anything
 * after. That is wrong sometimes — and a card he skips costs a glance, while a
 * question nobody answered for a week costs a customer.
 */
function unanswered(lines: SlackLine[], now: Date): SlackLine[] {
  const byChannel = new Map<string, SlackLine[]>();
  for (const line of lines) {
    const list = byChannel.get(line.channel) ?? [];
    list.push(line);
    byChannel.set(line.channel, list);
  }

  const out: SlackLine[] = [];
  for (const list of byChannel.values()) {
    const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    const last = sorted[sorted.length - 1];
    if (!last || last.fromCockpit) continue;
    if (!last.text.includes('?') && !/\?|מה |מתי |אפשר |האם /.test(last.text)) continue;
    if (daysSince(last.at, now) > 14) continue;
    out.push(last);
  }
  return out.slice(0, PER_CHANNEL);
}

/** One item by id, for an action that has to work against the same list he saw. */
export async function deskItem(id: string, now = new Date()): Promise<DeskItem | null> {
  const desk = await collectDesk(now);
  return desk.items.find((i) => i.id === id) ?? null;
}
