#!/usr/bin/env node
/**
 * Forward invoices to finance.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… \
 *   FINANCE_EMAIL=finance@adnimation.com node invoice-forward.mjs
 *
 * DRY=1 lists what it would forward and sends nothing. That is the default
 * posture for anything that sends: seeing the list once is worth more than
 * trusting the rules.
 *
 * The recipient is checked against the allowed internal domains before every
 * send, so this cannot mail the outside world even if FINANCE_EMAIL is set to
 * something it should not be. Each message is forwarded once — the id is
 * recorded, and a re-run skips it.
 *
 * A forwarded invoice is then archived out of the inbox: finance has it, so it
 * is no longer his to look at. Archived, not deleted — it stays in All Mail and
 * one search away. That needs gmail.modify; without it the forward still
 * happens and the archiving is reported as skipped rather than failing the run.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';
import { assertInternalRecipients, looksLikeInvoice } from './internal-mail.mjs';
import { postAsBot } from './bot-post.mjs';
import { agentState, briefVeto, mayAct } from './agent-brief.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const FINANCE = process.env.FINANCE_EMAIL ?? 'finance@adnimation.com';
const DAYS = Number(process.env.INVOICE_LOOKBACK_DAYS ?? 30);
const MAX = Number(process.env.INVOICE_MAX ?? 200);
const DRY = process.env.DRY === '1';

if (!DB || !RAW_KEY || !MAILBOX) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}

// Checked once, up front: a bad recipient should stop the run before it reads
// a single mail, not after it has decided what to send.
const recipients = assertInternalRecipients([FINANCE]);
if (!recipients.ok) {
  console.error(recipients.error);
  process.exit(1);
}
const to = recipients.recipients[0];

const sql = postgres(DB, { max: 2, onnotice: () => {} });
const b64url = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tokens = new Map();
async function token(scope) {
  const held = tokens.get(scope);
  if (held && held.expiresAt > Date.now() + 60_000) return held.value;

  const key = JSON.parse(
    RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, sub: MAILBOX, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

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

const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

/**
 * Take a forwarded invoice out of the inbox.
 *
 * Never fatal. The forward is the point; archiving is tidying, and a missing
 * scope should not make a delivered invoice look like a failed run.
 */
async function archive(messageId) {
  try {
    const t = await token(MODIFY);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      },
    );
    return res.ok ? { ok: true } : { ok: false, reason: `http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: e.message ?? 'could not archive' };
  }
}

async function gmail(path) {
  const t = await token(READ);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status}`);
  return res.json();
}

const header = (headers, name) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

/** Attachment names at any depth, which is where the invoice usually is. */
function attachmentNames(part, out = []) {
  if (!part) return out;
  if (part.filename) out.push(part.filename);
  for (const child of part.parts ?? []) attachmentNames(child, out);
  return out.filter(Boolean);
}

/**
 * Forward as a real forward: the original message, intact, as an attachment.
 *
 * Not a summary and not a re-typed copy — finance needs the document, and a
 * message/rfc822 attachment keeps the sender, the date and every attachment
 * exactly as they arrived.
 */
