import { createSign } from 'node:crypto';
import { z } from 'zod';
import { readServiceAccountKey, type MimePart } from '@/lib/integrations/gmail';

/**
 * Reading one conversation, in full.
 *
 * The mirror keeps a snippet — enough to list a thread, nowhere near enough to
 * answer one. Drafting a reply from a snippet is drafting a reply to the first
 * sentence of a conversation, which is how you agree to something you never
 * read.
 *
 * Its own token for its own scope, for the same reason sending has one: a
 * domain-wide delegation request for a scope that has not been granted fails
 * the whole request, so asking for read and send together would take the
 * mailbox down the day one of them changed.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const base64url = (input: string | Buffer) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const mailbox = process.env.GMAIL_MAILBOX;
  if (!raw || !mailbox) return null;
  const parsed = serviceAccountSchema.safeParse(readServiceAccountKey(raw));
  if (!parsed.success) return null;
  return { key: parsed.data, mailbox };
}

export function canRead(): boolean {
  return credentials() !== null;
}

let cached: { value: string; expiresAt: number } | null = null;

async function token(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const creds = credentials();
  if (!creds) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.key.client_email,
      sub: creds.mailbox,
      scope: READ_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(
    signer.sign(creds.key.private_key.replace(/\\n/g, '\n')),
  )}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!body?.access_token) return null;

  cached = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.value;
}

export interface ThreadMessage {
  from: string;
  fromMe: boolean;
  at: Date;
  text: string;
}

export interface ThreadRead {
  subject: string | null;
  messages: ThreadMessage[];
}

/**
 * Every part of a message, attachments included.
 *
 * Not the walker in the Gmail adapter: that one collects attachments and skips
 * everything without a filename, which is exactly the text parts wanted here.
 */
function everyPart(part: MimePart | undefined, out: MimePart[] = []): MimePart[] {
  if (!part) return out;
  out.push(part);
  for (const child of part.parts ?? []) everyPart(child, out);
  return out;
}

/** The plain-text body of a message, HTML stripped where that is all there is. */
export function bodyText(payload: MimePart | undefined): string {
  const parts = everyPart(payload);
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  const chosen = plain ?? html;
  if (!chosen?.body?.data) return '';

  const raw = Buffer.from(chosen.body.data, 'base64url').toString('utf8');
  const text = chosen === plain ? raw : stripHtml(raw);
  return trimQuoted(text);
}

/** Enough HTML stripping for a mail body: tags out, entities back, spacing kept. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The part of a reply that is actually new.
 *
 * Every message in a long thread carries every message before it, so a
 * ten-message conversation sent whole is the first message repeated ten times.
 * Cutting at the quote marker keeps the context where it belongs — in the
 * earlier messages, once each.
 */
export function trimQuoted(text: string): string {
  const markers = [
    /^On .+ wrote:$/m,
    /^-{2,} ?Original Message ?-{2,}$/m,
    /^_{10,}$/m,
    /^בתאריך .+ כתב/m,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const found = text.match(marker);
    if (found?.index !== undefined && found.index < cut) cut = found.index;
  }
  return text
    .slice(0, cut)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .trim();
}

/**
 * One thread, oldest message first.
 *
 * Returns null rather than throwing when Gmail is not configured or refuses:
 * a draft written from the summary alone is worse than one written from the
 * whole conversation, and both are better than a screen that will not load.
 */
export async function readThread(threadId: string, maxMessages = 8): Promise<ThreadRead | null> {
  const access = await token();
  if (!access) return null;

  const res = await fetch(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=full`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) return null;

  const thread = (await res.json().catch(() => null)) as {
    messages?: {
      internalDate?: string;
      payload?: MimePart & { headers?: { name: string; value: string }[] };
    }[];
  } | null;
  if (!thread?.messages?.length) return null;

  const me = (process.env.GMAIL_MAILBOX ?? '').toLowerCase();
  let subject: string | null = null;

  const all: ThreadMessage[] = thread.messages.map((m) => {
    const headers = m.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name)?.value ?? '';
    if (subject === null && header('subject')) subject = header('subject');
    const from = header('from');
    return {
      from,
      fromMe: from.toLowerCase().includes(me),
      at: new Date(Number(m.internalDate ?? 0)),
      text: bodyText(m.payload),
    };
  });

  // The last few, oldest first: the end of a conversation is what is being
  // answered, and the beginning of a long one is rarely what it is about now.
  return { subject, messages: all.slice(-maxMessages) };
}
