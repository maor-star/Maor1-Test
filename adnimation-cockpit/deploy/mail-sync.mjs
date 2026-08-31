#!/usr/bin/env node
/**
 * Gmail → cockpit mirror, as a standalone job on the server.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… node mail-sync.mjs
 *
 * The rules, which the screen depends on:
 *
 *  - It reads. It never sends, labels, archives or deletes. The scope granted
 *    is gmail.readonly and the cockpit is a reader, not a mail client.
 *  - "Needs a reply" means the last message in the thread is not from him.
 *    That is the only definition that survives contact with a real mailbox:
 *    unread is wrong (he reads on his phone and does not reply) and starred is
 *    wrong (he stars things he has already dealt with).
 *  - "Important" is not Gmail's guess. It is whether the other party is
 *    somebody the company actually deals with — a CRM contact, a company
 *    domain, or a colleague. A mailbox of 151,000 messages has plenty Gmail
 *    thinks are important and he does not.
 *
 * Only recent threads are pulled. The mailbox has fifteen years of history and
 * none of it is a thing he still owes an answer to.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';

const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const DB = process.env.DATABASE_URL;
const DAYS = Number(process.env.MAIL_SYNC_DAYS ?? 30);
const MAX_THREADS = Number(process.env.MAIL_SYNC_MAX ?? 300);
/*
 * Deliberately NOT `in:inbox`.
 *
 * That was the first version and it was wrong: his inbox holds five threads
 * where the mailbox holds four hundred over the same period, because he
 * archives as he reads. The mirror was therefore almost empty and the
 * "waiting on you" panel had nothing to show — it looked calm because it
 * could not see anything, which is the worst way for a panel to be wrong.
 *
 * Waiting is decided by whether the last message is his, which does not need
 * the inbox at all. Chats, spam and trash are excluded because none of them
 * is something he owes an answer to.
 */
const QUERY =
  process.env.MAIL_SYNC_QUERY ?? `newer_than:${DAYS}d -in:chats -in:spam -in:trash`;

/*
 * Labels he applies by hand to mean "this is an opportunity".
 *
 * These are fetched in a second pass with NO date limit and by label id rather
 * than by search text. Both details matter and both were bugs:
 *
 *  - The main pass keeps only the most recent MAIL_SYNC_MAX threads, which in
 *    his mailbox reaches back about a fortnight. He labelled an older
 *    conversation and it was simply never mirrored, so the capture had nothing
 *    to work from. A thread he deliberately labelled is not subject to a
 *    recency window — he chose it.
 *  - `q=label:Name` goes through Gmail's search index and returns nothing for
 *    a freshly applied label. Listing by labelIds is an exact lookup and is
 *    true the moment he clicks.
 */
const CAPTURE_LABELS = (process.env.GMAIL_OPPORTUNITY_LABEL ?? 'Opportunity,הזדמנות')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CAPTURE_MAX = Number(process.env.MAIL_SYNC_CAPTURE_MAX ?? 200);

if (!RAW_KEY || !MAILBOX || !DB) {
  console.error('GOOGLE_SERVICE_ACCOUNT_KEY, GMAIL_MAILBOX and DATABASE_URL are all required.');
  process.exit(1);
}

const key = JSON.parse(
  RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
);
const sql = postgres(DB, { max: 2 });

const b64 = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let token = null;

