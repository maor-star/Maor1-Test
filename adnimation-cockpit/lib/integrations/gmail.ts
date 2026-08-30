import { createSign } from 'node:crypto';
import { z } from 'zod';
import type { FoundReply, GmailAdapter } from './types';

/**
 * Gmail, for the delegation reply radar only.
 *
 * The cockpit reads one mailbox — the CEO's — looking for an answer to
 * something he handed off. It never sends, never labels, never deletes; the
 * scope requested is read-only for exactly that reason.
 *
 * Auth is a Google Workspace service account with domain-wide delegation,
 * impersonating the mailbox owner. That is a signed JWT exchanged for an access
 * token, which is ninety lines of code and no dependency, rather than the whole
 * googleapis client.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const listSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).optional(),
});

const headerSchema = z.object({ name: z.string(), value: z.string() });

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  internalDate: z.string().optional(),
  snippet: z.string().optional(),
  payload: z
    .object({ headers: z.array(headerSchema).optional() })
    .optional(),
});

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

class RealGmailAdapter implements GmailAdapter {
  readonly name = 'gmail' as const;
  readonly configured = true;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: z.infer<typeof serviceAccountSchema>,
    private readonly impersonate: string,
  ) {}

  private async accessToken(): Promise<string> {
    // A minute of slack on the expiry, so a token never dies mid-request.
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.credentials.client_email,
        sub: this.impersonate,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    );

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = base64url(signer.sign(this.credentials.private_key.replace(/\\n/g, '\n')));
    const assertion = `${header}.${claims}.${signature}`;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error_description?: string }
      | null;

    if (!body?.access_token) {
      throw new Error(`Gmail auth failed: ${body?.error_description ?? `http_${res.status}`}`);
    }

    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  private async get(path: string): Promise<unknown> {
    const token = await this.accessToken();
    const res = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Gmail ${path} returned ${res.status}`);
    return res.json();
  }

  async findReply({
    fromEmail,
    since,
    terms,
  }: {
    fromEmail: string;
    since: Date;
    terms: string[];
  }): Promise<FoundReply | null> {
    // Gmail's `after:` takes whole seconds; a day of margin costs nothing and
    // avoids losing a reply to a timezone edge. The date filter is narrowed
    // exactly below, against internalDate.
    const afterSeconds = Math.floor(since.getTime() / 1000);
    const query = [`from:${fromEmail}`, `after:${afterSeconds}`].join(' ');

    const list = listSchema.parse(
      await this.get(`/messages?maxResults=20&q=${encodeURIComponent(query)}`),
    );
    if (!list.messages?.length) return null;

    const needles = terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 4);

    for (const ref of list.messages) {
      const message = messageSchema.parse(
        await this.get(`/messages/${ref.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`),
      );

      const at = new Date(Number(message.internalDate ?? 0));
      if (at.getTime() <= since.getTime()) continue;

      const headers = message.payload?.headers ?? [];
      const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
      const author = headers.find((h) => h.name.toLowerCase() === 'from')?.value ?? fromEmail;
      const haystack = `${subject} ${message.snippet ?? ''}`.toLowerCase();

      // With no usable terms, any mail from that person after the hand-off is
      // the answer. With terms, one has to actually appear.
      if (needles.length > 0 && !needles.some((n) => haystack.includes(n))) continue;

      return {
        channel: 'email',
        author,
        excerpt: [subject, message.snippet].filter(Boolean).join(' — ').slice(0, 500),
        at,
        url: `https://mail.google.com/mail/u/0/#inbox/${message.threadId}`,
      };
    }

    return null;
  }
}

/** In-memory Gmail. Tests set `nextReply`; nothing touches the network. */
export class FakeGmailAdapter implements GmailAdapter {
  readonly name = 'gmail' as const;
  readonly configured = false;
  nextReply: FoundReply | null = null;

  async findReply(): Promise<FoundReply | null> {
    const reply = this.nextReply;
    this.nextReply = null;
    return reply;
  }
}

/**
 * The service-account key is JSON full of quotes and newlines, and it has to
 * survive a systemd EnvironmentFile, which has its own opinions about both. So
 * base64 is accepted as well as raw JSON — that is what the deploy actually
 * stores, and raw JSON still works for anyone setting it by hand.
 */
export function readServiceAccountKey(raw: string): unknown {
  const text = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
}

export function createGmailAdapter(): GmailAdapter {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const mailbox = process.env.GMAIL_MAILBOX ?? process.env.OWNER_EMAIL;
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !raw || !mailbox) return new FakeGmailAdapter();

  try {
    const parsed = serviceAccountSchema.safeParse(readServiceAccountKey(raw));
    if (!parsed.success) return new FakeGmailAdapter();
    return new RealGmailAdapter(parsed.data, mailbox);
  } catch {
    // A malformed key must not take the app down on boot — the radar simply
    // reports itself unconfigured, which is what the screen already handles.
    return new FakeGmailAdapter();
  }
}
