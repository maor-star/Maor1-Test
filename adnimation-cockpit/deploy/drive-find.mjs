#!/usr/bin/env node
/**
 * Find the contracts root folder in Drive, and check what we can do to it.
 *
 *   GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… node drive-find.mjs [name]
 *
 * Two things need proving before contracts are filed anywhere: that the folder
 * he shared is the one we can see, and that we can actually write to it.
 * Discovering a permissions problem when a real contract is being filed is too
 * late, so this creates and deletes a probe folder instead.
 */
import { createSign } from 'node:crypto';

const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const WANTED = (process.argv[2] ?? '').toLowerCase();

if (!RAW_KEY || !MAILBOX) {
  console.error('GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}

const key = JSON.parse(
  RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
);
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(
    JSON.stringify({
      iss: key.client_email,
      sub: MAILBOX,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

  const body = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  }).then((r) => r.json());

  if (!body.access_token) throw new Error(`drive auth failed: ${body.error}`);
  return body.access_token;
}

const t = await token();
const auth = { Authorization: `Bearer ${t}` };

const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
const res = await fetch(
  `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    '&fields=files(id,name,owners(emailAddress),capabilities(canAddChildren),modifiedTime)' +
    '&orderBy=modifiedTime desc&pageSize=40&supportsAllDrives=true&includeItemsFromAllDrives=true',
  { headers: auth },
).then((r) => r.json());

// Drive answers a rejected query with 200 and an error body, so an empty list
// and a refusal look identical unless the response is actually read.
if (res.error) {
  console.error(`drive list failed: ${JSON.stringify(res.error).slice(0, 400)}`);
  process.exit(1);
}

const who = await fetch(
  'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota(usage)',
  { headers: auth },
).then((r) => r.json());
console.log(`acting as: ${who.user?.emailAddress ?? JSON.stringify(who).slice(0, 200)}`);

const folders = res.files ?? [];
console.log(`${folders.length} folders visible as ${MAILBOX}:\n`);

const matches = WANTED
  ? folders.filter((f) => f.name.toLowerCase().includes(WANTED))
  : folders.filter((f) => /contract|חוז|הסכם/i.test(f.name));

for (const f of (matches.length > 0 ? matches : folders).slice(0, 20)) {
  console.log(
    `${f.id}  ${f.name}` +
      `  [owner ${f.owners?.[0]?.emailAddress ?? '?'}]` +
      `${f.capabilities?.canAddChildren === false ? '  (CANNOT WRITE)' : '  (writable)'}`,
  );
}

// Prove we can write, rather than assume it.
const target = matches[0];
if (target) {
  console.log(`\nprobing write access on "${target.name}"…`);
  const probe = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '.cockpit-write-probe',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [target.id],
      }),
    },
  );
  if (probe.ok) {
    const created = await probe.json();
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${created.id}?supportsAllDrives=true`,
      { method: 'DELETE', headers: auth },
    );
    console.log(`  writable. DRIVE_CONTRACTS_ROOT_ID=${target.id}`);
  } else {
    console.log(`  NOT writable: http_${probe.status} ${(await probe.text()).slice(0, 200)}`);
  }
}
