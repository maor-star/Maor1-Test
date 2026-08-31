#!/usr/bin/env node
/**
 * Read a year of his own replies, and learn how he answers.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… \
 *   ANTHROPIC_API_KEY=… node mail-learn.mjs
 *
 * The mail answerer's hardest problem is not deciding what to answer — the
 * rules do that — it is sounding like him. A model with no examples writes
 * competent, warm, slightly long English. He writes three lines, switches to
 * Hebrew when they do, and signs off with his first name.
 *
 * So this reads what he actually sent: for each of his replies in the last
 * year, the message he was answering and the answer he gave. It looks at them
 * in batches, then consolidates one profile of how he writes.
 *
 * What it deliberately does NOT do:
 *
 * · Learn what to answer. The NEVER list is a rule, not a habit, and a year of
 *   mail contains plenty of contract threads he answered himself. Learning
 *   "he replies about contracts" from that would be exactly wrong.
 * · Keep the mail. Only a handful of pairs are stored as examples so he can
 *   see what it read; the rest is used and dropped.
 * · Touch his instructions. What he wrote stays his.
 *
 * DAYS=365 LEARN_MAX=300 are the defaults. DRY=1 reads and reports without
 * writing anything.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const CLAUDE = process.env.ANTHROPIC_API_KEY;
const AGENT = process.env.LEARN_AGENT ?? 'mail-answerer';
const DAYS = Number(process.env.DAYS ?? 365);
const MAX = Number(process.env.LEARN_MAX ?? 300);
const BATCH = Number(process.env.LEARN_BATCH ?? 15);
const DRY = process.env.DRY === '1';

if (!DB || !RAW_KEY || !MAILBOX) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}
if (!CLAUDE) {
  console.error('ANTHROPIC_API_KEY is required — there is nothing to learn with.');
  process.exit(78);
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

  if (!body.access_token) throw new Error(`${scope}: ${body.error}`);
  tokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

const READ = 'https://www.googleapis.com/auth/gmail.readonly';

async function gmail(path) {
  const t = await token(READ);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const header = (hs, name) => hs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

function plainText(part, out = []) {
  if (!part) return out;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.push(Buffer.from(part.body.data, 'base64').toString('utf8'));
  }
  for (const child of part.parts ?? []) plainText(child, out);
  return out;
}

/**
 * Everything below a quoted-reply marker is the message he was answering, not
 * his words. Learning his style from text he did not write is the one way this
 * job can be confidently wrong.
 */
function ownWords(text) {
  const cut = text.search(
    /^(On .+ wrote:|-{2,} ?Original Message|_{5,}|From: |ב.+ בשעה .+ מאת)/m,
  );
  const body = cut > 0 ? text.slice(0, cut) : text;
  return body
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
    .trim();
}

const hasHebrew = (s) => /[֐-׿]/.test(s);

/** His replies in the window, each with the message it answered. */
async function pairs() {
  const out = [];
  let pageToken;

  while (out.length < MAX) {
    const page = await gmail(
      `/messages?maxResults=100&q=${encodeURIComponent(`in:sent newer_than:${DAYS}d`)}` +
        (pageToken ? `&pageToken=${pageToken}` : ''),
    );
    const refs = page.messages ?? [];
    if (refs.length === 0) break;

    for (const ref of refs) {
      if (out.length >= MAX) break;

      const message = await gmail(`/messages/${ref.id}?format=full`).catch(() => null);
      if (!message) continue;

      const hs = message.payload?.headers ?? [];
      const mine = ownWords(plainText(message.payload).join('\n'));
      // A one-word reply teaches nothing; a forwarded deck is not his writing.
      if (mine.length < 20 || mine.length > 2000) continue;

      const thread = await gmail(`/threads/${message.threadId}?format=full`).catch(() => null);
      if (!thread) continue;

      const messages = thread.messages ?? [];
      const index = messages.findIndex((m) => m.id === message.id);
      const before = messages.slice(0, index === -1 ? messages.length : index).reverse()
        .find((m) => !(header(m.payload?.headers ?? [], 'from') ?? '').includes(MAILBOX));
      if (!before) continue; // Not a reply — something he started.

      out.push({
        subject: header(hs, 'subject') ?? '',
        to: header(hs, 'to') ?? '',
        theirs: ownWords(plainText(before.payload).join('\n') || before.snippet || '').slice(0, 1500),
        mine: mine.slice(0, 1500),
      });
    }

    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  return out;
}

async function ask(system, prompt, maxTokens = 1500) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.ok) {
      const body = await res.json();
      return (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    }
    // Only worth retrying what might pass next time.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`claude: http_${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error('claude: gave up after three attempts');
}

