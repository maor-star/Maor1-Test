#!/usr/bin/env node
/**
 * Everybody in the Slack workspace, into the cockpit's roster.
 *
 *   DATABASE_URL=… SLACK_BOT_TOKEN=… node slack-roster.mjs [--dry]
 *
 * The people table shipped with five rows, seeded by hand. He asked for all of
 * them — "there are more people, take everyone from Slack" — because a
 * hand-over screen that offers five names out of thirty is a screen he works
 * around rather than with.
 *
 * What it does NOT do: deactivate anybody, or overwrite a name he has edited.
 * The roster is the cockpit's own and Slack is only the source of who exists;
 * a colleague who leaves Slack still has delegations hanging off them, and
 * quietly removing the row would orphan every one of those.
 *
 * Bots, deleted accounts and Slackbot are skipped — they cannot answer.
 */
import postgres from 'postgres';
import { loadSecrets } from './job-secrets.mjs';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const DRY = process.argv.includes('--dry');
const sql = postgres(DB, { max: 2, onnotice: () => {} });

await loadSecrets(sql, ['SLACK_BOT_TOKEN', 'SLACK_USER_TOKEN']);
const TOKEN = process.env.SLACK_BOT_TOKEN ?? process.env.SLACK_USER_TOKEN;

if (!TOKEN) {
  console.error('No Slack token, in the environment or on the Keys screen.');
  await sql.end().catch(() => {});
  process.exit(78);
}

/** One Slack call, paged. */
async function slack(method, params = {}) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: '200', ...params, ...(cursor ? { cursor } : {}) });
    const res = await fetch(`https://slack.com/api/${method}?${query}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`slack ${method} failed: ${body.error}`);
    out.push(...(body.members ?? body.channels ?? []));
    cursor = body.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  return out;
}

/**
 * A real colleague.
 *
 * Bots cannot be handed work and deleted accounts cannot answer, so neither
 * belongs on a list of people to give something to.
 */
const isColleague = (u) =>
  !u.deleted && !u.is_bot && u.id !== 'USLACKBOT' && !u.is_restricted && !u.is_ultra_restricted;

/**
 * The address to file them under.
 *
 * Reading a member's email needs the users:read.email scope. Without it every
 * member comes back with the field blank, and a placeholder keeps the column
 * usable as a key while being obviously not a real address, so nothing tries
 * to send to it by accident.
 */
const addressOf = (u) => u.profile?.email ?? `${u.id.toLowerCase()}@slack.local`;

/** One of ours, standing in for an address Slack would not give us. */
const isPlaceholder = (email) => String(email ?? '').endsWith('@slack.local');

const nameOf = (u) =>
  u.profile?.real_name?.trim() || u.real_name?.trim() || u.profile?.display_name?.trim() || u.name;

async function main() {
  const members = (await slack('users.list')).filter(isColleague);
  console.log(`slack has ${members.length} people`);

  let added = 0;
  let linked = 0;
  let addressed = 0;
  const duplicates = [];

  for (const u of members) {
    const email = addressOf(u).toLowerCase();
    const name = nameOf(u);
    const role = u.profile?.title?.trim() || null;

    if (DRY) {
      console.log(`would keep ${name} <${email}> ${u.id}`);
      continue;
    }

    /*
     * Matched on email first, then on the Slack id — somebody seeded by hand
     * has the address and no id, and this is the run that joins them up.
     * A name he has edited is left alone; only the Slack id and the role are
     * filled in, and only when they are missing.
     */
    // `email` is selected because the placeholder check below reads it. It
    // was not, so `existing.email` was undefined, the check silently answered
    // "not a placeholder", and every address stayed as it was.
    const [existing] = await sql`
      select id, slack_id, email from people
      where lower(email) = ${email} or (slack_id is not null and slack_id = ${u.id})
      limit 1
    `;

    if (existing) {
      if (!existing.slack_id) {
        await sql`update people set slack_id = ${u.id} where id = ${existing.id}`;
        linked += 1;
      }

      /*
       * Their real address, once Slack will tell us.
       *
       * Sixteen of twenty-one people were filed under a placeholder, because
       * this only ever set the address when it INSERTED somebody — so the day
       * users:read.email was granted, nothing changed. Delegating by email to
       * any of them would have gone to an address that does not exist.
       *
       * Only ever a placeholder being replaced by a real address. An address
       * he edited by hand is his and is left alone.
       */
      if (isPlaceholder(existing.email) && !isPlaceholder(email)) {
        const [clash] = await sql`
          select id from people where lower(email) = ${email} and id <> ${existing.id} limit 1
        `;
        if (clash) {
          // Two rows for one person. Merging them is his call — one of them
          // may be carrying hand-overs — so this says so and changes nothing.
          duplicates.push(`${name} <${email}>`);
        } else {
          await sql`update people set email = ${email} where id = ${existing.id}`;
          addressed += 1;
        }
      }
      continue;
    }

    await sql`
      insert into people (name, email, slack_id, role, from_slack)
      values (${name}, ${email}, ${u.id}, ${role}, true)
      on conflict (email) do nothing
    `;
    added += 1;
  }

  /*
   * The channels, listed rather than stored.
   *
   * He asked for channels as a hand-over target too. They are read live when
   * the picker opens — a channel list that is a day old offers him a channel
   * that was archived this morning, and the API answers in well under a
   * second.
   */
  /*
   * Public channels need channels:read; private ones need groups:read, which
   * is a separate scope. Asked for separately so a missing groups:read costs
   * the private channels rather than the whole list — it used to ask for both
   * in one call, and one missing scope meant no channels at all.
   */
  const channels = [];
  for (const types of ['public_channel', 'private_channel']) {
    const got = await slack('conversations.list', { types, exclude_archived: 'true' }).catch((e) => {
      console.log(`no ${types.replace('_', ' ')}s: ${e.message}`);
      return [];
    });
    channels.push(...got);
  }

  const [count] = await sql`select count(*) as n from people`;
  const [placeheld] = await sql`
    select count(*) as n from people where email like '%@slack.local'
  `;
  console.log(
    `${added} added, ${linked} linked to a Slack id, ${addressed} given their real address, ` +
      `${count.n} people on the roster. ${channels.length} channels the cockpit can post to.`,
  );
  if (Number(placeheld.n) > 0) {
    console.log(
      `${placeheld.n} still filed under a placeholder address — Slack gives no email for them, ` +
        'so an email hand-over to those will not arrive.',
    );
  }
  if (duplicates.length > 0) {
    console.log(`Two rows for the same person, left alone for you to merge: ${duplicates.join(', ')}`);
  }

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e?.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
