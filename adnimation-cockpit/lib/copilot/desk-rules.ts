/**
 * The desk: what is owed, in what order, and what pressing the button does.
 *
 * The rules live apart from the gathering so they can be tested without a
 * database and without a model — which matters, because these are the rules
 * that decide what he is shown first thing in the morning and what a click
 * commits him to.
 */

export const DESK_CHANNELS = ['mail', 'slack', 'contract', 'deal', 'task', 'delegation'] as const;
export type DeskChannel = (typeof DESK_CHANNELS)[number];

export const CHANNEL_LABEL: Record<DeskChannel, string> = {
  mail: 'MAIL',
  slack: 'SLACK',
  contract: 'CONTRACT',
  deal: 'DEAL',
  task: 'TASK',
  delegation: 'HANDED OVER',
};

/**
 * What the first button on a card does.
 *
 * `send` leaves the company — mail out, a Slack message — so it is always the
 * text he can read and change before it goes. `do` changes something inside
 * the cockpit and nobody outside sees it. `review` is a judgement to make, not
 * a message to send: a contract he has to say yes or no to.
 */
export type DeskAct = 'send' | 'do' | 'review';

export interface DeskItem {
  /** `channel:key` — stable between reloads, which is what a stored draft is filed under. */
  id: string;
  channel: DeskChannel;
  /** Who it is with. */
  who: string;
  /** What it is. */
  title: string;
  /** The last thing said, or the state it is stuck in. */
  context: string;
  /** How long it has been waiting on him. */
  waitingDays: number;
  /** Where it lives, so he can go and look at the real thing. */
  url: string | null;
  /** The record behind it, where there is one — what a delegation hangs off. */
  entityId: string | null;
  entityType: 'task' | 'deal' | 'contract' | null;
  act: DeskAct;
  /** Where a `send` goes: a mail thread id, or a Slack channel. */
  target: string | null;
  /**
   * What changed last, so a draft written against an older version of the
   * conversation is known to be stale rather than shown as current.
   */
  fingerprint: string;
}

/**
 * How loudly a channel asks.
 *
 * Somebody waiting on an answer outranks a record that has gone quiet: a
 * person notices the silence, a deal does not. Contracts sit at the top of
 * that because they are the ones with a counterparty who has already done
 * their half.
 */
const WEIGHT: Record<DeskChannel, number> = {
  contract: 5,
  mail: 4,
  slack: 4,
  delegation: 3,
  deal: 2,
  task: 1,
};

/** Days after which a thing that has been waiting stops getting louder. */
const PATIENCE = 21;

/**
 * How much attention one item deserves — the channel's weight, plus how long
 * it has been sitting. Capped, so a mail from March cannot bury everything
 * that arrived this morning.
 */
export function urgency(item: Pick<DeskItem, 'channel' | 'waitingDays'>): number {
  const waited = Math.min(Math.max(item.waitingDays, 0), PATIENCE);
  return WEIGHT[item.channel] * 10 + waited;
}

/** Loudest first, and the same order every time for anything tied. */
export function deskOrder<T extends Pick<DeskItem, 'channel' | 'waitingDays' | 'id'>>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => urgency(b) - urgency(a) || a.id.localeCompare(b.id));
}

/** The id a draft is filed under. */
export function deskId(channel: DeskChannel, key: string): string {
  return `${channel}:${key}`;
}

/** The channel and key back out of an id, or null if it is not one of ours. */
export function parseDeskId(id: string): { channel: DeskChannel; key: string } | null {
  const at = id.indexOf(':');
  if (at <= 0) return null;
  const channel = id.slice(0, at) as DeskChannel;
  if (!DESK_CHANNELS.includes(channel)) return null;
  const key = id.slice(at + 1);
  return key ? { channel, key } : null;
}

/**
 * Whether a stored draft still answers the thing in front of him.
 *
 * A draft written before their last message answers a conversation that has
 * moved on, and sending it would be worse than having no draft at all.
 */
export function draftIsCurrent(
  draftFingerprint: string | null | undefined,
  item: Pick<DeskItem, 'fingerprint'>,
): boolean {
  return !!draftFingerprint && draftFingerprint === item.fingerprint;
}

/**
 * Where the follow-up belongs once he has acted.
 *
 * Handing it to a person is a delegation to chase; anything on a deal belongs
 * on that deal, where the board will notice it going quiet; everything else
 * becomes a task of his own. Nothing is ever acted on and then dropped — that
 * is the whole point of pressing the button here rather than in Gmail.
 */
export function followUpHome(
  item: Pick<DeskItem, 'channel' | 'entityType'>,
  handedToSomeone: boolean,
): 'delegation' | 'deal' | 'task' {
  if (handedToSomeone) return 'delegation';
  if (item.entityType === 'deal') return 'deal';
  return 'task';
}

/**
 * What the button says.
 *
 * The words are the promise: SEND IT puts something in front of another human
 * being, and it should never be the label on a button that only files a note.
 */
export function actLabel(item: Pick<DeskItem, 'act' | 'channel'>): string {
  if (item.act === 'send') return item.channel === 'mail' ? 'SEND THE REPLY' : 'POST IT';
  if (item.act === 'review') return 'RECORD MY DECISION';
  return 'DO IT';
}
