import { createSlackAdapter } from '@/lib/integrations/slack';
import { secret } from '@/lib/secrets/store';
import type { SlackAdapter, SlackChannel } from '@/lib/integrations/types';

/**
 * His Slack, as the copilot sees it.
 *
 * The chat asks for "#sales" or "what did the team say this week", not for a
 * channel id and a cursor — so the resolving, the paging and the trimming live
 * here, and the tools stay a thin description of what the model may ask for.
 *
 * Two things this deliberately does not do. It never reads a channel the bot
 * was not invited into: Slack lists every public channel in the workspace, and
 * offering to read one nobody added the cockpit to only ever produces
 * `not_in_channel`. And it never posts anywhere he did not name — a channel is
 * always resolved from what he wrote, never chosen by the model from the list.
 */

const CHANNELS_FRESH_FOR_MS = 5 * 60_000;

/**
 * Reading Slack takes a different token from writing it.
 *
 * The cockpit's bot can post anywhere it is invited, but a bot only ever sees
 * the channels somebody added it to — which is not "his Slack". A user token
 * (SLACK_USER_TOKEN, pasted on the Keys screen) sees everything he sees and
 * can use Slack's own search. So: read as him when that token is there, read
 * as the bot when it is not, and always post as the bot, because a message
 * from the cockpit should look like one.
 */
export const SLACK_READ_SCOPES = ['channels:read', 'groups:read', 'channels:history', 'groups:history'];

export function explainSlackError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes('missing_scope') || message.includes('not_allowed_token_type')) {
    return `Slack would not let the cockpit read that. Paste a Slack user token as SLACK_USER_TOKEN on the Keys screen and it reads everything you can see; otherwise the bot needs ${SLACK_READ_SCOPES.join(', ')} and an invitation to each channel.`;
  }
  if (message.includes('invalid_auth') || message.includes('token_revoked')) {
    return "Slack refused the cockpit's token — it needs reinstalling to the workspace.";
  }
  if (message.includes('not_in_channel')) return 'The cockpit is not in that channel — invite it there, or paste a Slack user token on the Keys screen.';
  if (message.includes('channel_not_found')) return 'Slack has no channel by that name that this token can see.';
  return `Slack said: ${message}`;
}

export interface SlackClient {
  slack: SlackAdapter;
  /** True when reading as him: every channel he is in, and Slack's own search. */
  asUser: boolean;
}

/**
 * The client the reading tools use. His token when he has pasted one.
 *
 * Not cached: the secret store caches the value itself, and a token pasted on
 * the Keys screen should work on the next question, not after a restart.
 */
export async function slackClient(): Promise<SlackClient> {
  const userToken = await secret('SLACK_USER_TOKEN');
  if (userToken) return { slack: createSlackAdapter(userToken), asUser: true };
  return { slack: createSlackAdapter(), asUser: false };
}

let cached: { at: number; channels: SlackChannel[] } | null = null;

/** Tests and the job runner reset this; nothing else should need to. */
export function forgetSlackChannels(): void {
  cached = null;
}

export async function slackChannels(slack?: SlackAdapter): Promise<SlackChannel[]> {
  if (cached && Date.now() - cached.at < CHANNELS_FRESH_FOR_MS) return cached.channels;
  const client = slack ?? (await slackClient()).slack;
  const channels = await client.listChannels();
  cached = { at: Date.now(), channels };
  return channels;
}

const ID = /^[CGD][A-Z0-9]{2,}$/;

/**
 * "#sales", "sales", "Sales" or the raw id — all of them are the sales channel.
 *
 * An exact name wins over a prefix, so a workspace with `sales` and
 * `sales-eu` resolves `sales` to the one he meant rather than to whichever
 * sorted first.
 */