const BATCH_SYSTEM = `You are reading real email replies written by Maor
Davidovich, CEO of Adnimation, to learn how he writes — not what he decides.

For this batch, note only what is observable and would help someone draft in
his voice: greeting and sign-off, sentence length, how long a reply usually is,
when he writes Hebrew and when English, how direct he is, what he does when he
does not have an answer, punctuation and formatting habits, and any phrase he
uses repeatedly.

Ignore the content of the deals. Do not infer policies about what he is willing
to agree to. Six to ten short bullets.`;

const FINAL_SYSTEM = `You are writing the style guide a drafting assistant will
read before writing an email as Maor Davidovich.

You are given observations from several batches of his real replies. Consolidate
them into one profile, under 1500 characters, in these sections:

OPENING · LENGTH · TONE · LANGUAGE · SIGN-OFF · HABITS · WHEN UNSURE

Write it as instructions to the drafter ("open with…", "keep to…"), not as
description. Only include what the observations support — where they disagree,
say what varies and on what. Nothing about what he agrees to, only how he
writes.`;

async function main() {
  const started = new Date();
  if (!DRY) {
    await sql`
      insert into agent_learning (agent_name, started_at, error)
      values (${AGENT}, ${started}, null)
      on conflict (agent_name) do update set started_at = ${started}, error = null
    `;
  }

  console.log(`reading up to ${MAX} of your replies from the last ${DAYS} days…`);
  const found = await pairs();
  console.log(`${found.length} replies with something to learn from`);

  if (found.length < 10) {
    const why = `only ${found.length} usable replies were found — too few to learn from`;
    console.log(why);
    if (!DRY) await sql`update agent_learning set error = ${why} where agent_name = ${AGENT}`;
    await sql.end();
    process.exit(0);
  }

  // Plain facts first, so there is something true even if the model fails.
  const hebrew = found.filter((p) => hasHebrew(p.mine)).length;
  const lengths = found.map((p) => p.mine.length).sort((a, b) => a - b);
  const facts = {
    replies: found.length,
    hebrewShare: Math.round((hebrew / found.length) * 100),
    medianLength: lengths[Math.floor(lengths.length / 2)] ?? 0,
    shortest: lengths[0] ?? 0,
    longest: lengths[lengths.length - 1] ?? 0,
    windowDays: DAYS,
  };
  console.log(
    `median reply ${facts.medianLength} characters, ${facts.hebrewShare}% with Hebrew in them`,
  );

  const observations = [];
  for (let i = 0; i < found.length; i += BATCH) {
    const batch = found.slice(i, i + BATCH);
    const prompt = batch
      .map(
        (p, n) =>
          `--- ${n + 1} ---\nSubject: ${p.subject}\nThey wrote:\n${p.theirs}\n\nHe replied:\n${p.mine}`,
      )
      .join('\n\n');
    const text = await ask(BATCH_SYSTEM, prompt, 800).catch((e) => {
      console.error(`  batch ${i / BATCH + 1} failed: ${e.message}`);
      return '';
    });
    if (text) observations.push(text.trim());
    console.log(`  read ${Math.min(i + BATCH, found.length)}/${found.length}`);
  }

  if (observations.length === 0) throw new Error('every batch failed — nothing was learned');

  const profile = (await ask(FINAL_SYSTEM, observations.join('\n\n'), 1200)).trim();
  console.log('\n--- what it learned ---\n');
  console.log(profile);

  // A few real pairs, so he can see what it read rather than trust it.
  const examples = found
    .slice(0, 5)
    .map((p) => ({ subject: p.subject, theirs: p.theirs.slice(0, 300), mine: p.mine.slice(0, 300) }));

  if (DRY) {
    console.log('\ndry run — nothing was saved.');
    await sql.end();
    process.exit(0);
  }

  /*
   * A profile he has edited is his, not ours. Retraining keeps his text and
   * says so rather than quietly replacing what he wrote.
   */
  const [existing] = await sql`
    select edited_by_him from agent_learning where agent_name = ${AGENT}
  `;
  if (existing?.edited_by_him) {
    console.log('\nyou have edited this profile, so it was left alone. Clear it first to retrain.');
    await sql`
      update agent_learning
      set facts = ${sql.json(facts)}, threads_read = ${found.length}, learned_at = now()
      where agent_name = ${AGENT}
    `;
  } else {
    await sql`
      update agent_learning
      set profile = ${profile}, examples = ${sql.json(examples)}, facts = ${sql.json(facts)},
          threads_read = ${found.length}, learned_at = now(), error = null
      where agent_name = ${AGENT}
    `;
  }

  console.log(`\nlearned from ${found.length} replies in ${Math.round((Date.now() - started) / 1000)}s.`);
  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql`update agent_learning set error = ${String(e.message ?? e)} where agent_name = ${AGENT}`
    .catch(() => {});
  await sql.end().catch(() => {});
  process.exit(1);
});
