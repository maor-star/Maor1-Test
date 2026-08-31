#!/usr/bin/env node
/**
 * File the contract versions that were recorded before Drive was authorised.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… \
 *   DRIVE_CONTRACTS_ROOT_ID=… node contract-backfill.mjs
 *
 * We never stored the bytes — a database is the wrong place for them and Drive
 * was always the destination — so each version is fetched again from the
 * message it arrived in and uploaded into the folder its contract now belongs
 * to. Idempotent: a version already carrying a Drive file id is left alone.
 *
 * REFILE=1 instead moves everything already in Drive into the folder its
 * contract belongs in now. That is what a classification or a status change
 * does for one contract; this does it for all of them, which is how a mistake
 * in the folder rules gets corrected without re-uploading anything. It then
 * clears out every folder left empty, so the tree only ever shows places that
 * hold something.
 *
 * PRUNE=1 does only that clearing, over the whole tree, for the folders left
 * behind by everything filed before this existed.
 *
 * VERIFY=1 reads where each file actually is in Drive and compares it with
 * where we recorded it, repairing any that disagree. The two drifted once
 * already — a path that included the root folder's own name resolved one level
 * too deep and built a second "Adnimation Contracts" inside the first, while
 * the database recorded the path we meant. Comparing the record against itself
 * would never have found that.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';
// Generated from lib/contracts/drive.ts. The job had its own copy of these and
// it silently lacked the categories added later, which crashed the moment a
// contract was classified as one of them.
import {
  CATEGORY_FOLDER, STAGE_FOLDER, filingFolder, safeFolderName, stageForStatus,
} from './contract-folders.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const ROOT = process.env.DRIVE_CONTRACTS_ROOT_ID;

if (!DB || !RAW_KEY || !MAILBOX || !ROOT) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY, GMAIL_MAILBOX and DRIVE_CONTRACTS_ROOT_ID are required.');
  process.exit(1);
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });
const key = JSON.parse(
  RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
);
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tokens = new Map();
async function token(scope) {
  const held = tokens.get(scope);
  if (held && held.expiresAt > Date.now() + 60_000) return held.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(
    JSON.stringify({
      iss: key.client_email, sub: MAILBOX, scope,
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
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

  if (!body.access_token) throw new Error(`${scope}: ${body.error}`);
  tokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
const DRIVE = 'https://www.googleapis.com/auth/drive';


/** Resolve a folder path under the root, creating what is missing. */
const folderCache = new Map();
async function ensureFolder(segments) {
  const cacheKey = segments.join('/');
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

  const t = await token(DRIVE);
  let parent = ROOT;
  for (const segment of segments) {
    const q = `name = '${segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' ` +
      `and mimeType = 'application/vnd.google-apps.folder' and '${parent}' in parents and trashed = false`;
    const found = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
        '&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true',
      { headers: { Authorization: `Bearer ${t}` } },
    ).then((r) => r.json());

    if (found.files?.[0]?.id) { parent = found.files[0].id; continue; }

    const created = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: segment,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parent],
        }),
      },
    ).then((r) => r.json());
    if (!created.id) throw new Error(`could not create folder ${segment}`);
    parent = created.id;
  }
  folderCache.set(cacheKey, parent);
  return parent;
}

/** Move a file that is already in Drive into the folder it belongs in now. */
async function moveInto(fileId, folderId) {
  const t = await token(DRIVE);
  const current = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${t}` } },
  ).then((r) => (r.ok ? r.json() : null));
  if (!current) return false;

  const remove = (current.parents ?? []).join(',');
  // Drive keeps the file id across a move, so any link already shared stays
  // valid — which is the whole reason the status can be a folder at all.
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${folderId}` +
      `${remove ? `&removeParents=${remove}` : ''}&fields=id&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  return res.ok;
}

/**
 * Trash every empty folder under the root, deepest first.
 *
 * Trash rather than delete: an empty folder is not data, but Drive's delete is
 * permanent and its trash is not, so a folder that turns out to have mattered
 * is still recoverable at no cost.
 *
 * Depth first, because a folder holding only empty folders is itself empty
 * once they have gone — clearing "_Unclassified/Taboola" is what makes
 * "_Unclassified" clearable.
 */
/** The real path of a file in Drive, walked up from its parents. */
async function actualPath(fileId) {
  const t = await token(DRIVE);
  const names = [];
  let id = fileId;

  for (let hop = 0; hop < 12; hop += 1) {
    const meta = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=name,parents&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${t}` } },
    ).then((r) => (r.ok ? r.json() : null));
    if (!meta) return null;

    if (hop > 0) names.unshift(meta.name);
    const parent = meta.parents?.[0];
    if (!parent) break;
    if (parent === ROOT) { names.unshift('Adnimation Contracts'); break; }
    id = parent;
  }

  return `/${names.join('/')}`;
}