export function resolveChannel(wanted: string, channels: SlackChannel[]): SlackChannel | null {
  const q = wanted.trim().replace(/^#/, '').toLowerCase();
  if (!q) return null;
  const byId = channels.find((c) => c.id === wanted.trim());
  if (byId) return byId;
  const exact = channels.find((c) => c.name.toLowerCase() === q);
  if (exact) return exact;
  const starts = channels.filter((c) => c.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return starts[0]!;
  const contains = channels.filter((c) => c.name.toLowerCase().includes(q));
  if (contains.length === 1) return contains[0]!;
  // An id he pasted that is not in the list is still worth trying: the bot can
  // be in a conversation that conversations.list does not return, a DM most of all.
  if (ID.test(wanted.trim())) {
    return { id: wanted.trim(), name: wanted.trim(), isPrivate: true, isMember: true, readable: true, topic: null, purpose: null, memberCount: null };
  }
  return null;
}

export interface SlackReach {
  /** Reading as him (his token) or as the bot (the channels it was invited to). */
  asUser: boolean;
  /** Channels it can actually read; null when it could not look. */
  channels: number | null;
  why: string | null;
}

/**
 * How far into Slack the cockpit can see, for the one line on the screen that
 * says so. A screen that silently shows nothing is indistinguishable from a
 * quiet company.
 */
export async function slackReach(): Promise<SlackReach> {
  const { asUser } = await slackClient();
  try {
    const channels = await slackChannels();
    return { asUser, channels: channels.filter((c) => c.readable).length, why: null };
  } catch (e) {
    return { asUser, channels: null, why: explainSlackError(e) };
  }
}

export interface SlackLine {
  channel: string;
  author: string;
  text: string;
  at: Date;
  fromCockpit: boolean;
  url: string | null;
}

export interface SlackReadResult {
  channelsRead: string[];
  /** Named but not readable, so the answer can say why it is missing. */
  skipped: { channel: string; why: string }[];
  lines: SlackLine[];
  /** True when Slack's own search answered, so "nothing" means nothing exists. */
  searched: boolean;
}

export interface SlackReadOptions {
  /** One channel by name or id. Omitted: every channel the cockpit is in. */
  channel?: string | null;
  /** Messages per channel. */
  limit?: number;
  /** Only lines containing this, case-insensitive. */
  q?: string | null;
  /** Only lines newer than this many hours. */
  sinceHours?: number | null;
  /** How many channels to sweep when none was named. */
  maxChannels?: number;
}

const permalink = (channelId: string, ts: string) =>
  `https://slack.com/archives/${channelId}/p${ts.replace('.', '')}`;

/**
 * What was said, in one channel or across the ones the cockpit is in.
 *
 * The sweep is bounded on both axes — channels and messages per channel —
 * because the result is going into a model's context, and a thousand lines of
 * Slack is a worse answer than fifty, not a better one.
 */
export async function readSlack(
  options: SlackReadOptions = {},
  injected?: SlackAdapter,
): Promise<SlackReadResult> {
  const slack = injected ?? (await slackClient()).slack;
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const maxChannels = Math.min(12, Math.max(1, options.maxChannels ?? 6));
  const needle = options.q?.trim().toLowerCase() || null;
  const since =
    typeof options.sinceHours === 'number' && options.sinceHours > 0
      ? new Date(Date.now() - options.sinceHours * 3_600_000)
      : null;

  /*
   * When he is looking for something rather than catching up, ask Slack.
   *
   * Search sees every conversation he is in, which a channel sweep never can,
   * and it costs one call instead of one per channel. It needs his own token,
   * so a bot-token cockpit falls through to the sweep below rather than
   * answering "nothing found" when the truth is "I could not look".
   */
  if (needle) {
    try {
      const query = [
        options.q!.trim(),
        options.channel?.trim() ? `in:#${options.channel.trim().replace(/^#/, '')}` : '',
        since ? `after:${since.toISOString().slice(0, 10)}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const hits = await slack.searchMessages(query, limit * 2);
      const lines = hits
        .filter((h) => !since || h.at >= since)
        .map((h) => ({
          channel: h.channelName,
          author: h.authorName,
          text: h.text,
          at: h.at,
          fromCockpit: false,
          url: h.url ?? (h.channelId ? permalink(h.channelId, `${Math.floor(h.at.getTime() / 1000)}.000000`) : null),
        }))
        .sort((a, b) => b.at.getTime() - a.at.getTime());
      return { channelsRead: [...new Set(lines.map((l) => l.channel))], skipped: [], lines, searched: true };
    } catch {
      // No user token, or Slack said no. Read what the cockpit can read.
    }
  }

  let all: SlackChannel[];
  try {
    all = await slackChannels(slack);
  } catch (e) {
    return { channelsRead: [], skipped: [{ channel: 'all', why: explainSlackError(e) }], lines: [], searched: false };
  }
  const skipped: { channel: string; why: string }[] = [];
  let targets: SlackChannel[];

  if (options.channel?.trim()) {
    const found = resolveChannel(options.channel, all);
    if (!found) {
      return { channelsRead: [], skipped: [{ channel: options.channel, why: 'no channel by that name' }], lines: [], searched: false };
    }
    if (!found.readable) {
      return { channelsRead: [], skipped: [{ channel: found.name, why: 'the cockpit was never added to it' }], lines: [], searched: false };
    }
    targets = [found];
  } else {
    const readable = all.filter((c) => c.readable);
    targets = readable
      .slice()
      .sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0))
      .slice(0, maxChannels);
    for (const c of readable.slice(maxChannels)) skipped.push({ channel: c.name, why: 'not in this sweep' });
  }

  const lines: SlackLine[] = [];
  const channelsRead: string[] = [];

  for (const channel of targets) {
    let messages;
    try {
      messages = await slack.readChannel(channel.id, limit);
    } catch (e) {
      skipped.push({ channel: channel.name, why: e instanceof Error ? e.message : 'unreadable' });
      continue;
    }
    channelsRead.push(channel.name);
    for (const m of messages) {
      if (!m.text.trim()) continue;
      if (since && m.at < since) continue;
      if (needle && !m.text.toLowerCase().includes(needle)) continue;
      lines.push({
        channel: channel.name,
        author: m.authorName,
        text: m.text,
        at: m.at,
        fromCockpit: m.fromCockpit,
        url: permalink(channel.id, m.ts),
      });
    }
  }

  lines.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { channelsRead, skipped, lines, searched: false };
}

export interface SlackPosted {
  ok: boolean;
  error?: string;
  channel?: string;
  url?: string | null;
}

/**
 * Saying something in Slack, as the cockpit.
 *
 * The channel has to resolve to one the cockpit is actually in — a post is the
 * one thing here the whole company sees, and "I posted it" for a message Slack
 * refused is the worst answer the copilot could give.
 */
export async function postToSlack(
  channelWanted: string,
  text: string,
  injected?: SlackAdapter,
): Promise<SlackPosted> {
  const body = text.trim();
  if (!body) return { ok: false, error: 'There is nothing to post.' };
  if (body.length > 3000) return { ok: false, error: 'Too long for one Slack message — say it in under 3000 characters.' };

  // Always the bot for posting, whatever token the reading side uses: a message
  // from the cockpit should look like one, not like him.
  const slack = injected ?? createSlackAdapter();

  /*
   * The name is resolved with whichever token can see the workspace, and the
   * message is sent with the bot's. A channel he can see but the bot was never
   * added to fails here, with the invitation to make.
   */
  let target = channelWanted.trim();
  let name = target.replace(/^#/, '');
  try {
    const found = resolveChannel(channelWanted, await slackChannels(injected));
    if (!found) return { ok: false, error: `No channel called "${channelWanted}".` };
    target = found.id;
    name = found.name;
  } catch {
    if (!ID.test(target)) {
      return {
        ok: false,
        error: `The cockpit cannot look channels up by name yet — paste a Slack user token on the Keys screen, or give the channel's id instead of "${channelWanted}".`,
      };
    }
  }

  const res = await slack.postMessage({ target, text: body });
  if (!res.ok) {
    return { ok: false, error: res.error === 'not_in_channel' ? `The cockpit is not in #${name} — invite it there first.` : (res.error ?? 'Slack refused it'), channel: name };
  }
  return { ok: true, channel: name, url: res.messageUrl };
}
