import type {
  FoundReply, SlackAdapter, SlackChannel, SlackHit, SlackMessage, SlackPostResult, ThreadMessage,
} from './types';

const SLACK_API = 'https://slack.com/api/chat.postMessage';
const SLACK_REPLIES = 'https://slack.com/api/conversations.replies';
const SLACK_USERS = 'https://slack.com/api/users.info';
const SLACK_OPEN = 'https://slack.com/api/conversations.open';
const SLACK_LIST = 'https://slack.com/api/conversations.list';
const SLACK_HISTORY = 'https://slack.com/api/conversations.history';
const SLACK_SEARCH = 'https://slack.com/api/search.messages';

/**
 * Slack permalinks carry the two things the API needs — the channel and the
 * message timestamp — so the delegation does not have to store them twice.
 * `…/archives/C123/p1712345678000100` is channel C123 at ts 1712345678.000100.
 */
export function parsePermalink(permalink: string): { channel: string; ts: string } | null {
  const m = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(permalink);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return { channel: m[1], ts: `${m[2]}.${m[3]}` };
}

/**
 * Slack's word for what went wrong, turned into the thing to do about it.
 *
 * `not_in_channel` is the one that matters. The cockpit can LIST every public
 * channel and post to none of them, because Slack only lets an app post where
 * it is a member — unless it holds chat:write.public. So a hand-over to a
 * channel offers seventy-nine of them and then fails, and "not_in_channel" on
 * the screen sends him looking at the channel rather than at the one scope
 * that fixes all of them at once.
 */
export function explainPostError(error: string): string {
  switch (error) {
    case 'not_in_channel':
      return 'not_in_channel — the bot is not in that channel. Add the chat:write.public scope at api.slack.com/apps → OAuth & Permissions (then Reinstall), or invite it with /invite @claud.';
    case 'channel_not_found':
      return 'channel_not_found — a private channel the bot has not been invited to, or one that was archived. Invite it with /invite @claud.';
    case 'missing_scope':
      return 'missing_scope — the bot needs another permission at api.slack.com/apps → OAuth & Permissions, then Reinstall.';
    default:
      return error;
  }
}

function buildBlocks(message: SlackMessage) {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: message.text } },
  ];
  const context = [...(message.contextLines ?? [])];
  if (message.backlinkUrl) context.push(`<${message.backlinkUrl}|Open in the cockpit>`);
  if (context.length > 0) {
    blocks.push({
      type: 'context',
      elements: context.map((t) => ({ type: 'mrkdwn', text: t })),
    });
  }
  return blocks;
}

class RealSlackAdapter implements SlackAdapter {
  readonly name = 'slack' as const;

  constructor(private readonly token: string) {}

