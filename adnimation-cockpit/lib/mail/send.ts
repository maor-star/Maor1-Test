import { createSign } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, mailThreads } from '@/lib/db';
import { readServiceAccountKey } from '@/lib/integrations/gmail';

/**
 * Replying from the cockpit.
 *
 * The mirror is read with gmail.readonly. Sending needs gmail.send, which is a
 * separate grant in the Workspace admin console — and a domain-wide delegation
 * request for a scope that has not been granted fails the whole token request.
 * So sending mints its OWN token for its own scope: if send is not authorised,
 * replying says so plainly and reading carries on working. Asking for both in
 * one token would have broken the mail screen the moment the scope was
 * missing, which is the opposite of degrading gracefully.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const base64url = (input: string | Buffer) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface SendResult {
  ok: boolean;
  error?: string;
  /** True when the failure is the missing scope rather than anything he did. */
  needsScope?: boolean;
}

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const mailbox = process.env.GMAIL_MAILBOX;
  if (!raw || !mailbox) return null;

  const parsed = serviceAccountSchema.safeParse(readServiceAccountKey(raw));
  if (!parsed.success) return null;
  return { key: parsed.data, mailbox };
}

export function canReply(): boolean {
  return credentials() !== null;
}

let cached: { value: string; expiresAt: number } | null = null;

async function sendToken(): Promise<{ token: string } | { error: string; needsScope: boolean }> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.value };

  const creds = credentials();
  if (!creds) return { error: 'Gmail is not configured on the server', needsScope: false };

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.key.client_email,
      sub: creds.mailbox,
      scope: SEND_SCOPE,
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
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;

  if (!body?.access_token) {
    // This is what an ungranted scope looks like, and it is worth naming
    // exactly — otherwise it reads as a broken integration.
    const unauthorised =
      body?.error === 'unauthorized_client' ||
      (body?.error_description ?? '').toLowerCase().includes('not authorized');
    return {
      error: unauthorised
        ? 'Sending is not authorised yet — the gmail.send scope has to be added to the ' +
          'service account in the Workspace admin console.'
        : `Gmail auth failed: ${body?.error_description ?? `http_${res.status}`}`,
      needsScope: unauthorised,
    };
  }

  cached = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return { token: cached.value };
}

/** RFC 2047, so a Hebrew subject does not arrive as mojibake. */
const encodeHeader = (value: string) =>
  // eslint-disable-next-line no-control-regex
  /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

export function buildReply(input: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const subject = input.subject.toLowerCase().startsWith('re:')
    ? input.subject
    : `Re: ${input.subject}`;

  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];

  // These two are what make the reply land inside the existing conversation
  // rather than starting a new one beside it.
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);

  return `${headers.join('\r\n')}\r\n\r\n${Buffer.from(input.body, 'utf8').toString('base64')}`;
}

/**
 * A new mail, to somebody, about something.
 *
 * Not a reply: no threading headers, its own subject. This is what handing
 * something over by email is — most of the team has no ClickUp and some have
 * no Slack, and "send them a mail and remember to chase it" is the whole
 * feature.
 */
export async function sendMail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  const to = input.to.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, error: `"${to}" is not an email address` };
  }

  const token = await sendToken();
  if ('error' in token) return { ok: false, error: token.error, needsScope: token.needsScope };

  const headers = [
    `To: ${to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const raw = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(input.body, 'utf8').toString('base64')}`;

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw: Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    }),
  });

  if (!res.ok) {
    const said = await res.text().catch(() => '');
    return { ok: false, error: `Gmail refused it: http_${res.status} ${said.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Reply to a mirrored thread.
 *
 * The recipient and the threading headers are read from Gmail rather than from
 * the mirror: the mirror holds a summary, and replying to the wrong address —
 * or breaking the thread — is not a mistake worth risking to save a request.
 */
export async function replyToThread(threadId: string, text: string): Promise<SendResult> {
  const body = text.trim();
  if (body === '') return { ok: false, error: 'Nothing to send' };

  const auth = await sendToken();
  if ('error' in auth) return { ok: false, error: auth.error, needsScope: auth.needsScope };

  const [mirrored] = await db
    .select()
    .from(mailThreads)
    .where(eq(mailThreads.threadId, threadId))
    .limit(1);
  if (!mirrored) return { ok: false, error: 'That conversation is not in the mirror' };

  const readAuth = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? await readToken() : null;
  if (!readAuth) return { ok: false, error: 'Could not read the conversation to reply to it' };

  const threadRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}` +
      '?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To' +
      '&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References',
    { headers: { Authorization: `Bearer ${readAuth}` } },
  );
  if (!threadRes.ok) {
    return { ok: false, error: `Could not read the conversation: http_${threadRes.status}` };
  }

  const thread = (await threadRes.json()) as {
    messages?: { payload?: { headers?: { name: string; value: string }[] } }[];
  };
  const messages = thread.messages ?? [];
  const last = messages[messages.length - 1];
  const headers = last?.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

  const mailbox = (process.env.GMAIL_MAILBOX ?? '').toLowerCase();
  // Reply-To wins where the sender set one; otherwise whoever sent last. If
  // that is him, fall back to the counterpart the mirror recorded.
  const from = header('reply-to') ?? header('from');
  const fromEmail = /<([^>]+)>/.exec(from ?? '')?.[1] ?? from ?? '';
  const to =
    fromEmail && fromEmail.toLowerCase() !== mailbox ? fromEmail : (mirrored.counterpartEmail ?? '');

  if (!to) return { ok: false, error: 'Could not work out who to reply to' };

  const messageId = header('message-id');
  const references = [header('references'), messageId].filter(Boolean).join(' ') || null;

  const raw = buildReply({
    to,
    subject: mirrored.subject ?? header('subject') ?? '(no subject)',
    body,
    inReplyTo: messageId,
    references,
  });

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64url(raw), threadId }),
  });

  if (!sendRes.ok) {
    const detail = (await sendRes.text()).slice(0, 200);
    return { ok: false, error: `Gmail refused it: http_${sendRes.status} ${detail}` };
  }

  // The last word is now his, so the thread stops waiting on him immediately
  // rather than at the next sync.
  await db
    .update(mailThreads)
    .set({ lastFromMe: true, lastMessageAt: new Date(), dismissedAt: null })
    .where(eq(mailThreads.threadId, threadId));

  return { ok: true };
}

/** The read scope, minted separately from the send scope. See the note above. */
async function readToken(): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.key.client_email,
      sub: creds.mailbox,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
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
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
  return body?.access_token ?? null;
}
