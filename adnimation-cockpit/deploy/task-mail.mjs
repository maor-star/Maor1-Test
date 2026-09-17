#!/usr/bin/env node
/**
 * The tasks fish their own mail out of the mailbox, and keep fishing.
 *
 *   DATABASE_URL=… ANTHROPIC_API_KEY=… node task-mail.mjs
 *
 * He asked for every task to carry the emails that are about it, kept up to
 * date rather than filed by hand. The mailbox is already mirrored into
 * mail_threads by mail-sync.mjs; this reads that mirror, decides which threads
 * belong to which open task, and writes the links.
 *
 * Two passes, because one is not enough:
 *
 *  1. The RULES (task-mail-match.mjs, generated from lib/tasks/mail-match.ts).
 *     Cheap, exact, and deliberately strict: a person alone is never a match,
 *     recency alone is never a match, and a real overlap of words that mean
 *     something is required. What it finds, it is sure of.
 *
 *  2. The MODEL, for what the rules cannot see. His tasks are written in
 *     Hebrew and most of the mail about them is in English — "לחבר את נקססן
 *     מחדש ל CTV" and "Nexxen CTV reconnect" are the same piece of work and
 *     share one token between them. No word rule bridges that. So the loose
 *     pass builds a shortlist of anything plausible and asks Claude which of
 *     them are actually about the task, in both languages, with a reason.
 *
 * Bounded on purpose: at most TASK_MAIL_MODEL_MAX tasks go to the model in one
 * run, oldest-looked-at first, so a run costs a known amount however many
 * tasks are open. The rules pass always covers everything.
 *
 * It only ever READS the mailbox. Nothing here sends, labels or archives.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';
import { digestsIn, looseCandidates, othersOn, sweepMatches } from './task-mail-match.mjs';
import { bodyToStore } from './task-mail-body.mjs';
import { loadSecrets } from './job-secrets.mjs';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const WINDOW_DAYS = Number(process.env.TASK_MAIL_DAYS ?? 120);
const PER_TASK = Number(process.env.TASK_MAIL_PER_TASK ?? 5);
const MODEL_MAX = Number(process.env.TASK_MAIL_MODEL_MAX ?? 25);
const SHORTLIST = Number(process.env.TASK_MAIL_SHORTLIST ?? 10);
/** How many threads may have their messages copied in per run. */
const BODIES_MAX = Number(process.env.TASK_MAIL_BODIES_MAX ?? 60);
/** A message longer than this is stored cut, and says so. */
const BODY_CHARS = Number(process.env.TASK_MAIL_BODY_CHARS ?? 12_000);
const MAILBOX = process.env.GMAIL_MAILBOX;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

const sql = postgres(DB, { max: 2, onnotice: () => {} });

/* ------------------------------------------------------- reading the mail */

/*
 * Gmail, read-only, through the service account that already mirrors the
 * mailbox. The scope granted is gmail.readonly and this job asks for nothing
 * else: it copies what was said and never sends, labels or archives.
 */
const b64 = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let googleToken = null;

