import type { SlackAdapter, SlackMessage, SlackPostResult } from './types';

const SLACK_API = 'https://slack.com/api/chat.postMessage';

function buildBlocks(message: SlackMessage) {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: message.text } },
  ];
  const context = [...(message.contextLines ?? [])];
  if (message.backlinkUrl) context.push(`<${message.backlinkUrl}|פתיחה בקוקפיט>`);
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
    return { ok: true, messageUrl: permalink };
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
    };
  }
}

export function createSlackAdapter(): SlackAdapter {
  const token = process.env.SLACK_BOT_TOKEN;
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !token) return new FakeSlackAdapter();
  return new RealSlackAdapter(token);
}
