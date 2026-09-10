#!/usr/bin/env node
/**
 * Looks for the answers to what he handed over, and marks what has gone quiet.
 *
 *   DATABASE_URL=… node delegation-watch.mjs
 *
 * He asked for this in one line: "scan the replies all the time, and check for
 * an answer by email too."
 *
 * Until now neither happened on its own. The reply check ran only when he
 * opened the delegations screen and pressed a button, and the three-day stale
 * check was written as an Inngest function — and Inngest is not configured on
 * this box, so it had never run once. A hand-over that was answered kept
 * showing as unanswered until he went looking, which is the opposite of what a
 * tracker is for.
 *
 * Two passes, both idempotent:
 *   · find replies — in the Slack thread, and now in the mailbox
 *   · mark anything with no movement for three days as stale, and raise one
 *     alert for each that just flipped
 *
 * It writes nothing outward. Nobody is chased by this job; it only notices.
 */
import postgres from 'postgres';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const STALE_DAYS = 3;
const sql = postgres(DB, { max: 2, onnotice: () => {} });

const SLACK = process.env.SLACK_BOT_TOKEN;
const GMAIL_READY = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GMAIL_MAILBOX);

/** The channel and ts out of a Slack permalink. */
function parsePermalink(url) {
  const m = /archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(String(url ?? ''));
  return m ? { channel: m[1], ts: `${m[2]}.${m[3]}` } : null;
}

const slackGet = async (method, params) => {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${SLACK}` },
  }).catch(() => null);
  return res?.json().catch(() => null) ?? null;
};

/** Their message, shaped the way the delegation row stores a reply. */
const asReply = (m, row) => ({
  channel: 'slack',
  author: m.user ?? 'someone',
  excerpt: String(m.text ?? '').slice(0, 500),
  at: new Date(Number(m.ts) * 1000),
  url: row.slack_message_url,
});

/** Ours is the ask, not the answer. */
const isTheirs = (m, sentAt) =>
  !m.bot_id && m.subtype !== 'bot_message' && Number(m.ts) > sentAt;

/**
 * Anything they said after the hand-over went out — in the thread, or not.
 *
 * It used to read the thread alone, and that is not how anybody answers a
 * direct message. A hand-over to one person goes to their DM, and a person
 * replying in a DM types into the conversation; they do not hover the message
 * and choose "reply in thread". So the answer arrived, sat in the DM, and the
 * tracker went on saying nobody had replied until it marked the whole thing
 * stale three days later.
 *
 * The thread first, because a threaded reply is unambiguously about this ask.
 * Then the conversation itself. Reading it needs im:history for a DM,
 * channels:history for a channel and groups:history for a private one — the
 * bot has all three already, so this is a fix and not a permission.
 */
async function slackReply(row) {
  if (!SLACK) return null;
  const at = row.slack_channel_id && row.slack_thread_ts
    ? { channel: row.slack_channel_id, ts: row.slack_thread_ts }
    : parsePermalink(row.slack_message_url);
  if (!at) return null;

  const sentAt = new Date(row.delegated_at).getTime() / 1000;

  const thread = await slackGet('conversations.replies', { channel: at.channel, ts: at.ts, limit: 20 });
  for (const m of thread?.ok ? (thread.messages ?? []) : []) {
    if (isTheirs(m, sentAt)) return asReply(m, row);
  }

  const history = await slackGet('conversations.history', {
    channel: at.channel,
    oldest: at.ts,
    limit: 30,
  });
  if (!history?.ok) return null;

  /*
   * In a DM the only other participant is the person it went to, so any
   * message that is not ours is theirs. In a channel somebody else may answer
   * — and that is still an answer to the ask, so it counts, with their name on
   * it rather than a guess.
   *
   * Newest last out of Slack, so this walks it oldest-first to report the
   * first answer rather than the most recent remark.
   */
  const messages = [...(history.messages ?? [])].sort((a, b) => Number(a.ts) - Number(b.ts));
  for (const m of messages) {
    if (isTheirs(m, sentAt)) return asReply(m, row);
  }
  return null;
}

/**
 * A mail from them since the hand-off.
 *
 * The mirror already holds every thread and who it is with, so this is a
 * question for the cockpit's own table rather than a call to Gmail: a message
 * from that address, arriving after it went out, that they sent rather than
 * he did.
 */
async function mailReply(row) {
  if (!row.person_email || row.person_email.endsWith('@slack.local')) return null;

  const [thread] = await sql`
    select thread_id, subject, snippet, last_message_at
    from mail_threads
    where lower(counterpart_email) = ${row.person_email.toLowerCase()}
      and last_from_me = false
      and last_message_at > ${row.delegated_at}
    order by last_message_at asc
    limit 1
  `;
  if (!thread) return null;

  return {
    channel: 'email',
    author: row.person_email,
    excerpt: [thread.subject, thread.snippet].filter(Boolean).join(' — ').slice(0, 500),
    at: thread.last_message_at,
    url: `https://mail.google.com/mail/u/0/#all/${thread.thread_id}`,
  };
}