async function accessToken() {
  if (googleToken && googleToken.expiresAt > Date.now() + 60_000) return googleToken.value;
  if (!RAW_KEY || !MAILBOX) return null;

  const key = JSON.parse(
    RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
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
  signer.update(`${head}.${claims}`);
  const assertion = `${head}.${claims}.${b64(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json();
  if (!body.access_token) {
    throw new Error(`gmail auth failed: ${body.error}: ${body.error_description ?? ''}`);
  }
  googleToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return googleToken.value;
}

async function gmail(path) {
  const t = await accessToken();
  if (!t) return null;
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

const headerOf = (hs, name) =>
  (hs ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

/**
 * Plain text out of a MIME tree.
 *
 * text/plain only. A Gmail message carries the same words twice — once as text
 * and once as HTML full of layout — and storing the HTML would mean either
 * rendering someone else's markup in his cockpit or showing him a page of
 * tags. The text part is what was written.
 */
function plainText(part, out = []) {
  if (!part) return out;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.push(Buffer.from(part.body.data, 'base64').toString('utf8'));
  }
  for (const child of part.parts ?? []) plainText(child, out);
  return out;
}

function hasFiles(part) {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return (part.parts ?? []).some(hasFiles);
}

/** "Dan Levi <dan@nexxen.com>" → the two halves. */
function whoSent(raw) {
  const value = String(raw ?? '').trim();
  const angled = /^(.*?)\s*<([^>]+)>$/.exec(value);
  if (angled) return { name: (angled[1] ?? '').replace(/^"|"$/g, '').trim() || null, email: (angled[2] ?? '').toLowerCase() };
  return { name: null, email: value.toLowerCase() || null };
}

/**
 * Copy one thread's messages in.
 *
 * Idempotent on message id, so a thread that has grown since the last run
 * gains its new messages and the old ones are left alone.
 */
async function copyThread(threadId) {
  const thread = await gmail(`/threads/${threadId}?format=full`);
  if (!thread) return 0;

  const messages = thread.messages ?? [];
  for (const m of messages) {
    const hs = m.payload?.headers ?? [];
    const from = whoSent(headerOf(hs, 'from'));
    /*
     * The message, not the conversation it is replying to.
     *
     * Gmail's plain-text part carries the whole quoted history under every
     * reply, so storing it as it came meant a thread of eight messages was the
     * same words stored eight times — and the newest message, which is the one
     * he opened the task to read, was the likeliest to hit the cap.
     */
    const text = plainText(m.payload).join('\n').trim() || m.snippet || '';
    const stored = bodyToStore(text, BODY_CHARS);

    await sql`
      insert into mail_messages
        (message_id, thread_id, from_name, from_email, to_line, sent_at, from_me, body, truncated, has_files)
      values (
        ${m.id}, ${threadId}, ${from.name}, ${from.email},
        ${headerOf(hs, 'to')},
        ${m.internalDate ? new Date(Number(m.internalDate)) : null},
        ${Boolean(MAILBOX && from.email && from.email.includes(String(MAILBOX).toLowerCase()))},
        ${stored.body}, ${stored.truncated}, ${hasFiles(m.payload)}
      )
      on conflict (message_id) do update
        set body = excluded.body,
            truncated = excluded.truncated,
            has_files = excluded.has_files,
            fetched_at = now()
    `;
  }

  await sql`
    update mail_threads
       set bodies_at = now(), bodies_count = ${messages.length}
     where thread_id = ${threadId}
  `;
  return messages.length;
}

const SYSTEM = `You decide which email threads are about a given work task.

The task is usually written in Hebrew. The mail is usually in English. They are
about the same business — an Israeli ad-tech company — so the same thing is
often named differently on each side: a partner's name transliterated, a product
called by its English name inside a Hebrew sentence.

Say yes ONLY when the thread is about THAT task: the same piece of work, the
same partner, the same decision. Being from the same person, or about the same
general area, is not enough — he will see a wrong one and stop reading them.

Answer JSON only: {"about":[{"id":"<thread id>","why":"<four words, English>"}]}
An empty list is the right answer most of the time.`;

/**
 * Ask the model, and be honest about what came back.
 *
 * The first live run failed twenty-five times with "Unexpected end of JSON
 * input" — which was `res.json()` throwing on an empty body, not the model
 * answering badly. The difference matters and the old code could not tell
 * them apart, so this reads the text first and says what it actually got.
 *
 * One retry on a transient failure, then it gives up on that task rather than
 * holding the whole sweep.
 */
async function askClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      // 429 and 529 are worth one more go; a 400 never is.
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) continue;
      throw new Error(`http_${res.status} ${raw.slice(0, 160)}`);
    }
    if (raw.trim() === '') {
      if (attempt === 0) continue;
      throw new Error('empty body from the model');
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(`unparseable response: ${raw.slice(0, 160)}`);
    }

    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (!json) {
      // No object at all is the model declining to answer in the shape asked
      // for. That is "nothing matched" as far as this job is concerned, not a
      // failure worth a line in the log for every task.
      return { about: [] };
    }
    try {
      return JSON.parse(json);
    } catch {
      throw new Error(`answer was not JSON: ${text.slice(0, 160)}`);
    }
  }
  return null;
}

function prompt(task, candidates) {
  const lines = candidates.map(
    (c) => `- id: ${c.threadId}\n  subject: ${c.subject ?? '(none)'}\n  with: ${c.counterpartName ?? c.counterpartEmail ?? 'unknown'}\n  snippet: ${(c.snippet ?? '').slice(0, 220)}`,
  );
  return [
    `TASK: ${task.title}`,
    task.next_step ? `NEXT MOVE: ${task.next_step}` : null,
    task.description ? `NOTES: ${String(task.description).slice(0, 400)}` : null,
    '',
    'THREADS:',
    ...lines,
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const filled = await loadSecrets(sql, ['ANTHROPIC_API_KEY']);
  if (filled.length > 0) console.log(`took ${filled.join(', ')} from the app's keys`);

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [tasks, threads, assignees, existing] = await Promise.all([
    sql`
      select t.id, t.title, t.description, t.next_step, t.tags, t.created_at,
             p.email as owner_email,
             (select max(m.matched_at) from task_mail m where m.task_id = t.id) as last_link
        from tasks t
        left join people p on p.id = t.owner_person_id
       where t.archived_at is null and t.status <> 'done'
    `,
    sql`
      select thread_id, subject, snippet, counterpart_name, counterpart_email,
             participants, labels, last_message_at
        from mail_threads
       where last_message_at >= ${since}
       order by last_message_at desc
    `,
    sql`
      select a.task_id, p.email
        from task_assignees a join people p on p.id = a.person_id
    `,
    // Every pair already decided, dismissals included — the model is never
    // asked about a thread he has already thrown off this task.
    sql`select task_id, thread_id from task_mail`,
  ]);

  const peopleOn = new Map();
  for (const row of assignees) {
    const held = peopleOn.get(row.task_id) ?? [];
    held.push(row.email);
    peopleOn.set(row.task_id, held);
  }

  const decided = new Set(existing.map((r) => `${r.task_id}|${r.thread_id}`));
  const byThread = new Map(threads.map((t) => [t.thread_id, t]));

  const threadSeeds = threads.map((t) => ({
    threadId: t.thread_id,
    subject: t.subject,
    snippet: t.snippet,
    counterpartName: t.counterpart_name,
    counterpartEmail: t.counterpart_email,
    participants: t.participants ?? [],
    labels: t.labels ?? [],
    lastMessageAt: new Date(t.last_message_at).toISOString(),
  }));

  let added = 0;
  let asked = 0;

  const write = async (taskId, threadId, score, reasons, by) => {
    const t = byThread.get(threadId);
    await sql`
      insert into task_mail (task_id, thread_id, score, reasons, subject, counterpart, last_message_at, matched_by)
      values (${taskId}, ${threadId}, ${score}, ${reasons}, ${t?.subject ?? null},
              ${t?.counterpart_name ?? t?.counterpart_email ?? null}, ${t?.last_message_at ?? null}, ${by})
      on conflict (task_id, thread_id) do update
        set score = excluded.score,
            reasons = excluded.reasons,
            subject = excluded.subject,
            counterpart = excluded.counterpart,
            last_message_at = excluded.last_message_at
    `;
    added += 1;
  };

  /*
   * The model's turn goes to the tasks that have waited longest for it — a
   * task nothing has ever been linked to first, then the least recently
   * looked at. Over a few runs the whole board is covered, and no run is
   * unbounded.
   */
  const queue = [...tasks].sort((a, b) => {
    if (!a.last_link && b.last_link) return -1;
    if (a.last_link && !b.last_link) return 1;
    return new Date(a.last_link ?? 0) - new Date(b.last_link ?? 0);
  });

  const seedOf = (task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    nextStep: task.next_step,
    tags: task.tags ?? [],
    // His own address is in every thread in his own mailbox, so it says
    // nothing about which task a thread is about.
    people: othersOn(
      [task.owner_email, ...(peopleOn.get(task.id) ?? [])].filter(Boolean),
      process.env.GMAIL_MAILBOX,
    ),
    createdAt: new Date(task.created_at).toISOString(),
  });

  /*
   * Pass one, over the whole board at once rather than task by task.
   *
   * A digest — the cockpit's own Daily Summary, which lists his tasks — is a
   * perfect match to each of the twenty-seven tasks it names and belongs to
   * none of them. That is only visible from a pass that can see all of them,
   * which is why this is not a loop.
   */
  const taskSeeds = queue.map(seedOf);
  const matched = sweepMatches(taskSeeds, threadSeeds, PER_TASK);

  /*
   * The digests, kept out of the model's shortlist too.
   *
   * The rules already drop a thread that is about everything, but the model
   * was still being handed the Daily Summary — which quotes his task list —
   * and answering, quite correctly, "ClickUp task matches exactly". It was
   * right about the words and wrong about the question, because it could only
   * see one task at a time. Neither pass sees them now.
   */
  const digests = new Set(digestsIn(taskSeeds, threadSeeds, PER_TASK));
  if (digests.size > 0) console.log(`ignoring ${digests.size} threads that match half the board`);

  for (const task of queue) {
    const seed = seedOf(task);

    for (const hit of matched.get(task.id) ?? []) {
      await write(task.id, hit.threadId, hit.score, hit.reasons, 'auto');
    }

    // Pass two: what only a reader of both languages can tell.
    if (asked >= MODEL_MAX || !process.env.ANTHROPIC_API_KEY) continue;

    const shortlist = looseCandidates(seed, threadSeeds, SHORTLIST)
      .filter((c) => !decided.has(`${task.id}|${c.threadId}`) && !digests.has(c.threadId))
      .map((c) => byThread.get(c.threadId))
      .filter(Boolean);
    if (shortlist.length === 0) continue;

    asked += 1;
    try {
      const answer = await askClaude(prompt(task, shortlist.map((t) => ({
        threadId: t.thread_id,
        subject: t.subject,
        snippet: t.snippet,
        counterpartName: t.counterpart_name,
        counterpartEmail: t.counterpart_email,
      }))));
      for (const pick of answer?.about ?? []) {
        if (!byThread.has(pick.id)) continue;
        if (decided.has(`${task.id}|${pick.id}`)) continue;
        const why = String(pick.why ?? 'read as the same work').slice(0, 60);
        await write(task.id, pick.id, 60, [why], 'claude');
        decided.add(`${task.id}|${pick.id}`);
      }
    } catch (e) {
      console.error(`model pass failed on ${task.id}: ${e.message}`);
    }
  }

  /*
   * The mail itself, copied in for the threads a task is now linked to.
   *
   * After the matching, because there is no point fetching a body for a thread
   * that turned out to belong to nothing. Oldest-copied first and bounded, so
   * a run costs a known amount and a thread that has grown since gets its new
   * messages on the next pass rather than holding this one.
   */
  let copied = 0;
  if (RAW_KEY && MAILBOX) {
    const wanted = await sql`
      select distinct m.thread_id, t.bodies_at, t.message_count, t.bodies_count
        from task_mail m
        join mail_threads t on t.thread_id = m.thread_id
       where m.dismissed_at is null
         and (t.bodies_at is null or t.bodies_count < t.message_count)
       order by t.bodies_at asc nulls first
       limit ${BODIES_MAX}
    `;
    for (const row of wanted) {
      try {
        const n = await copyThread(row.thread_id);
        if (n > 0) copied += 1;
      } catch (e) {
        console.error(`could not copy ${row.thread_id}: ${e.message}`);
      }
    }
    console.log(`copied ${copied} threads in`);
  } else {
    console.log('no mailbox credential — links only, no bodies');
  }

  await sql`
    insert into task_mail_runs (tasks_seen, threads_seen, links_added, note)
    values (
      ${tasks.length}, ${threads.length}, ${added},
      ${`asked the model about ${asked} tasks; copied ${copied} threads in`}
    )
  `;
  console.log(
    `${tasks.length} open tasks, ${threads.length} threads, ${added} links, ${asked} asked, ${copied} copied`,
  );

  await sql.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await sql.end().catch(() => {});
  process.exit(1);
});
