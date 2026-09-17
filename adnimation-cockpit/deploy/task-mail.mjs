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
import postgres from 'postgres';
import { looseCandidates, matchesFor } from './task-mail-match.mjs';
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

const sql = postgres(DB, { max: 2, onnotice: () => {} });

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

async function askClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`claude: http_${res.status} ${(await res.text()).slice(0, 160)}`);

  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? text;
  return JSON.parse(json);
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

  const seeds = threads.map((t) => ({
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

  for (const task of queue) {
    const seed = {
      id: task.id,
      title: task.title,
      description: task.description,
      nextStep: task.next_step,
      tags: task.tags ?? [],
      people: [task.owner_email, ...(peopleOn.get(task.id) ?? [])].filter(Boolean),
      createdAt: new Date(task.created_at).toISOString(),
    };

    // Pass one: what the rules are sure of.
    for (const hit of matchesFor(seed, seeds, PER_TASK)) {
      await write(task.id, hit.threadId, hit.score, hit.reasons, 'auto');
    }

    // Pass two: what only a reader of both languages can tell.
    if (asked >= MODEL_MAX || !process.env.ANTHROPIC_API_KEY) continue;

    const shortlist = looseCandidates(seed, seeds, SHORTLIST)
      .filter((c) => !decided.has(`${task.id}|${c.threadId}`))
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

  await sql`
    insert into task_mail_runs (tasks_seen, threads_seen, links_added, note)
    values (${tasks.length}, ${threads.length}, ${added}, ${`asked the model about ${asked} tasks`})
  `;
  console.log(`${tasks.length} open tasks, ${threads.length} threads, ${added} links, ${asked} asked`);

  await sql.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await sql.end().catch(() => {});
  process.exit(1);
});