async function verify() {
  const started = Date.now();
  const rows = await sql`
    select v.id, v.drive_file_id, v.drive_path, v.file_name,
           c.counterparty_name, c.category, c.category_confirmed, c.status
    from contract_versions v
    join contracts c on c.id = v.contract_id
    where v.drive_file_id is not null and c.archived_at is null
  `;

  let wrong = 0;
  let repaired = 0;

  for (const v of rows) {
    const real = await actualPath(v.drive_file_id);
    if (real === null) { console.log(`  ? ${v.file_name}: not readable`); continue; }

    const target = filingFolder(
      v.counterparty_name,
      v.category_confirmed ? v.category : null,
      stageForStatus(v.status),
    );
    const want = target.path;

    if (real === want) continue;

    wrong += 1;
    console.log(`  ${v.file_name}\n      is at ${real}\n      wants ${want}`);

    const folderId = await ensureFolder(target.segments);
    if (await moveInto(v.drive_file_id, folderId)) {
      await sql`update contract_versions set drive_path = ${want} where id = ${v.id}`;
      await sql`
        update contracts set drive_path = ${want}
        where id = (select contract_id from contract_versions where id = ${v.id})
      `;
      repaired += 1;
    }
  }

  console.log(
    `checked ${rows.length}, ${wrong} in the wrong place, ${repaired} repaired, ` +
      `in ${Math.round((Date.now() - started) / 1000)}s.`,
  );
  await pruneTree();
  await sql.end();
  process.exit(0);
}

