#!/usr/bin/env node
/**
 * Contracts arriving by mail and by Slack, into the classification queue.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… \
 *   SLACK_BOT_TOKEN=… SLACK_CEO_USER_ID=… node contract-sync.mjs
 *
 * It records and, where Drive allows, files. It never classifies: the
 * counterparty is inferred from the sender and the category is left unset, so
 * everything lands in "needs classifying" where he decides. Filing a contract
 * into the wrong company's folder is not undone by a click.
 *
 * Deduplicated twice over — by where it came from, so a re-scan does not
 * re-propose what he has dealt with, and by SHA-256 of the bytes, so the same
 * agreement arriving by both mail and Slack is one version rather than two.
 */
import { createHash, createSign } from 'node:crypto';
import postgres from 'postgres';
import { counterpartyFrom, looksLikeContract, versionFromName } from './contract-intake.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const CEO = process.env.SLACK_CEO_USER_ID;
const DAYS = Number(process.env.CONTRACT_SYNC_DAYS ?? 30);
const MAX_THREADS = Number(process.env.CONTRACT_SYNC_MAX ?? 300);

if (!DB) { console.error('DATABASE_URL is required.'); process.exit(1); }

const sql = postgres(DB, { max: 2 });
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** One token per scope: an ungranted Drive scope must not break Gmail. */
const tokens = new Map();
async function googleToken(scope) {
  const held = tokens.get(scope);
  if (held && held.expiresAt > Date.now() + 60_000) return held.value;
  if (!RAW_KEY || !MAILBOX) return null;

  const key = JSON.parse(
    RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
  );
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

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await res.json();
  if (!body.access_token) return null;
  tokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

const GMAIL_READ = 'https://www.googleapis.com/auth/gmail.readonly';
const DRIVE = 'https://www.googleapis.com/auth/drive';

async function gmail(path) {
  const token = await googleToken(GMAIL_READ);
  if (!token) throw new Error('gmail is not authorised');
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status}`);
  return res.json();
}

const header = (headers, name) =>
  headers.find((h) => h.name.toLowerCase() === name)?.value ?? null;

function parseAddress(raw) {
  if (!raw) return { name: null, email: null };
  const angled = /^(.*)<([^>]+)>\s*$/.exec(raw);
  if (angled) {
    return {
      name: (angled[1] ?? '').trim().replace(/^"|"$/g, '') || null,
      email: (angled[2] ?? '').trim().toLowerCase() || null,
    };
  }
  const bare = raw.trim().toLowerCase();
  return { name: null, email: bare.includes('@') ? bare : null };
}

/** Walk the MIME tree — attachments hide at any depth. */
function collectParts(part, out = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) {
    out.push({
      filename: part.filename,
      mimeType: part.mimeType ?? null,
      size: part.body.size ?? null,
      attachmentId: part.body.attachmentId,
    });
  }
  for (const child of part.parts ?? []) collectParts(child, out);
  return out;
}

async function alreadySeen(source, ref) {
  const [row] = await sql`
    select id from contract_intake_seen where source = ${source} and source_ref = ${ref}
  `;
  return row !== undefined;
}

async function markSeen(source, ref, fileName, fileHash, contractId) {
  await sql`
    insert into contract_intake_seen (source, source_ref, file_name, file_hash, decided, contract_id)
    values (${source}, ${ref}, ${fileName}, ${fileHash}, ${contractId ? 'recorded' : 'skipped'},
            ${contractId})
    on conflict (source, source_ref) do nothing
  `;
}

/**
 * Record a contract and its version.
 *
 * Mirrors lib/contracts/intake-module.ts recordArrival — the job cannot import
 * it, and reimplementing the SQL is the lesser evil against making the app
 * depend on a job or the job boot the whole app.
 */
async function record({ counterparty, docType, source, ref, url, receivedAt, fileName, hash, mime, size }) {
  const [open] = await sql`
    select id from contracts
    where archived_at is null
      and lower(counterparty_name) = ${counterparty.toLowerCase()}
      and status <> 'signed'
    order by created_at desc limit 1
  `;

  let contractId = open?.id;
  if (!contractId) {
    const [created] = await sql`
      insert into contracts
        (counterparty_name, category, category_confirmed, doc_type, status,
         source, source_ref, source_url, received_at)
      values (${counterparty}, 'general', false, ${docType}, 'unclassified',
              ${source}, ${ref}, ${url}, ${receivedAt})
      returning id
    `;
    contractId = created.id;
  }

  const [held] = await sql`
    select coalesce(max(version_no), 0)::int as max from contract_versions
    where contract_id = ${contractId}
  `;
  const versionNo = versionFromName(fileName, held.max ?? 0);

  const inserted = await sql`
    insert into contract_versions
      (contract_id, version_no, file_name, file_hash, source, received_at,
       mime_type, size_bytes, source_ref, source_url)
    values (${contractId}, ${versionNo}, ${fileName}, ${hash},
            ${source === 'mail' ? 'inbound_mail' : 'manual_upload'}, ${receivedAt},
            ${mime}, ${size}, ${ref}, ${url})
    -- Bare ON CONFLICT, not a named target: the schema carries a global unique
    -- on file_hash as well as the per-contract one, and identical bytes are the
    -- same document wherever they arrive from. Naming one target made the other
    -- throw and took the whole pass down with it.
    on conflict do nothing
    returning id
  `;

  return { contractId, versionId: inserted[0]?.id ?? null, versionNo };
}

async function fromMail() {
  if (!RAW_KEY || !MAILBOX) {
    console.log('gmail not configured, skipping mail');
    return { scanned: 0, recorded: 0 };
  }

  const query = encodeURIComponent(`has:attachment newer_than:${DAYS}d -in:spam -in:trash`);
  const refs = [];
  let pageToken = '';
  do {
    const page = await gmail(
      `/threads?maxResults=100&q=${query}${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
    refs.push(...(page.threads ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken && refs.length < MAX_THREADS);

  let recorded = 0;
  let scanned = 0;

  for (const ref of refs.slice(0, MAX_THREADS)) {
    const thread = await gmail(`/threads/${ref.id}?format=full`);
    for (const message of thread.messages ?? []) {
      const labels = message.labelIds ?? [];
      if (labels.includes('TRASH') || labels.includes('SPAM')) continue;

      const headers = message.payload?.headers ?? [];
      const subject = header(headers, 'subject') ?? '';
      const from = parseAddress(header(headers, 'from'));
      const attachments = collectParts(message.payload);

      for (const attachment of attachments) {
        scanned += 1;
        try {
        const sourceRef = `${message.id}:${attachment.attachmentId.slice(0, 24)}`;
        if (await alreadySeen('mail', sourceRef)) continue;

        const guess = looksLikeContract({
          fileName: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size,
          context: `${subject}\n${message.snippet ?? ''}`,
        });
        if (!guess.isContract) {
          await markSeen('mail', sourceRef, attachment.filename, null, null);
          continue;
        }

        // The bytes are needed for the hash, which is what makes the same
        // agreement arriving twice one version rather than two.
        const body = await gmail(
          `/messages/${message.id}/attachments/${attachment.attachmentId}`,
        ).catch(() => null);
        if (!body?.data) continue;

        const bytes = Buffer.from(body.data, 'base64');
        const hash = createHash('sha256').update(bytes).digest('hex');

        const [known] = await sql`
          select known_company from mail_threads where thread_id = ${thread.id}
        `;
        const counterparty = counterpartyFrom({
          email: from.email,
          displayName: from.name,
          // The CRM holds our own company under a few names, and any of them
          // as a counterparty means a contract with ourselves.
          knownCompany:
            known?.known_company && !/^adnimation\b/i.test(known.known_company)
              ? known.known_company
              : null,
          ownDomain: MAILBOX.split('@')[1] ?? null,
        });
        if (!counterparty) {
          await markSeen('mail', sourceRef, attachment.filename, hash, null);
          continue;
        }

        const { contractId, versionId } = await record({
          counterparty,
          docType: subject.slice(0, 120) || 'Agreement',
          source: 'mail',
          ref: sourceRef,
          url: `https://mail.google.com/mail/u/0/#all/${thread.id}`,
          receivedAt: new Date(Number(message.internalDate ?? Date.now())),
          fileName: attachment.filename,
          hash,
          mime: attachment.mimeType,
          size: attachment.size,
        });

        await markSeen('mail', sourceRef, attachment.filename, hash, contractId);
        if (versionId) {
          recorded += 1;
          await fileToDrive(versionId, counterparty, attachment, bytes);
        }
        } catch (e) {
          // One unreadable attachment must not cost the whole run. Say which,
          // and carry on — the next pass will try it again.
          console.error(`  skipped ${attachment.filename}: ${e.message ?? e}`);
        }
      }
    }
  }

  return { scanned, recorded };
}

/** Put the bytes in Drive if the scope allows; record that it did not if not. */
async function fileToDrive(versionId, counterparty, attachment, bytes) {
  const token = await googleToken(DRIVE);
  if (!token) return;

  // Relative to the root folder id, NOT including its name — prefixing the
  // root's own name resolved everything one level too deep.
  const segments = ['_Unclassified', counterparty.replace(/[/\\]/g, '-')];
  const root = process.env.DRIVE_CONTRACTS_ROOT_ID;
  if (!root) return;

  let parent = root;
  for (const segment of segments) {
    const q = encodeURIComponent(
      `name = '${segment.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' ` +
        `and '${parent}' in parents and trashed = false`,
    );
    const found = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    ).then((r) => (r.ok ? r.json() : { files: [] }));

    if (found.files?.[0]?.id) { parent = found.files[0].id; continue; }

    const created = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: segment,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parent],
        }),
      },
    ).then((r) => (r.ok ? r.json() : null));
    if (!created?.id) return;
    parent = created.id;
  }

  const boundary = `cockpit${Date.now()}`;
  const metadata = JSON.stringify({ name: attachment.filename, parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${attachment.mimeType ?? 'application/pdf'}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploaded = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  ).then((r) => (r.ok ? r.json() : null));

  if (uploaded?.id) {
    await sql`
      update contract_versions
      set drive_file_id = ${uploaded.id},
          drive_path = ${'/Adnimation Contracts/' + segments.join('/')},
          uploaded_at = now()
      where id = ${versionId}
    `;
  }
}