  async postMessage(message: SlackMessage): Promise<SlackPostResult> {
    const res = await fetch(SLACK_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: message.target,
        text: message.text, // notification fallback
        blocks: buildBlocks(message),
        unfurl_links: false,
        // Only sent when asked for: an unset username leaves the app's own.
        ...(message.username ? { username: message.username } : {}),
        ...(message.icon ? { icon_emoji: message.icon } : {}),
      }),
    });

    // Slack answers 200 with ok:false on logical errors — check the body, not the status.
    const body: unknown = await res.json().catch(() => null);
    const parsed = body as { ok?: boolean; error?: string; ts?: string; channel?: string } | null;
    if (!parsed?.ok) {
      return { ok: false, messageUrl: null, error: explainPostError(parsed?.error ?? `http_${res.status}`) };
    }
    const permalink =
      parsed.ts && parsed.channel
        ? `https://slack.com/archives/${parsed.channel}/p${parsed.ts.replace('.', '')}`
        : null;
    return {
      ok: true,
      messageUrl: permalink,
      channelId: parsed.channel ?? null,
      ts: parsed.ts ?? null,
    };
  }

  /**
   * Slack returns ids, not names. One call per unseen id, cached for the life of
   * the adapter — a thread has a handful of participants, and resolving them
   * per message would be a call per line.
   */
  private readonly names = new Map<string, string>();

  private async userName(id: string | undefined): Promise<string> {
    if (!id) return 'Unknown';
    const cached = this.names.get(id);
    if (cached) return cached;

    const res = await fetch(`${SLACK_USERS}?user=${id}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; user?: { real_name?: string; name?: string } }
      | null;
    const name = body?.ok ? (body.user?.real_name ?? body.user?.name ?? id) : id;
    this.names.set(id, name);
    return name;
  }

  async openConversation(userIds: string[]) {
    const res = await fetch(SLACK_OPEN, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ users: userIds.join(',') }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; channel?: { id?: string } }
      | null;

    if (!body?.ok || !body.channel?.id) {
      return { ok: false, channelId: null, error: body?.error ?? `http_${res.status}` };
    }
    return { ok: true, channelId: body.channel.id };
  }

  async readThread(channelId: string, threadTs: string): Promise<ThreadMessage[]> {
    const url = `${SLACK_REPLIES}?channel=${channelId}&ts=${threadTs}&limit=200`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      messages?: { user?: string; bot_id?: string; text?: string; ts?: string }[];
    } | null;

    if (!body?.ok || !body.messages) throw new Error(body?.error ?? 'slack_thread_unreadable');

    const out: ThreadMessage[] = [];
    for (const m of body.messages) {
      if (!m.ts) continue;
      const fromCockpit = Boolean(m.bot_id);
      out.push({
        ts: m.ts,
        authorId: m.user ?? null,
        authorName: fromCockpit ? 'Cockpit' : await this.userName(m.user),
        text: m.text ?? '',
        at: new Date(Number(m.ts.split('.')[0]) * 1000),
        fromCockpit,
      });
    }
    return out;
  }

  async postThreadReply(
    channelId: string,
    threadTs: string,
    text: string,
  ): Promise<SlackPostResult> {
    const res = await fetch(SLACK_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: channelId, thread_ts: threadTs, text, unfurl_links: false }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; ts?: string; channel?: string }
      | null;

    if (!body?.ok) return { ok: false, messageUrl: null, error: body?.error ?? `http_${res.status}` };
    return {
      ok: true,
      messageUrl: body.ts ? `https://slack.com/archives/${channelId}/p${body.ts.replace('.', '')}` : null,
      channelId,
      ts: body.ts ?? null,
    };
  }

  /**
   * Every conversation the token can see.
   *
   * Slack pages this, and a workspace with hundreds of channels would page for
   * a long time; a few hundred is every channel he actually has and far more
   * than a model should be handed at once.
   */
  async listChannels(): Promise<SlackChannel[]> {
    const out: SlackChannel[] = [];
    let cursor = '';

    for (let page = 0; page < 5; page += 1) {
      const url =
        `${SLACK_LIST}?types=public_channel,private_channel&exclude_archived=true&limit=200` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        channels?: {
          id?: string; name?: string; is_private?: boolean; is_member?: boolean;
          num_members?: number; topic?: { value?: string }; purpose?: { value?: string };
        }[];
        response_metadata?: { next_cursor?: string };
      } | null;

      if (!body?.ok || !body.channels) throw new Error(body?.error ?? `http_${res.status}`);

      for (const c of body.channels) {
        if (!c.id || !c.name) continue;
        const isPrivate = c.is_private === true;
        const isMember = c.is_member === true;
        out.push({
          id: c.id,
          name: c.name,
          isPrivate,
          isMember,
          // A private channel is only listed at all when the bot is in it.
          readable: isMember || isPrivate,
          topic: c.topic?.value?.trim() || null,
          purpose: c.purpose?.value?.trim() || null,
          memberCount: typeof c.num_members === 'number' ? c.num_members : null,
        });
      }

      cursor = body.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readChannel(channelId: string, limit = 30): Promise<ThreadMessage[]> {
    const url = `${SLACK_HISTORY}?channel=${channelId}&limit=${Math.min(200, Math.max(1, limit))}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      messages?: { user?: string; bot_id?: string; username?: string; text?: string; ts?: string; subtype?: string }[];
    } | null;

    if (!body?.ok || !body.messages) throw new Error(body?.error ?? `http_${res.status}`);

    const out: ThreadMessage[] = [];
    // Slack hands history back newest first; a conversation reads the other way.
    for (const m of [...body.messages].reverse()) {
      if (!m.ts) continue;
      // Joins and leaves are not conversation.
      if (m.subtype === 'channel_join' || m.subtype === 'channel_leave') continue;
      const fromCockpit = Boolean(m.bot_id) && !m.user;
      out.push({
        ts: m.ts,
        authorId: m.user ?? null,
        authorName: fromCockpit ? (m.username ?? 'Cockpit') : await this.userName(m.user),
        text: m.text ?? '',
        at: new Date(Number(m.ts.split('.')[0]) * 1000),
        fromCockpit,
      });
    }
    return out;
  }

  /**
   * Slack's own search, which only a user token may call.
   *
   * It is the difference between "what the cockpit was invited to" and "his
   * Slack": a bot reads the handful of channels somebody added it to, a user
   * token searches everything he can see. The failure is left as Slack's own
   * word (`not_allowed_token_type`) so the caller can say what to do about it.
   */
  async searchMessages(query: string, count = 40): Promise<SlackHit[]> {
    const url = `${SLACK_SEARCH}?query=${encodeURIComponent(query)}&count=${Math.min(100, Math.max(1, count))}&sort=timestamp`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      messages?: { matches?: { channel?: { id?: string; name?: string }; username?: string; user?: string; text?: string; ts?: string; permalink?: string }[] };
    } | null;

    if (!body?.ok) throw new Error(body?.error ?? `http_${res.status}`);

    const hits: SlackHit[] = [];
    for (const m of body.messages?.matches ?? []) {
      if (!m.ts) continue;
      hits.push({
        channelId: m.channel?.id ?? '',
        channelName: m.channel?.name ?? 'unknown',
        authorName: m.username ?? (await this.userName(m.user)),
        text: m.text ?? '',
        at: new Date(Number(m.ts.split('.')[0]) * 1000),
        url: m.permalink ?? null,
      });
    }
    return hits;
  }

  /**
   * Their answer to a message the cockpit posted — in the thread, or not.
   *
   * It read the thread alone, and that is not how anybody answers a direct
   * message. A hand-over to one person goes to their DM, and a person replying
   * in a DM types into the conversation; they do not hover the message and
   * choose "reply in thread". So the answer arrived, sat there, and the
   * tracker went on saying nobody had replied.
   *
   * The thread first, because a threaded reply is unambiguously about this
   * ask; then the conversation itself, oldest first, so it reports the first
   * answer rather than the latest remark.
   */
  async findThreadReply(permalink: string, notFrom?: string): Promise<FoundReply | null> {
    const ref = parsePermalink(permalink);
    if (!ref) return null;

    const read = async (url: string) => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        messages?: { user?: string; bot_id?: string; text?: string; ts?: string }[];
      } | null;
      return body?.ok ? (body.messages ?? []) : [];
    };

    const theirs = (m: { user?: string; bot_id?: string; text?: string; ts?: string }) =>
      m.ts !== ref.ts && !m.bot_id && !(notFrom && m.user === notFrom) && Boolean(m.text?.trim()) && Boolean(m.ts);

    const found = (m: { user?: string; text?: string; ts?: string }): FoundReply => ({
      channel: 'slack',
      author: m.user ?? 'unknown',
      excerpt: m.text!.trim().slice(0, 500),
      at: new Date(Number(m.ts!.split('.')[0]) * 1000),
      url: `https://slack.com/archives/${ref.channel}/p${m.ts!.replace('.', '')}`,
    });

    const thread = await read(`${SLACK_REPLIES}?channel=${ref.channel}&ts=${ref.ts}&limit=50`);
    const inThread = thread.find(theirs);
    if (inThread) return found(inThread);

    const history = await read(
      `${SLACK_HISTORY}?channel=${ref.channel}&oldest=${ref.ts}&limit=50`,
    );
    const inChannel = [...history]
      .sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0))
      .find(theirs);
    return inChannel ? found(inChannel) : null;
  }
}

