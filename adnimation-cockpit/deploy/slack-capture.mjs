#!/usr/bin/env node
/**
 * Capture opportunities out of Slack, with nothing for him to configure.
 *
 *   DATABASE_URL=… SLACK_BOT_TOKEN=… SLACK_CEO_USER_ID=… node slack-capture.mjs
 *
 * The interaction is: send it to the cockpit bot in Slack. Forward a message
 * to it, or type a line into its DM. Anything he sends there becomes an
 * opportunity.
 *
 * This is the path that works today. The emoji-reaction route needs Event
 * Subscriptions and a signing secret set up on the Slack app; a bot token also
 * cannot read his personal DMs with other people, so nothing can watch those.
 * What a bot token CAN always read is its own DM — so that is the inbox.
 *
 * Scopes used, all already granted: im:read to find the DM, im:history to read
 * it. Nothing is posted back except a one-line confirmation, so he can see it
 * landed without opening the cockpit.
 */
import postgres from 'postgres';

const DB = process.env.DATABASE_URL;
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CEO = process.env.SLACK_CEO_USER_ID;
const LOOKBACK_HOURS = Number(process.env.SLACK_CAPTURE_HOURS ?? 48);
const CONFIRM = process.env.SLACK_CAPTURE_CONFIRM !== '0';

if (!DB) { console.error('DATABASE_URL is required.'); process.exit(1); }
if (!TOKEN || !CEO) {
  console.error('SLACK_BOT_TOKEN and SLACK_CEO_USER_ID are required.');
  process.exit(78); // EX_CONFIG — a known unconfigured state, not a fault.
}

const sql = postgres(DB, { max: 2 });

async function slack(method, params = {}, post = false) {
  const url = `https://slack.com/api/${method}`;
  const res = post
    ? await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(params),
      })
    : await fetch(`${url}?${new URLSearchParams(params)}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });

  const body = await res.json();
  if (!body.ok) throw new Error(`${method} failed: ${body.error}`);
  return body;
}

/**
 * What he actually sent.
 *
 * A forwarded Slack message arrives with an empty `text` and the real content
 * in an attachment, along with a link back to the original. Reading only
 * `text` would capture a row with no content, which is worse than not
 * capturing it — he would think it worked.
 */
function extract(message) {
  const parts = [];
  if (message.text) parts.push(message.text);

  let originalUrl = null;
  let originalAuthor = null;

  for (const a of message.attachments ?? []) {
    if (a.text) parts.push(a.text);
    else if (a.fallback) parts.push(a.fallback);
    if (!originalUrl && (a.from_url || a.original_url)) originalUrl = a.from_url ?? a.original_url;
    if (!originalAuthor && a.author_name) originalAuthor = a.author_name;
  }

  const text = parts.join('\n').trim();
  return { text, originalUrl, originalAuthor };
}

/** Slack's mrkdwn links and user mentions are noise in a title. */
function toTitle(text) {
  return text
    .replace(/<https?:\/\/[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function main() {
  const started = Date.now();
  const oldest = (Date.now() - LOOKBACK_HOURS * 3_600_000) / 1000;

  // Only true one-to-one DMs. The bot's group conversations are delegation
  // threads, where a message from him is a reply to somebody, not a capture.
  const { channels } = await slack('users.conversations', {
    types: 'im',
    limit: '200',
    exclude_archived: 'true',
  });

  let captured = 0;
  let seen = 0;

  for (const channel of channels ?? []) {
    if (channel.user !== CEO) continue;

    const { messages } = await slack('conversations.history', {
      channel: channel.id,
      oldest: String(oldest),
      limit: '200',
    });

    for (const message of messages ?? []) {
      // His own top-level messages only: not the bot's, and not a reply inside
      // a thread, which is a conversation rather than a new opportunity.
      if (message.user !== CEO) continue;
      if (message.bot_id) continue;
      if (message.thread_ts && message.thread_ts !== message.ts) continue;
      if (message.subtype && message.subtype !== 'bot_message') continue;

      seen += 1;
      const { text, originalUrl, originalAuthor } = extract(message);
      // A one or two character message is a test or a typo, not an opportunity.
      if (text.length < 3) continue;

      /*
       * The same message forwarded twice is one opportunity.
       *
       * source_ref dedupes redeliveries of a single Slack message, but
       * forwarding the same thing again is a different message with a
       * different ts — and lands as a second identical row. Matching on the
       * text is what actually catches that.
       */
      const [duplicate] = await sql`
        select id from opportunities
        where source = 'slack'
          and source_excerpt = ${text.slice(0, 4000)}
          and archived_at is null
        limit 1
      `;
      if (duplicate) continue;

      const inserted = await sql`
        insert into opportunities
          (title, kind, status, counterparty, source, source_ref, source_url,
           source_excerpt, source_at, detect_reasons, created_by)
        values (
          ${toTitle(text) || 'From Slack'},
          'other',
          'new',
          ${originalAuthor},
          'slack',
          ${`${channel.id}:${message.ts}`},
          ${originalUrl},
          ${text.slice(0, 4000)},
          ${new Date(Number(message.ts) * 1000)},
          ${['sent to the cockpit in Slack']},
          'slack-capture'
        )
        on conflict (source, source_ref) where source_ref is not null do nothing
        returning id
      `;

      if (inserted.length > 0) {
        captured += 1;
        if (CONFIRM) {
          // Answering in the thread keeps his DM readable, and tells him it
          // landed without making him go and look.
          await slack(
            'chat.postMessage',
            {
              channel: channel.id,
              thread_ts: message.ts,
              text: '📌 Saved as an opportunity. It is in the cockpit under OPPORTUNITIES.',
            },
            true,
          ).catch(() => {});
        }
      }
    }
  }

  const [counts] = await sql`
    select count(*) filter (where status in ('new','exploring') and archived_at is null) as open
    from opportunities
  `;

  console.log(
    `read ${seen} of your messages to the bot in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `${captured} new opportunities captured. ${counts.open} open in total.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
