#!/usr/bin/env node
/**
 * Prove Claude is reachable and can read a real contract.
 *
 *   ANTHROPIC_API_KEY=… node claude-check.mjs
 *
 * A key that authenticates is not a summary that arrives, so this asks a real
 * question and reports what came back.
 *
 * With DRIVE_FILE_ID set it goes further and sends that actual document, which
 * is the part nothing else exercises: Drive's bytes, base64, and Claude's
 * document block all have to line up, and each of them works in isolation.
 */
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY is required.'); process.exit(1); }

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly: cockpit ok' }],
  }),
});

if (!res.ok) {
  console.error(`claude: NOT working — http_${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const body = await res.json();
const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
console.log(`claude: working. model ${body.model}, said "${text.trim()}"`);
console.log(`tokens in/out: ${body.usage.input_tokens}/${body.usage.output_tokens}`);

const FILE = process.env.DRIVE_FILE_ID;
if (!FILE) process.exit(0);

// The document path, end to end, against a real contract.
const { createSign } = await import('node:crypto');
const key = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY.trim().startsWith('{')
    ? process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    : Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'),
);
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64(JSON.stringify({
  iss: key.client_email, sub: process.env.GMAIL_MAILBOX,
  scope: 'https://www.googleapis.com/auth/drive',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
}));
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

const meta = await fetch(
  `https://www.googleapis.com/drive/v3/files/${FILE}?fields=name,mimeType&supportsAllDrives=true`,
  { headers: { Authorization: `Bearer ${auth.access_token}` } },
).then((r) => r.json());
console.log(`\nreading ${meta.name} (${meta.mimeType})`);

const bytes = Buffer.from(
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${FILE}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${auth.access_token}` } },
  ).then((r) => r.arrayBuffer()),
);

const doc = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
        },
        {
          type: 'text',
          text: 'In two sentences: what kind of agreement is this, and between whom?',
        },
      ],
    }],
  }),
});

if (!doc.ok) {
  console.error(`document read: FAILED — http_${doc.status} ${(await doc.text()).slice(0, 400)}`);
  process.exit(1);
}
const docBody = await doc.json();
console.log(
  'document read: working —\n  ' +
    (docBody.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim(),
);
console.log(`  tokens in/out: ${docBody.usage.input_tokens}/${docBody.usage.output_tokens}`);