/** In-memory Slack. Tests assert against `sent`. */
export class FakeSlackAdapter implements SlackAdapter {
  readonly name = 'slack' as const;
  readonly sent: SlackMessage[] = [];
  failNext = false;

  async postMessage(message: SlackMessage): Promise<SlackPostResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, messageUrl: null, error: 'fake_failure' };
    }
    // Slack refuses a channel the bot was never added to, and so does this.
    const known = this.channels.find((c) => c.id === message.target);
    if (known && !known.isMember) return { ok: false, messageUrl: null, error: 'not_in_channel' };
    this.sent.push(message);
    return {
      ok: true,
      messageUrl: `https://slack.test/archives/${message.target}/p${this.sent.length}`,
      channelId: message.target,
      ts: `${this.sent.length}.000000`,
    };
  }

  /** Tests set this to the reply the next probe should find. */
  nextReply: FoundReply | null = null;
  /** And this to the conversation the next read should return. */
  thread: ThreadMessage[] = [];

  async findThreadReply(): Promise<FoundReply | null> {
    const reply = this.nextReply;
    this.nextReply = null;
    return reply;
  }

  /** Tests set this to make the group-conversation attempt fail. */
  openFailsWithMultipleUsers = false;

  async openConversation(userIds: string[]) {
    if (userIds.length > 1 && this.openFailsWithMultipleUsers) {
      return { ok: false, channelId: null, error: 'missing_scope' };
    }
    return { ok: true, channelId: `C${userIds.join('-')}` };
  }

  async readThread(): Promise<ThreadMessage[]> {
    return this.thread;
  }

  /** Tests set these to the workspace the next read should see. */
  channels: SlackChannel[] = [
    { id: 'C-GENERAL', name: 'general', isPrivate: false, isMember: true, readable: true, topic: null, purpose: null, memberCount: 12 },
  ];
  history = new Map<string, ThreadMessage[]>();

  async listChannels(): Promise<SlackChannel[]> {
    return this.channels;
  }

  async readChannel(channelId: string, limit = 30): Promise<ThreadMessage[]> {
    return (this.history.get(channelId) ?? []).slice(-limit);
  }

  /**
   * What the next search finds. Null — the default, and what a bot token does
   * in life — makes searching throw, so the caller's fallback is what tests
   * exercise unless they opt into search.
   */
  searchable: SlackHit[] | null = null;

  async searchMessages(query: string, count = 40): Promise<SlackHit[]> {
    if (this.searchable === null) throw new Error('not_allowed_token_type');
    const q = query.toLowerCase();
    return this.searchable.filter((h) => h.text.toLowerCase().includes(q)).slice(0, count);
  }

  async postThreadReply(channelId: string, threadTs: string, text: string): Promise<SlackPostResult> {
    this.sent.push({ target: channelId, text });
    const ts = `${this.sent.length}.000000`;
    this.thread.push({
      ts,
      authorId: null,
      authorName: 'Cockpit',
      text,
      at: new Date(),
      fromCockpit: true,
    });
    return { ok: true, messageUrl: null, channelId, ts };
  }
}

