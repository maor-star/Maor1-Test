#!/usr/bin/env node
/**
 * Says what the cockpit can see attached to a conversation, and proves it.
 *
 *   GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… node gmail-attachments-check.mjs <threadId…>
 *
 * The screen shows files by walking a thread's MIME tree the way
 * lib/integrations/gmail.ts does. "The mailbox is readable" is not the same as
 * "the attachments are found": a photo inside a forwarded mail sits three
 * levels down, and the first version of that walk looked only at the top.
 *
 * It reads only. It prints file names and sizes, never a body or the key.
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


const walk = (part, out = []) => {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push(part);
  for (const child of part.parts ?? []) walk(child, out);
  return out;
};

const threads = process.argv.slice(2);
if (threads.length === 0) {
  console.error('Give it one or more Gmail thread ids.');
  process.exit(1);
}

for (const id of threads) {
  const res = await api(`/threads/${id}?format=full`);
  if (res.status !== 200) {
    console.log(`${id}: FAILED http_${res.status}`);
    continue;
  }
  const found = [];
  for (const message of res.body.messages ?? []) {
    for (const part of walk(message.payload)) {
      found.push(`${part.filename} (${part.mimeType}, ${part.body?.size ?? '?'} B)`);
    }
  }
  console.log(`${id}: ${found.length} attachment part(s)`);
  for (const f of found.slice(0, 6)) console.log(`   ${f}`);
}
