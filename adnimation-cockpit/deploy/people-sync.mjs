#!/usr/bin/env node
/**
 * Fills in the team's real Slack ids from the workspace.
 *
 *   DATABASE_URL=… SLACK_BOT_TOKEN=… node people-sync.mjs
 *
 * The people table shipped with placeholders — U_CEO, U_MOR, U_AMIR — which
 * look like Slack ids and are not. Every delegation posted to one of those
 * would have failed at the Slack call, so nothing was ever delivered.
 *
 * Matching is by email where Slack will give one, and by name where it will
 * not: reading a workspace member's email needs the users:read.email scope,
 * and a bot granted only users:read sees every member with the address field
 * blank. Falling back to the name keeps the sync working on the narrower
 * scope, which is the one worth granting.
 *
 * A person Slack does not know keeps whatever id they had and is reported, so
 * a silent non-match cannot be mistaken for success.
 *
 * It only ever writes slack_id, and never creates or deactivates a person: the
 * team roster is the cockpit's own, not Slack's.
 */
import postgres from 'postgres';

const TOKEN = process.env.SLACK_BOT_TOKEN;
const DB = process.env.DATABASE_URL;

if (!TOKEN || !DB) {
  console.error('SLACK_BOT_TOKEN and DATABASE_URL are both required.');
  process.exit(1);
}

const sql = postgres(DB, { max: 2 });

/** Names differ in spacing and case between the two systems; this is the key. */
const nameKey = (s) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');

async function slackUsers() {
  const byEmail = new Map();
  const byName = new Map();
  let cursor = '';
  let members = 0;

  do {
    const url = new URL('https://slack.com/api/users.list');
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await res.json();
    if (!body.ok) throw new Error(`slack users.list failed: ${body.error}`);

    for (const m of body.members ?? []) {
      if (m.deleted || m.is_bot || m.id === 'USLACKBOT') continue;
      members += 1;
      const entry = { id: m.id, name: m.profile?.real_name ?? m.name };
      const email = m.profile?.email?.toLowerCase();
      if (email) byEmail.set(email, entry);
      for (const n of [m.profile?.real_name, m.profile?.display_name, m.name]) {
        const key = nameKey(n);
        // First writer wins: two people with the same name cannot be told
        // apart, and guessing between them would send work to the wrong one.
        if (key && !byName.has(key)) byName.set(key, entry);
      }
    }
    cursor = body.response_metadata?.next_cursor ?? '';
  } while (cursor);

  return { byEmail, byName, members };
}

async function main() {
  const slack = await slackUsers();
  console.log(
    `slack workspace: ${slack.members} people, ${slack.byEmail.size} with a readable email`,
  );
  if (slack.byEmail.size === 0 && slack.members > 0) {
    console.log(
      '  Slack is not returning emails — the bot lacks users:read.email. ' +
        'Matching on names instead.',
    );
  }

  const rows = await sql`select id, name, email, slack_id from people where active order by name`;
  let fixed = 0;
  const unmatched = [];

  for (const p of rows) {
    const match =
      slack.byEmail.get((p.email ?? '').toLowerCase()) ?? slack.byName.get(nameKey(p.name));
    if (!match) {
      unmatched.push(p);
      continue;
    }
    if (p.slack_id === match.id) {
      console.log(`  ${p.name}: already correct`);
      continue;
    }
    await sql`update people set slack_id = ${match.id} where id = ${p.id}`;
    console.log(`  ${p.name}: ${p.slack_id ?? 'none'} -> ${match.id}`);
    fixed += 1;
  }

  // Not finding somebody is only a problem if they have no id already. Saying
  // "cannot deliver" about a person whose id is correct — because their name is
  // spelt differently in the two systems — would send him chasing nothing.
  let unreachable = 0;
  for (const p of unmatched) {
    if (p.slack_id) {
      console.log(
        `  ${p.name}: no Slack match on name or email, keeping the id already on record ` +
          '(their Slack profile name probably differs — harmless, but worth aligning)',
      );
      continue;
    }
    unreachable += 1;
    console.log(`  ${p.name} (${p.email}): NOT FOUND and no id on record — cannot be delivered to`);
  }

  console.log(
    `${fixed} corrected, ${unmatched.length - unreachable} unconfirmed but usable, ` +
      `${unreachable} unreachable, ${rows.length} people in total`,
  );
  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