/**
 * Whether the workspace has granted the scopes needed to put the CEO in the
 * conversation as well as the person it was handed to.
 *
 * Read from the granted-scopes header on auth.test rather than by trying to
 * open a group conversation, because that attempt would create one as a side
 * effect.
 *
 * A yes is cached for the life of the process: a scope that has been granted is
 * not taken away mid-session. A no is only cached briefly, because "no" is
 * exactly the answer somebody is in the middle of fixing — caching it until the
 * next deploy means granting the scope appears to do nothing.
 */
const NO_RECHECK_AFTER_MS = 60_000;

let sharedThreads: { value: boolean; checkedAt: number } | null = null;

export async function slackCanShareThreads(): Promise<boolean> {
  if (sharedThreads?.value) return true;
  if (sharedThreads && Date.now() - sharedThreads.checkedAt < NO_RECHECK_AFTER_MS) return false;

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !process.env.SLACK_CEO_USER_ID) return false;

  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const scopes = (res.headers.get('x-oauth-scopes') ?? '').split(',').map((s) => s.trim());
    sharedThreads = { value: scopes.includes('mpim:write'), checkedAt: Date.now() };
    return sharedThreads.value;
  } catch {
    return false;
  }
}

/**
 * The Slack client. Pass a token to post as one of the per-subject bots; with
 * none it uses the shared cockpit bot.
 */
export function createSlackAdapter(token = process.env.SLACK_BOT_TOKEN): SlackAdapter {
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !token) return new FakeSlackAdapter();
  return new RealSlackAdapter(token);
}