async function pruneTree() {
  const started = Date.now();
  const t = await token(DRIVE);
  const trashed = [];

  async function children(id) {
    const q = `'${id}' in parents and trashed = false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
        '&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true',
      { headers: { Authorization: `Bearer ${t}` } },
    ).then((r) => (r.ok ? r.json() : { files: [] }));
    return res.files ?? [];
  }

  /** Returns true when this folder is empty after its children were handled. */
  async function walk(id, name, path, isRoot) {
    const kids = await children(id);
    const folders = kids.filter((k) => k.mimeType === 'application/vnd.google-apps.folder');
    const files = kids.filter((k) => k.mimeType !== 'application/vnd.google-apps.folder');

    let remaining = files.length;
    for (const folder of folders) {
      const emptied = await walk(folder.id, folder.name, `${path}/${folder.name}`, false);
      if (!emptied) remaining += 1;
    }

    if (remaining > 0 || isRoot) return false;

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      },
    );
    if (!res.ok) return false;

    trashed.push(path);
    console.log(`  trashed empty  ${path}`);
    return true;
  }

  await walk(ROOT, 'Adnimation Contracts', '/Adnimation Contracts', true);
  console.log(
    `cleared ${trashed.length} empty folders in ${Math.round((Date.now() - started) / 1000)}s.`,
  );
  return trashed.length;
}

async function refile() {
  const started = Date.now();
  const rows = await sql`
    select v.id, v.drive_file_id, v.drive_path, v.file_name,
           c.counterparty_name, c.category, c.category_confirmed, c.status
    from contract_versions v
    join contracts c on c.id = v.contract_id
    where v.drive_file_id is not null and c.archived_at is null
  `;

  let moved = 0;
  for (const v of rows) {
    const target = filingFolder(
      v.counterparty_name,
      v.category_confirmed ? v.category : null,
      stageForStatus(v.status),
    );
    const path = target.path;
    if (v.drive_path === path) continue;

    const folderId = await ensureFolder(target.segments);
    if (await moveInto(v.drive_file_id, folderId)) {
      await sql`update contract_versions set drive_path = ${path} where id = ${v.id}`;
      await sql`
        update contracts set drive_path = ${path}
        where id = (select contract_id from contract_versions where id = ${v.id})
      `;
      moved += 1;
      console.log(`  ${v.file_name}  →  ${path}`);
    }
  }

  console.log(`moved ${moved} of ${rows.length} in ${Math.round((Date.now() - started) / 1000)}s.`);

  // Whatever those moves emptied should not be left standing.
  await pruneTree();

  await sql.end();
  process.exit(0);
}

async function main() {
  if (process.env.VERIFY === '1') return verify();
  if (process.env.PRUNE === '1') {
    await pruneTree();
    await sql.end();
    process.exit(0);
  }
  if (process.env.REFILE === '1') return refile();

  const started = Date.now();

  const pending = await sql`
    select v.id, v.version_no, v.file_name, v.mime_type, v.source_ref, v.received_at,
           c.counterparty_name, c.category, c.category_confirmed, c.status, c.doc_type
    from contract_versions v
    join contracts c on c.id = v.contract_id
    where v.uploaded_at is null and c.archived_at is null
    order by v.received_at
  `;

  console.log(`${pending.length} versions to file`);

  let filed = 0;
  let skipped = 0;

  for (const v of pending) {
    try {
      // source_ref is "<messageId>:<attachmentId prefix>". The prefix is not
      // enough to fetch by, so the message is read and the attachment matched
      // on its file name — which is what we stored anyway.
      const messageId = (v.source_ref ?? '').split(':')[0];
      if (!messageId) { skipped += 1; continue; }

      const gt = await token(GMAIL);
      const message = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers: { Authorization: `Bearer ${gt}` } },
      ).then((r) => (r.ok ? r.json() : null));
      if (!message) { skipped += 1; continue; }

      const parts = [];
      const walk = (p) => {
        if (!p) return;
        if (p.filename && p.body?.attachmentId) parts.push(p);
        for (const child of p.parts ?? []) walk(child);
      };
      walk(message.payload);

      const part = parts.find((p) => p.filename === v.file_name);
      if (!part) { skipped += 1; continue; }

      const body = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
        { headers: { Authorization: `Bearer ${gt}` } },
      ).then((r) => (r.ok ? r.json() : null));
      if (!body?.data) { skipped += 1; continue; }

      const bytes = Buffer.from(body.data, 'base64');

      const target = filingFolder(
        v.counterparty_name,
        v.category_confirmed ? v.category : null,
        stageForStatus(v.status),
      );
      const folderId = await ensureFolder(target.segments);

      const ext = (v.file_name.split('.').pop() ?? 'pdf').toLowerCase();
      const date = new Date(v.received_at).toISOString().slice(0, 10);
      const name = `${safeFolderName(v.counterparty_name)} - ${(v.doc_type || 'Agreement').slice(0, 60).trim()} - v${v.version_no} - ${date}.${ext}`;
      const segments = target.segments;

      const dt = await token(DRIVE);
      const boundary = `cockpit${Date.now()}`;
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            `${JSON.stringify({ name, parents: [folderId] })}\r\n` +
            `--${boundary}\r\nContent-Type: ${v.mime_type ?? 'application/pdf'}\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const uploaded = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${dt}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: payload,
        },
      ).then((r) => (r.ok ? r.json() : null));

      if (!uploaded?.id) { skipped += 1; continue; }

      const path = target.path;
      await sql`
        update contract_versions
        set drive_file_id = ${uploaded.id}, drive_path = ${path}, uploaded_at = now()
        where id = ${v.id}
      `;
      await sql`
        update contracts set drive_path = ${path}
        where id = (select contract_id from contract_versions where id = ${v.id})
      `;

      filed += 1;
      console.log(`  ${path}/${name}`);
    } catch (e) {
      // One version that cannot be re-fetched must not stop the rest.
      skipped += 1;
      console.error(`  skipped ${v.file_name}: ${e.message ?? e}`);
    }
  }

  console.log(
    `filed ${filed}, skipped ${skipped}, in ${Math.round((Date.now() - started) / 1000)}s.`,
  );
  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
