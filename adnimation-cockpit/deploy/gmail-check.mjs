#!/usr/bin/env node
/**
 * Says whether the cockpit can read the mailbox, and proves it.
 *
 *   GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… node gmail-check.mjs
 *
 * Mirrors lib/integrations/gmail.ts: sign a JWT with the service account,
 * impersonate the mailbox owner, exchange for an access token, then actually
 * list a message. "The token was issued" is not the same as "the mailbox can be
 * read" — domain-wide delegation fails at the second step, not the first.
 *
 * It reads only. It never prints a message body, a subject, or the key.
 */
import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const mailbox = process.env.GMAIL_MAILBOX;

if (!raw || !mailbox) {
  console.error('GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are both required.');
  process.exit(1);
}

const key = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
console.log(`service account: ${key.client_email}`);
console.log(`mailbox: ${mailbox}`);

const b64 = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64(
  JSON.stringify({
    iss: key.client_email,
    sub: mailbox,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }),
);
const signer = createSign('RSA-SHA256');
signer.update(`${header}.${claims}`);
const assertion = `${header}.${claims}.${b64(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
});
const tok = await tokenRes.json();

if (!tok.access_token) {
  console.log(`token exchange: FAILED — ${tok.error}: ${tok.error_description ?? ''}`);
  if (tok.error === 'unauthorized_client') {
    console.log(
      '  This is the domain-wide delegation step. In admin.google.com, under Security, ' +
        'Access and data control, API controls, Domain-wide delegation, add client id ' +
        `${key.client_id ?? '(the service account unique id)'} with the scope ${SCOPE}`,
    );
  }
  process.exit(1);
}
console.log('token exchange: ok');

const api = async (path) => {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  return { status: r.status, body: await r.json() };
};

const profile = await api('/profile');
console.log(
  profile.status === 200
    ? `profile: ok — ${profile.body.emailAddress}, ${profile.body.messagesTotal} messages in the mailbox`
    : `profile: FAILED http_${profile.status} — ${profile.body?.error?.message ?? ''}`,
);
if (profile.status !== 200) process.exit(1);

// The exact shape of query the reply radar runs.
const since = Math.floor((Date.now() - 7 * 86400_000) / 1000);
const list = await api(`/messages?maxResults=3&q=${encodeURIComponent(`after:${since}`)}`);
console.log(
  list.status === 200
    ? `search: ok — ${list.body.messages?.length ?? 0} of the last week's messages readable`
    : `search: FAILED http_${list.status} — ${list.body?.error?.message ?? ''}`,
);

if (list.status === 200 && list.body.messages?.[0]) {
  const one = await api(`/messages/${list.body.messages[0].id}?format=metadata&metadataHeaders=From`);
  console.log(
    one.status === 200
      ? 'message read: ok — the reply radar can read this mailbox'
      : `message read: FAILED http_${one.status}`,
  );
}
