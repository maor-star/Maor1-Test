import type {
  FoundReply, SlackAdapter, SlackMessage, SlackPostResult, ThreadMessage,
} from './types';

const SLACK_API = 'https://slack.com/api/chat.postMessage';
const SLACK_REPLIES = 'https://slack.com/api/conversations.replies';
const SLACK_USERS = 'https://slack.com/api/users.info';

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
      }),
    });

    // Slack answers 200 with ok:false on logical errors — check the body, not the status.
    const body: unknown = await res.json().catch(() => null);
    const parsed = body as { ok?: boolean; error?: string; ts?: string; channel?: string } | null;
    if (!parsed?.ok) {
      return { ok: false, messageUrl: null, error: parsed?.error ?? `http_${res.status}` };
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

  async findThreadReply(permalink: string, notFrom?: string): Promise<FoundReply | null> {
    const ref = parsePermalink(permalink);
    if (!ref) return null;

    const url = `${SLACK_REPLIES}?channel=${ref.channel}&ts=${ref.ts}&limit=50`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      messages?: { user?: string; bot_id?: string; text?: string; ts?: string }[];
    } | null;
    if (!body?.ok || !body.messages) return null;

    for (const m of body.messages) {
      // The parent message is the cockpit's own post, and so is anything from
      // the bot. A reply is somebody else answering.
      if (m.ts === ref.ts || m.bot_id) continue;
      if (notFrom && m.user === notFrom) continue;
      if (!m.text?.trim() || !m.ts) continue;

      return {
        channel: 'slack',
        author: m.user ?? 'unknown',
        excerpt: m.text.trim().slice(0, 500),
        at: new Date(Number(m.ts.split('.')[0]) * 1000),
        url: `https://slack.com/archives/${ref.channel}/p${m.ts.replace('.', '')}`,
      };
    }
    return null;
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

  async readThread(): Promise<ThreadMessage[]> {
    return this.thread;
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

export function createSlackAdapter(): SlackAdapter {
  const token = process.env.SLACK_BOT_TOKEN;
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !token) return new FakeSlackAdapter();
  return new RealSlackAdapter(token);
}