async function forward(message, fromName, subject) {
  const raw = await gmail(`/messages/${message.id}?format=raw`);
  const original = Buffer.from(raw.raw, 'base64');

  const boundary = `cockpit${Date.now()}`;
  const encodedSubject = /^[\x00-\x7F]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;

  const note =
    `Forwarded automatically by the cockpit: this looked like an invoice.\r\n` +
    `Originally from: ${fromName}\r\n` +
    `Original subject: ${subject}\r\n\r\n` +
    `The full message is attached exactly as it arrived.\r\n`;

  const mime = [
    `To: ${to}`,
    `Subject: ${encodedSubject.startsWith('Fwd:') ? encodedSubject : `Fwd: ${encodedSubject}`}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(note, 'utf8').toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: message/rfc822',
    'Content-Disposition: attachment; filename="original.eml"',
    '',
    original.toString('utf8'),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const t = await token(SEND);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(mime) }),
  });

  if (!res.ok) throw new Error(`send failed: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const started = Date.now();

  /*
   * The inbox only.
   *
   * Not everything recent: he processes his inbox to near zero, so a mail he
   * has already archived is one he has already dealt with, and forwarding it
   * now would send finance a pile of things they were sent months ago. What is
   * still sitting in the inbox is what has not been handled — which is exactly
   * the set worth forwarding.
   */
  const scope = process.env.INVOICE_SCOPE ?? 'in:inbox';
  const query = encodeURIComponent(
    `${scope} has:attachment newer_than:${DAYS}d -in:spam -in:trash -from:${MAILBOX}`,
  );
  console.log(`looking in: ${scope}, last ${DAYS} days`);
  const refs = [];
  let pageToken = '';
  do {
    const page = await gmail(`/messages?maxResults=100&q=${query}${pageToken ? `&pageToken=${pageToken}` : ''}`);
    refs.push(...(page.messages ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken && refs.length < MAX);

  console.log(`${refs.length} messages with attachments in the last ${DAYS} days`);

  const state = await agentState(sql, 'invoice-forwarder');
  const gate = mayAct(state, { dry: DRY, force: process.env.FORCE === '1' });
  if (!gate.act && !DRY) {
    console.log(`forwarding nothing: ${gate.why}.`);
    await sql.end();
    process.exit(0);
  }
  if (gate.why) console.log(gate.why);
  console.log(
    state.brief
      ? `checking each one against the brief you wrote it (${state.brief.length} chars).`
      : 'no brief written for it yet — the built-in rules alone decide.',
  );

  let found = 0;
  let sent = 0;
  let held = 0;
  const forwarded = [];

  for (const ref of refs.slice(0, MAX)) {
    const message = await gmail(`/messages/${ref.id}?format=full`);
    const headers = message.payload?.headers ?? [];
    const subject = header(headers, 'subject') ?? '(no subject)';
    const from = header(headers, 'from') ?? '';
    const names = attachmentNames(message.payload);

    const guess = looksLikeInvoice({
      subject,
      snippet: message.snippet ?? '',
      fromEmail: /<([^>]+)>/.exec(from)?.[1] ?? from,
      attachmentNames: names,
    });
    if (!guess.isInvoice) continue;

    found += 1;

    const [already] = await sql`select message_id from invoice_forwards where message_id = ${ref.id}`;
    if (already) {
      console.log(`  already forwarded: ${subject}`);
      continue;
    }

    /*
     * His brief, applied to this one. It can only hold something back — a
     * sentence he wrote about one supplier must never turn into permission to
     * forward something the rules refused.
     */
    const veto = await briefVeto({
      brief: state.brief,
      agent: 'invoice-forwarder',
      what: `forward this email to ${to}, because it looks like an invoice`,
      item: { subject, from, attachments: names.join(', ') },
    });
    if (!veto.go) {
      held += 1;
      console.log(`  left alone: ${subject}\n      ${veto.why}`);
      continue;
    }

    console.log(`  ${DRY ? 'WOULD FORWARD' : 'forwarding'}: ${subject}`);
    console.log(`      from ${from}`);
    console.log(`      ${names.join(', ')}`);
    console.log(`      because it ${guess.reasons.join(' and ')}`);

    if (DRY) continue;

    await forward(message, from, subject);
    await sql`
      insert into invoice_forwards (message_id, thread_id, subject, from_email, forwarded_to)
      values (${ref.id}, ${message.threadId ?? null}, ${subject},
              ${/<([^>]+)>/.exec(from)?.[1] ?? from}, ${to})
      on conflict (message_id) do nothing
    `;
    sent += 1;
    forwarded.push(`• ${subject} — from ${from}`);

    // Recorded before archiving, so a failure here can never cause a second
    // forward on the next run.
    const archived = await archive(ref.id);
    if (archived.ok) {
      await sql`update invoice_forwards set archived_at = now() where message_id = ${ref.id}`;
    }
    console.log(
      archived.ok
        ? '      archived out of the inbox'
        : `      left in the inbox (${archived.reason})`,
    );
  }

  /*
   * Anything already forwarded but still sitting in the inbox.
   *
   * Archiving arrived after the first forwards did, so without this the ones
   * finance already has would stay in front of him for ever — and a rule that
   * only applies to mail arriving from now on is a rule he has to remember the
   * exception to.
   */
  if (!DRY) {
    const stale = await sql`
      select message_id, subject from invoice_forwards where archived_at is null
    `;
    for (const row of stale) {
      const result = await archive(row.message_id);
      if (result.ok) {
        await sql`update invoice_forwards set archived_at = now() where message_id = ${row.message_id}`;
        console.log(`  archived a previously forwarded invoice: ${row.subject}`);
      } else {
        console.log(`  could not archive "${row.subject}": ${result.reason}`);
      }
    }
  }

  console.log(
    `${found} looked like invoices, ${held} held back by your brief, ` +
      `${DRY ? '0 sent (dry run)' : `${sent} forwarded to ${to}`}, ` +
      `in ${Math.round((Date.now() - started) / 1000)}s.`,
  );

  // Only when something actually moved: a job that reports "nothing happened"
  // every run is a job he stops reading.
  if (!DRY && forwarded.length > 0) {
    const said = await postAsBot(
      'money',
      [`:bar_chart: *Invoices sent on to ${to}*`, '', ...forwarded].join('\n'),
    );
    if (!said.ok) console.error(`could not tell him in Slack: ${said.reason}`);
  }

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
