#!/usr/bin/env node
/**
 * Send somebody an invitation to the tasks board, from the server.
 *
 *   node invite-send.mjs assaf@adnimation.com [edit|view]
 *
 * The screen has a button for this and it is the normal way in. This exists
 * for the case the screen cannot cover: somebody locked out while the sign-in
 * itself was broken, where the fix and the fresh link have to go out together
 * and nobody is sitting in front of the cockpit.
 *
 * It mints a NEW token rather than re-sending an old one. A link works once
 * and expires, so an old one is worth nothing, and mailing it again would be
 * mailing a dead link twice.
 *
 * The wording comes from deploy/invite-message.mjs, generated from
 * lib/tasks/invite-message.ts with a parity test over it — so the mail this
 * sends is word for word the mail the button sends.
 */
import { createSign, randomBytes, createHash } from 'node:crypto';
import postgres from 'postgres';
import { inviteLetter } from './invite-message.mjs';

const [, , rawEmail, rawLevel = 'view'] = process.argv;
const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const BASE = (process.env.APP_URL ?? process.env.AUTH_URL ?? '').replace(/\/+$/, '');

if (!rawEmail || !DB || !RAW_KEY || !MAILBOX || !BASE) {
  console.error('Usage: node invite-send.mjs <email> [edit|view]');
  console.error('Needs DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY, GMAIL_MAILBOX and APP_URL/AUTH_URL.');
  process.exit(1);
}

const email = rawEmail.trim().toLowerCase();
const level = rawLevel === 'edit' ? 'edit' : 'view';
const INVITE_DAYS = 14;

const b64url = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Gmail, for the one scope this needs. Mirrors lib/mail/send.ts. */
async function sendMail({ to, subject, body }) {
  const key = JSON.parse(
    RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      sub: MAILBOX,
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

  const auth = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  }).then((r) => r.json());
  if (!auth.access_token) {
    return { ok: false, error: `${auth.error} ${auth.error_description ?? ''}`.trim() };
  }

  // RFC 2047, so a non-ASCII subject does not arrive as mojibake.
  const encoded = /^[\x00-\x7F]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const raw = [
    `To: ${to}`,
    `Subject: ${encoded}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(raw) }),
  });
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  return { ok: true, id: (await res.json()).id };
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });

try {
  // The grant first: a working link to a door that is still locked is worse
  // than no link at all.
  const [live] = await sql`
    select id from task_access where lower(email) = ${email} and revoked_at is null limit 1`;
  if (live) {
    await sql`update task_access set level = ${level}, granted_at = now() where id = ${live.id}`;
    console.log(`grant: already had one, level set to ${level}`);
  } else {
    await sql`insert into task_access (email, level, granted_by) values (${email}, ${level}, ${MAILBOX})`;
    console.log(`grant: created, level ${level}`);
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);

  const [row] = await sql`
    insert into task_invites (email, level, token_hash, invited_by, expires_at)
    values (${email}, ${level}, ${tokenHash}, ${MAILBOX}, ${expiresAt})
    returning id`;

  const [person] = await sql`select name from people where lower(email) = ${email} limit 1`;
  const [me] = await sql`select name from people where lower(email) = ${MAILBOX.toLowerCase()} limit 1`;

  const link = `${BASE}/join/${token}`;
  const letter = inviteLetter({
    inviterName: me?.name ?? 'Maor Davidovich',
    inviteeName: person?.name ?? null,
    link,
    expiresAt,
    level,
    task: null,
  });

  const sent = await sendMail({ to: email, subject: letter.subject, body: letter.body });
  await sql`
    update task_invites
       set sent_at = ${sent.ok ? new Date() : null}, send_error = ${sent.ok ? null : sent.error}
     where id = ${row.id}`;

  console.log(sent.ok ? `sent to ${email} (message ${sent.id})` : `MAIL FAILED: ${sent.error}`);
  if (!sent.ok) console.log(`send them this by hand: ${link}`);
} finally {
  await sql.end();
}
