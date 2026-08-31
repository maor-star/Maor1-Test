#!/usr/bin/env node
/**
 * Prove the cockpit can actually send, not just mint a token for the scope.
 *
 *   GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… node gmail-send-check.mjs
 *
 * It sends one message from his address to his address. Nothing leaves the
 * company and no counterparty ever sees it, which is the only honest way to
 * test a send path — a token that mints is not a message that arrives.
 */
import { createSign } from 'node:crypto';

const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
if (!RAW_KEY || !MAILBOX) {
  console.error('GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}

const key = JSON.parse(
  RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
);
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64(
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
const assertion = `${header}.${claims}.${b64(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

const auth = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }),
}).then((r) => r.json());

if (!auth.access_token) {
  console.error(`send scope not authorised: ${auth.error} ${auth.error_description ?? ''}`);
  process.exit(1);
}

// A Hebrew subject, because that is the case that breaks silently: the send
// succeeds either way and only the recipient sees the mojibake.
const subject = 'בדיקת שליחה מהקוקפיט';
const raw = [
  `To: ${MAILBOX}`,
  `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset="UTF-8"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(
    'זו בדיקה אוטומטית של נתיב השליחה. אם ההודעה הזאת הגיעה, אפשר לענות למיילים מתוך הקוקפיט.',
    'utf8',
  ).toString('base64'),
].join('\r\n');

const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
  method: 'POST',
  headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ raw: b64(raw) }),
});

if (!res.ok) {
  console.error(`send failed: http_${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const sent = await res.json();
console.log(`sent to ${MAILBOX}. message id ${sent.id}, thread ${sent.threadId}`);
