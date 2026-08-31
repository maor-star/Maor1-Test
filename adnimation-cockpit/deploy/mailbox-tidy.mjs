#!/usr/bin/env node
/**
 * Keep the inbox to what still needs him.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… node mailbox-tidy.mjs
 *
 * Two jobs, both destructive in the way that matters — a mail he no longer
 * sees is a mail he did not read — so both are wrong in the safe direction:
 *
 *   Sales and marketing → labelled and taken out of the inbox. Never anything
 *   from someone the company deals with, never anyone he has replied to, and
 *   never a reply or a forward. It is filed, not deleted; the label is one
 *   click away.
 *
 *   Spent one-time codes → the trash, an hour after they arrive, by which
 *   time they no longer work. Never a security alert, which shares almost all
 *   of a code's vocabulary and is how somebody finds out their account was
 *   taken. Trash, not delete: Gmail keeps it thirty days.
 *
 * DRY=1 lists what it would do and touches nothing. That is how to look at it
 * the first time.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';
import { ANSWERED_LABEL, PROMO_LABEL, isSpentAuthCode, looksPromotional } from './mailbox-rules.mjs';
import { postAsBot } from './bot-post.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const DRY = process.env.DRY === '1';
const MAX = Number(process.env.TIDY_MAX ?? 200);

if (!DB || !RAW_KEY || !MAILBOX) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}

const sql = postgres(DB, { max: 2 });
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tokens = new Map();
async function token(scope) {
  const held = tokens.get(scope);
  if (held && held.expiresAt > Date.now() + 60_000) return held.value;

  const key = JSON.parse(
    RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(JSON.stringify({
    iss: key.client_email, sub: MAILBOX, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
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

  if (!body.access_token) {
    const hint =
      body.error === 'unauthorized_client'
        ? ` — add ${scope} to the service account under domain-wide delegation`
        : '';
    throw new Error(`${scope}: ${body.error}${hint}`);
  }
  tokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

async function gmail(path, scope = READ, init) {
  const t = await token(scope);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const header = (headers, name) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

/** Resolve the promo label, creating it once if it is not there. */
async function promoLabelId() {
  const { labels } = await gmail('/labels');
  const found = labels?.find((l) => l.name === PROMO_LABEL);
  if (found) return found.id;

  if (DRY) return null;
  const created = await gmail('/labels', MODIFY, {
    method: 'POST',
    body: JSON.stringify({
      name: PROMO_LABEL,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  console.log(`created the label "${PROMO_LABEL}"`);
  return created.id;
}

/**
 * Whether he has ever replied to this address.
 *
 * The strongest single signal that a sender is not marketing, and the mail
 * mirror already knows it — a thread where the last word was his is a thread
 * he engaged with.
 */
async function repliedTo() {
  const rows = await sql`
    select distinct lower(counterpart_email) as email
    from mail_threads
    where last_from_me = true and counterpart_email is not null
  `;
  return new Set(rows.map((r) => r.email));
}

async function knownContacts() {
  const rows = await sql`
    select lower(email) as email from crm_contacts where email is not null and archived_at is null
    union
    select lower(email) from people where active
  `;
  return new Set(rows.map((r) => r.email));
}

/**
 * Make sure the labels exist, without filing anything.
 *
 * Creating a label the first time an agent needs it means the label appears in
 * his Gmail at the same moment mail starts moving into it, which is the worst
 * time to be discovering a new folder. This creates them up front so he can
 * look at them, and at what will land there, before anything is switched on.
 */
async function ensureLabels() {
  const { labels } = await gmail('/labels');
  const existing = new Map((labels ?? []).map((l) => [l.name, l.id]));

  for (const name of [PROMO_LABEL, ANSWERED_LABEL]) {
    if (existing.has(name)) {
      console.log(`  "${name}" already exists`);
      continue;
    }
    const created = await gmail('/labels', MODIFY, {
      method: 'POST',
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });
    console.log(`  created "${name}" (${created.id})`);
  }
}

async function main() {
  const started = Date.now();

  if (process.env.ENSURE_LABELS === '1') {
    await ensureLabels();
    await sql.end();
    process.exit(0);
  }

  const [replied, known] = await Promise.all([repliedTo(), knownContacts()]);
  console.log(`${known.size} known addresses, ${replied.size} you have replied to`);

  const labelId = await promoLabelId();

  // The inbox only. Anything he has already filed is already handled.
  const { messages } = await gmail(`/messages?maxResults=${MAX}&q=${encodeURIComponent('in:inbox')}`);
  const refs = messages ?? [];
  console.log(`${refs.length} messages in the inbox`);

  let filed = 0;
  let trashed = 0;
  const did = [];

  for (const ref of refs) {
    const message = await gmail(`/messages/${ref.id}?format=metadata` +
      '&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date');
    const headers = message.payload?.headers ?? [];
    const from = header(headers, 'from') ?? '';
    const fromEmail = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
    const subject = header(headers, 'subject') ?? '(no subject)';
    const ageHours = (Date.now() - Number(message.internalDate ?? Date.now())) / 3_600_000;

    const facts = {
      subject,
      snippet: message.snippet ?? '',
      fromEmail,
      fromName: from,
      labels: message.labelIds ?? [],
      knownContact: known.has(fromEmail),
      everReplied: replied.has(fromEmail),
      ageHours,
    };

    const code = isSpentAuthCode(facts);
    if (code.isExpiredCode) {
      console.log(`  ${DRY ? 'WOULD TRASH' : 'trashing'}: ${subject}`);
      console.log(`      ${code.reasons.join(', ')}`);
      if (!DRY) {
        await gmail(`/messages/${ref.id}/trash`, MODIFY, { method: 'POST', body: '{}' });
        trashed += 1;
        did.push(`• trashed a spent code: ${subject}`);
      }
      continue;
    }

    const promo = looksPromotional(facts);
    if (promo.isPromo) {
      console.log(`  ${DRY ? 'WOULD FILE' : 'filing'}: ${subject}`);
      console.log(`      from ${from}`);
      console.log(`      ${promo.reasons.join(', ')}`);
      if (!DRY && labelId) {
        // Add the label and take it out of the inbox in one call, so a mail is
        // never unlabelled and out of sight between two requests.
        await gmail(`/messages/${ref.id}/modify`, MODIFY, {
          method: 'POST',
          body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ['INBOX'] }),
        });
        filed += 1;
        did.push(`• filed to ${PROMO_LABEL}: ${subject}`);
      }
      continue;
    }
  }

  if (!DRY && did.length > 0) {
    const said = await postAsBot('mail', [':envelope: *Inbox tidied*', '', ...did].join('\n'));
    if (!said.ok) console.error(`could not tell him in Slack: ${said.reason}`);
  }

  console.log(
    DRY
      ? `dry run — nothing touched, in ${Math.round((Date.now() - started) / 1000)}s.`
      : `filed ${filed} to "${PROMO_LABEL}", trashed ${trashed} spent codes, ` +
        `in ${Math.round((Date.now() - started) / 1000)}s.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