async function fromSlack() {
  if (!SLACK_TOKEN || !CEO) return { scanned: 0, recorded: 0 };

  const res = await fetch(
    `https://slack.com/api/users.conversations?types=im&limit=200&exclude_archived=true`,
    { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } },
  ).then((r) => r.json());
  if (!res.ok) return { scanned: 0, recorded: 0 };

  const oldest = (Date.now() - DAYS * 86_400_000) / 1000;
  let scanned = 0;
  let recorded = 0;

  for (const channel of res.channels ?? []) {
    if (channel.user !== CEO) continue;

    const history = await fetch(
      `https://slack.com/api/conversations.history?channel=${channel.id}&oldest=${oldest}&limit=200`,
      { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } },
    ).then((r) => r.json());

    for (const message of history.messages ?? []) {
      for (const file of message.files ?? []) {
        scanned += 1;
        try {
        const sourceRef = `slack:${file.id}`;
        if (await alreadySeen('slack', sourceRef)) continue;

        const guess = looksLikeContract({
          fileName: file.name ?? '',
          mimeType: file.mimetype ?? null,
          sizeBytes: file.size ?? null,
          context: message.text ?? '',
        });
        if (!guess.isContract) {
          await markSeen('slack', sourceRef, file.name ?? null, null, null);
          continue;
        }

        const download = await fetch(file.url_private_download ?? file.url_private, {
          headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
        }).catch(() => null);
        if (!download?.ok) continue;

        const bytes = Buffer.from(await download.arrayBuffer());
        const hash = createHash('sha256').update(bytes).digest('hex');
        const counterparty = counterpartyFrom({ displayName: file.user_team ?? null }) ?? 'Unknown';

        const { contractId, versionId } = await record({
          counterparty,
          docType: file.title ?? file.name ?? 'Agreement',
          source: 'slack',
          ref: sourceRef,
          url: file.permalink ?? null,
          receivedAt: new Date((file.timestamp ?? Date.now() / 1000) * 1000),
          fileName: file.name ?? 'contract.pdf',
          hash,
          mime: file.mimetype ?? null,
          size: file.size ?? null,
        });

        await markSeen('slack', sourceRef, file.name ?? null, hash, contractId);
        if (versionId) {
          recorded += 1;
          await fileToDrive(versionId, counterparty, { filename: file.name, mimeType: file.mimetype }, bytes);
        }
        } catch (e) {
          console.error(`  skipped ${file.name}: ${e.message ?? e}`);
        }
      }
    }
  }

  return { scanned, recorded };
}

async function main() {
  const started = Date.now();

  const mail = await fromMail().catch((e) => {
    console.error(`mail intake failed: ${e.message}`);
    return { scanned: 0, recorded: 0 };
  });
  const slack = await fromSlack().catch((e) => {
    console.error(`slack intake failed: ${e.message}`);
    return { scanned: 0, recorded: 0 };
  });

  const [counts] = await sql`
    select
      count(*) filter (where status = 'unclassified' and archived_at is null) as unclassified,
      count(*) filter (where archived_at is null) as total
    from contracts
  `;
  const [unfiled] = await sql`
    select count(*)::int as n from contract_versions where uploaded_at is null
  `;

  console.log(
    `looked at ${mail.scanned} mail attachments and ${slack.scanned} Slack files in ` +
      `${Math.round((Date.now() - started) / 1000)}s. ` +
      `Recorded ${mail.recorded + slack.recorded} new contract versions. ` +
      `${counts.unclassified} of ${counts.total} contracts await classifying; ` +
      `${unfiled.n} versions are not in Drive yet.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
