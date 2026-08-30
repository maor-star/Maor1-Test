#!/usr/bin/env node
/**
 * Says what the Slack credential is and what it can reach.
 *
 *   node slack-check.mjs
 *
 * Slack has several credential shapes that all look alike, and only some can
 * post a message or read a thread:
 *
 *   xoxb-        a bot token. What the cockpit wants.
 *   xoxp-        a user token, acting as a person.
 *   xoxe.xoxp-   a REFRESH token for a rotating user token. Not usable as-is;
 *                it has to be exchanged, and the exchange needs the app's
 *                client id and secret.
 *   xoxe-        a refresh token for an app configuration token, which manages
 *                app manifests and cannot read messages at all.
 *
 * So this reports the shape, then actually tries each path rather than
 * guessing, and never prints the credential.
 */
const TOKEN = process.env.SLACK_BOT_TOKEN ?? process.env.SLACK_REFRESH_TOKEN;
const CLIENT_ID = process.env.SLACK_CLIENT_ID;
const CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;

if (!TOKEN) {
  console.error('Set SLACK_BOT_TOKEN or SLACK_REFRESH_TOKEN.');
  process.exit(1);
}

const shape = TOKEN.startsWith('xoxb-')
  ? 'bot token'
  : TOKEN.startsWith('xoxe.xoxp-')
    ? 'refresh token for a rotating user token'
    : TOKEN.startsWith('xoxe-')
      ? 'refresh token for an app configuration token'
      : TOKEN.startsWith('xoxp-')
        ? 'user token'
        : 'unrecognised';

console.log(`shape: ${shape} (${TOKEN.slice(0, 10)}…, ${TOKEN.length} chars)`);

async function post(method, params) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return res.json();
}

async function authTest(token, label) {
  const res = await fetch('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const b = await res.json();
  console.log(
    b.ok
      ? `${label}: ok — team ${b.team}, ${b.bot_id ? `bot ${b.bot_id}` : `user ${b.user}`}`
      : `${label}: ${b.error}`,
  );
  // Slack returns the granted scopes in a header, which is the only way to see
  // them without the app's own credentials.
  const scopes = res.headers.get('x-oauth-scopes');
  if (scopes) console.log(`  scopes: ${scopes}`);
  return b.ok;
}

/**
 * Exactly what the two integrations do, and nothing else.
 *
 * Delegation posts with chat.postMessage to a person's Slack id, which opens a
 * DM; the reply radar then reads that thread with conversations.replies, having
 * recovered the channel and timestamp from the permalink it stored. It never
 * lists channels — so conversations.list failing on a missing channels:read
 * scope says nothing about whether the radar works, and testing it would be
 * testing the wrong thing.
 *
 * Pass a user id to prove the whole round trip: open the DM, post, read the
 * thread back, then delete the message so nothing is left behind.
 */
async function capability(token, userId) {
  const call = async (method, params = {}, method_ = 'GET') => {
    const url = new URL(`https://slack.com/api/${method}`);
    const init = { headers: { Authorization: `Bearer ${token}` } };
    if (method_ === 'POST') {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(params);
    } else {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    }
    const r = await fetch(url, init);
    return r.json();
  };

  if (!userId) {
    console.log('  no user id given — pass SLACK_CEO_USER_ID to test the round trip');
    return;
  }

  const open = await call('conversations.open', { users: userId }, 'POST');
  console.log(`  conversations.open: ${open.ok ? 'ok' : open.error}`);
  if (!open.ok) return;

  const channel = open.channel.id;
  const posted = await call(
    'chat.postMessage',
    { channel, text: 'Cockpit connection check — this message deletes itself.' },
    'POST',
  );
  console.log(`  chat.postMessage: ${posted.ok ? 'ok — delegation can reach Slack' : posted.error}`);
  if (!posted.ok) return;

  const replies = await call('conversations.replies', { channel, ts: posted.ts, limit: 5 });
  console.log(
    `  conversations.replies: ${replies.ok ? 'ok — the reply radar can read threads' : replies.error}`,
  );

  const hist = await call('conversations.history', { channel, limit: 1 });
  console.log(`  conversations.history: ${hist.ok ? 'ok' : hist.error}`);

  const gone = await call('chat.delete', { channel, ts: posted.ts }, 'POST');
  console.log(`  cleaned up the test message: ${gone.ok ? 'yes' : gone.error}`);
}

if (await authTest(TOKEN, 'used directly')) await capability(TOKEN, process.env.SLACK_CEO_USER_ID);

if (shape.startsWith('refresh token')) {
  // The configuration-token path needs nothing else, so try it first.
  const rotated = await post('tooling.tokens.rotate', { refresh_token: TOKEN });
  console.log(`tooling.tokens.rotate: ${rotated.ok ? 'ok' : rotated.error}`);
  if (rotated.ok && rotated.token) await authTest(rotated.token, 'after rotation');

  // The user-token path needs the app's own credentials.
  if (CLIENT_ID && CLIENT_SECRET) {
    const ex = await post('oauth.v2.exchange', {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: TOKEN,
    });
    console.log(`oauth.v2.exchange: ${ex.ok ? 'ok' : ex.error}`);
    if (ex.ok) {
      const token = ex.access_token ?? ex.authed_user?.access_token;
      if (token) await authTest(token, 'after exchange');
    }
  } else {
    const ex = await post('oauth.v2.exchange', { grant_type: 'refresh_token', refresh_token: TOKEN });
    console.log(
      `oauth.v2.exchange without client credentials: ${ex.ok ? 'ok' : ex.error}` +
        ' — SLACK_CLIENT_ID and SLACK_CLIENT_SECRET are needed for this path',
    );
  }
}