async function accessToken() {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(
    JSON.stringify({
      iss: key.client_email,
      sub: MAILBOX,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
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
  if (!body.access_token) {
    throw new Error(`gmail auth failed: ${body.error}: ${body.error_description ?? ''}`);
  }
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    if (res.ok) return res.json();
    // 429 and 5xx are worth waiting out; the rest are real.
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 401) {
      token = null;
      continue;
    }
    throw new Error(`gmail ${path} failed: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`gmail ${path} kept failing`);
}

/** "Ravit Cohen <ravit@markito.com>" → both halves, either possibly missing. */
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

/**
 * Gmail returns label IDs, not names — 'Label_8231773…' rather than
 * 'Opportunity'. The names are what he sees and what he can be asked to use,
 * so they are resolved once per run and stored instead of the ids.
 */
async function labelNames() {
  const res = await api('/labels');
  const byId = new Map();
  for (const l of res.labels ?? []) byId.set(l.id, l.name);
  return byId;
}

const header = (headers, name) =>
  headers.find((h) => h.name.toLowerCase() === name)?.value ?? null;

async function main() {
  const started = Date.now();
  await accessToken();

  // A capture label that does not work is almost always a name that is not
  // quite what anyone assumed — nested under a parent, or with a stray space.
  // Printing the list is faster than guessing.
  if (process.env.MAIL_SYNC_LIST_LABELS === '1') {
    console.log(`mailbox: ${MAILBOX}`);
    const labels = await labelNames();
    const filter = process.env.MAIL_SYNC_LABEL_FILTER;
    for (const [id, name] of labels) {
      if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
      // labels.get is authoritative about how many threads carry a label —
      // unlike a q=label: search, which goes through the search index.
      const detail = await api(`/labels/${encodeURIComponent(id)}`);
      console.log(
        `[${JSON.stringify(name)}] id=${id} threads=${detail.threadsTotal ?? '?'} ` +
          `messages=${detail.messagesTotal ?? '?'}`,
      );
    }
    await sql.end();
    process.exit(0);
  }

  // Everyone the company deals with, so "important" means something.
  const [contacts, companies, colleagues] = await Promise.all([
    sql`select lower(email) as email, company_name from crm_contacts
        where email is not null and archived_at is null`,
    sql`select lower(domain) as domain, name from crm_companies
        where domain is not null and archived_at is null`,
    sql`select lower(email) as email, name from people where active`,
  ]);

  const byEmail = new Map();
  for (const c of contacts) byEmail.set(c.email, c.company_name ?? null);
  for (const p of colleagues) byEmail.set(p.email, 'Adnimation');

  const byDomain = new Map();
  for (const c of companies) if (c.domain) byDomain.set(c.domain.replace(/^www\./, ''), c.name);

  console.log(
    `known: ${byEmail.size} addresses, ${byDomain.size} company domains`,
  );

  const labels = await labelNames();
  console.log(`${labels.size} labels in the mailbox`);

  const query = encodeURIComponent(QUERY);
  const threads = [];
  let pageToken = '';

  do {
    const page = await api(
      `/threads?maxResults=100&q=${query}${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
    threads.push(...(page.threads ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken && threads.length < MAX_THREADS);

  console.log(`${threads.length} threads matching "${QUERY}"`);

  // Second pass: everything he has labelled, however old, by label id.
  const seenIds = new Set(threads.map((t) => t.id));
  let capturedCount = 0;

  for (const name of CAPTURE_LABELS) {
    const labelId = [...labels.entries()].find(
      ([, n]) => n.trim().toLowerCase() === name.trim().toLowerCase(),
    )?.[0];
    if (!labelId) continue;

    let capturePage = '';
    let found = 0;
    do {
      const page = await api(
        `/threads?maxResults=100&labelIds=${encodeURIComponent(labelId)}` +
          `${capturePage ? `&pageToken=${capturePage}` : ''}`,
      );
      for (const ref of page.threads ?? []) {
        found += 1;
        if (seenIds.has(ref.id)) continue;
        seenIds.add(ref.id);
        threads.push(ref);
        capturedCount += 1;
      }
      capturePage = page.nextPageToken ?? '';
    } while (capturePage && found < CAPTURE_MAX);

    console.log(`label "${name}": ${found} threads, ${capturedCount} of them outside the window`);
  }

  const rows = [];
  // MAX_THREADS caps the recency pass; the labelled ones are already deduped
  // above and must all be kept, so the cap is raised by however many there are.
  for (const ref of threads.slice(0, MAX_THREADS + capturedCount)) {
    const thread = await api(
      `/threads/${ref.id}?format=metadata` +
        '&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date',
    );
    const messages = thread.messages ?? [];
    if (messages.length === 0) continue;

    const last = messages[messages.length - 1];
    const first = messages[0];
    const lastHeaders = last.payload?.headers ?? [];
    const from = parseAddress(header(lastHeaders, 'from'));
    const lastFromMe = from.email === MAILBOX.toLowerCase();

    // The other party is whoever is not him — taken from the last message they
    // sent, so a thread he replied to last still shows who it is with.
    let counterpart = { name: null, email: null };
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = parseAddress(header(messages[i].payload?.headers ?? [], 'from'));
      if (candidate.email && candidate.email !== MAILBOX.toLowerCase()) {
        counterpart = candidate;
        break;
      }
    }
    if (!counterpart.email) counterpart = from;

    const participants = new Set();
    for (const m of messages) {
      const hs = m.payload?.headers ?? [];
      for (const field of ['from', 'to', 'cc']) {
        for (const part of (header(hs, field) ?? '').split(',')) {
          const a = parseAddress(part);
          if (a.email) participants.add(a.email);
        }
      }
    }

    // Stored as names, so a label he applies in Gmail is something the rest of
    // the system can actually match on.
    const threadLabels = new Set();
    for (const m of messages) {
      for (const id of m.labelIds ?? []) threadLabels.add(labels.get(id) ?? id);
    }

    const domain = (counterpart.email ?? '').split('@')[1]?.replace(/^www\./, '') ?? '';
    const knownCompany = byEmail.get(counterpart.email ?? '') ?? byDomain.get(domain) ?? null;

    rows.push({
      thread_id: thread.id,
      subject: header(lastHeaders, 'subject') ?? header(first.payload?.headers ?? [], 'subject'),
      snippet: last.snippet ?? null,
      counterpart_name: counterpart.name,
      counterpart_email: counterpart.email,
      participants: [...participants],
      message_count: messages.length,
      last_message_at: new Date(Number(last.internalDate ?? Date.now())),
      first_message_at: new Date(Number(first.internalDate ?? Date.now())),
      last_from_me: lastFromMe,
      unread: threadLabels.has('UNREAD'),
      starred: threadLabels.has('STARRED'),
      gmail_important: threadLabels.has('IMPORTANT'),
      known_contact: knownCompany !== null,
      known_company: knownCompany,
      labels: [...threadLabels],
      synced_at: new Date(),
    });
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await sql`
        insert into mail_threads ${sql(batch)}
        on conflict (thread_id) do update set
          subject = excluded.subject,
          snippet = excluded.snippet,
          counterpart_name = excluded.counterpart_name,
          counterpart_email = excluded.counterpart_email,
          participants = excluded.participants,
          message_count = excluded.message_count,
          last_message_at = excluded.last_message_at,
          first_message_at = excluded.first_message_at,
          last_from_me = excluded.last_from_me,
          unread = excluded.unread,
          starred = excluded.starred,
          gmail_important = excluded.gmail_important,
          known_contact = excluded.known_contact,
          known_company = excluded.known_company,
          labels = excluded.labels,
          synced_at = excluded.synced_at
      `;
    }
  }

  // A thread he has since answered stops needing an answer, so clear the
  // dismissal — otherwise dismissing once hides it for good.
  await sql`update mail_threads set dismissed_at = null where last_from_me = true`;

  /*
   * Drop anything that has since moved to trash or spam.
   *
   * This is a mirror of Gmail, not a record of its own, and the query no
   * longer returns those — so without this they would sit here for ever,
   * counted as waiting on him. Cache eviction, not deletion of anything the
   * cockpit owns: an opportunity captured from such a thread keeps its own row
   * and its link.
   */
  const pruned = await sql`
    delete from mail_threads
    where labels && array['TRASH','SPAM']
    returning thread_id
  `;
  if (pruned.length > 0) console.log(`pruned ${pruned.length} trashed or spam threads`);

  const [counts] = await sql`
    select
      count(*) as total,
      count(*) filter (where last_from_me = false and dismissed_at is null) as waiting,
      count(*) filter (where last_from_me = false and dismissed_at is null and known_contact) as waiting_known
    from mail_threads
  `;

  console.log(
    `synced ${rows.length} threads in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `Holding ${counts.total}, ${counts.waiting} awaiting a reply, ${counts.waiting_known} of those from someone we deal with.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