async function main() {
  const open = await sql`
    select d.id, d.delegated_at, d.slack_message_url, d.slack_channel_id, d.slack_thread_ts,
           d.target_kind, d.status, p.email as person_email, p.name as person_name
    from delegations d
    join people p on p.id = d.delegated_to
    where d.archived_at is null and d.reply_at is null and d.status <> 'done'
  `;

  console.log(`${open.length} hand-overs with nothing back yet`);
  if (!SLACK) console.log('no Slack token — only the mailbox is being checked');
  if (!GMAIL_READY) console.log('Gmail is not configured — only Slack is being checked');

  let found = 0;
  for (const row of open) {
    /*
     * Both channels, whichever it went out on. Somebody handed something over
     * in Slack often answers by mail, and a tracker that only watches the door
     * it knocked on is a tracker that says nobody replied.
     */
    const reply = (await slackReply(row).catch(() => null)) ?? (await mailReply(row).catch(() => null));
    if (!reply) continue;

    await sql`
      update delegations set
        reply_channel = ${reply.channel},
        reply_at = ${reply.at},
        reply_author = ${reply.author},
        reply_excerpt = ${reply.excerpt},
        reply_url = ${reply.url},
        last_movement_at = ${reply.at},
        replies_checked_at = now(),
        status = case when status = 'sent' then 'acknowledged' else status end
      where id = ${row.id}
    `;
    found += 1;
    console.log(`  ${row.person_name} answered by ${reply.channel}`);
  }

  await sql`
    update delegations set replies_checked_at = now()
    where archived_at is null and reply_at is null and status <> 'done'
  `;

  /*
   * Three days with no movement is stale, and he gets one alert per hand-over
   * — not one every time this runs. The group key is what makes it one.
   */
  const stale = await sql`
    update delegations set status = 'stale'
    where archived_at is null and reply_at is null
      and status in ('sent', 'acknowledged', 'in_progress')
      and last_movement_at < now() - ${`${STALE_DAYS} days`}::interval
    returning id, delegated_to, title, note
  `;

  for (const d of stale) {
    await sql`
      insert into alerts (
        type, severity, entity_type, entity_id, group_key, title, body,
        what_happened, occurred_at, owner_person_id, recommended_action, created_by
      ) values (
        'TASK_OVERDUE', 'warning', 'delegation', ${d.id}, ${`delegation-stale:${d.id}`},
        ${`Nothing back on: ${d.title}`}, ${d.note ?? ''},
        ${`No movement for ${STALE_DAYS} days.`}, now(), ${d.delegated_to},
        'Chase it, or take it back.', 'job:delegation-watch'
      )
      on conflict do nothing
    `;
  }

  console.log(`${found} answered, ${stale.length} newly stale`);
  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e?.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
