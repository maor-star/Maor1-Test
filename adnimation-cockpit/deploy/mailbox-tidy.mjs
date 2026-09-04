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
import {
  ANSWERED_LABEL, CLAUDE_LABEL, FILED_LABEL, PROMO_LABEL, isSpentAuthCode, looksPromotional,
  mayLeaveInbox,
} from './mailbox-rules.mjs';
import { postAsBot } from './bot-post.mjs';
import {
  agentState, briefVeto, markRan, mayAct, recordRun, startLog,
} from './agent-brief.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const DRY = process.env.DRY === '1';
const MAX = Number(process.env.TIDY_MAX ?? 200);

if (!DB || !RAW_KEY || !MAILBOX) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });
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

/** Where a spent login code goes now that nothing is trashed. */
const CODES_LABEL = process.env.CODES_LABEL ?? `${CLAUDE_LABEL}/Spent codes`;

/**
 * Resolve a label, creating it once if it is not there.
 *
 * Gmail nests by name and will not create "Claude/Spent codes" while there is
 * no "Claude", so the parent is made first.
 */
async function labelId(name) {
  const { labels } = await gmail('/labels');
  const found = labels?.find((l) => l.name === name);
  if (found) return found.id;
  if (DRY) return null;

  const parent = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : null;
  if (parent && !labels?.some((l) => l.name === parent)) {
    await gmail('/labels', MODIFY, {
      method: 'POST',
      body: JSON.stringify({ name: parent, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    }).catch(() => {});
  }

  const created = await gmail('/labels', MODIFY, {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  });
  console.log(`created the label "${name}"`);
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

  for (const name of [PROMO_LABEL, CODES_LABEL, CLAUDE_LABEL, ANSWERED_LABEL, FILED_LABEL]) {
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
  const log = startLog();

  if (process.env.ENSURE_LABELS === '1') {
    await ensureLabels();
    await sql.end();
    process.exit(0);
  }

  const [replied, known] = await Promise.all([repliedTo(), knownContacts()]);
  console.log(`${known.size} known addresses, ${replied.size} you have replied to`);

  /*
   * Both folders this job uses, checked against the rule before anything is
   * moved. A label that is not under Claude/ stops the whole job rather than
   * quietly moving his mail somewhere he does not look.
   */
  for (const name of [PROMO_LABEL, CODES_LABEL]) {
    const allowed = mayLeaveInbox(name);
    if (!allowed.ok) {
      console.error(`refusing to run: ${allowed.why}`);
      await sql.end();
      process.exit(1);
    }
  }

  const promoLabel = await labelId(PROMO_LABEL);
  const codesLabel = await labelId(CODES_LABEL);

  // The inbox only. Anything he has already filed is already handled.
  const { messages } = await gmail(`/messages?maxResults=${MAX}&q=${encodeURIComponent('in:inbox')}`);
  const refs = messages ?? [];
  console.log(`${refs.length} messages in the inbox`);

  /*
   * Two agents share this job — one files the sales mail, one clears the spent
   * codes — so each half is gated on its own switch and taught by its own
   * brief. Switching off the filing must not also stop the codes.
   */
  const promoAgent = await agentState(sql, 'promo-filer');
  const codeAgent = await agentState(sql, 'code-cleaner');
  const force = process.env.FORCE === '1';
  const mayFilePromo = mayAct(promoAgent, { dry: DRY, force });
  const mayTrash = mayAct(codeAgent, { dry: DRY, force });
  if (!DRY) {
    console.log(`filing sales mail: ${mayFilePromo.act ? 'on' : `off — ${mayFilePromo.why}`}`);
    console.log(`clearing spent codes: ${mayTrash.act ? 'on' : `off — ${mayTrash.why}`}`);
    if (!mayFilePromo.act && !mayTrash.act) {
      await recordRun(sql, 'promo-filer', {
        dry: DRY,
        output: log.text(),
        summary: { skipped: mayFilePromo.why },
        startedAt: new Date(started),
      });
      await sql.end();
      process.exit(0);
    }
    if (mayFilePromo.act) await markRan(sql, 'promo-filer');
    if (mayTrash.act) await markRan(sql, 'code-cleaner');
  }

  let filed = 0;
  let trashed = 0;
  let held = 0;
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

    /*
     * A spent login code used to go to the trash. It does not any more: his
     * first rule about his own mailbox is that nothing leaves the inbox except
     * into a folder under Claude/, and the trash is the furthest thing from
     * one. A code nobody can use again is worth nothing either way, so filing
     * it costs him nothing and keeps the rule whole.
     */
    const code = isSpentAuthCode(facts);
    if (code.isExpiredCode && (DRY || mayTrash.act)) {
      console.log(`  ${DRY ? 'WOULD FILE' : 'filing'} a spent code: ${subject}`);
      console.log(`      ${code.reasons.join(', ')}`);
      if (!DRY && codesLabel) {
        await gmail(`/messages/${ref.id}/modify`, MODIFY, {
          method: 'POST',
          body: JSON.stringify({ addLabelIds: [codesLabel], removeLabelIds: ['INBOX'] }),
        });
        trashed += 1;
        did.push(`• filed a spent code to ${CODES_LABEL}: ${subject}`);
      }
      continue;
    }

    const promo = looksPromotional(facts);
    if (promo.isPromo && (DRY || mayFilePromo.act)) {
      const veto = await briefVeto({
        brief: promoAgent.brief,
        playbook: promoAgent.playbook,
        agent: 'promo-filer',
        what: `take this out of the inbox and file it under "${PROMO_LABEL}"`,
        item: { subject, from, why: promo.reasons.join(', ') },
      });
      if (!veto.go) {
        held += 1;
        console.log(`  left in the inbox: ${subject}\n      ${veto.why}`);
        continue;
      }

      console.log(`  ${DRY ? 'WOULD FILE' : 'filing'}: ${subject}`);
      console.log(`      from ${from}`);
      console.log(`      ${promo.reasons.join(', ')}`);
      if (!DRY && promoLabel) {
        // Add the label and take it out of the inbox in one call, so a mail is
        // never unlabelled and out of sight between two requests.
        await gmail(`/messages/${ref.id}/modify`, MODIFY, {
          method: 'POST',
          body: JSON.stringify({ addLabelIds: [promoLabel], removeLabelIds: ['INBOX'] }),
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
      : `filed ${filed} to "${PROMO_LABEL}", ${trashed} spent codes to "${CODES_LABEL}", ` +
        `${held} held back by your brief, ` +
        `in ${Math.round((Date.now() - started) / 1000)}s.`,
  );

  await recordRun(sql, 'promo-filer', {
    dry: DRY,
    output: log.text(),
    summary: { filed, trashed, held },
    startedAt: new Date(started),
  });

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
