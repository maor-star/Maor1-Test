#!/usr/bin/env node
/**
 * Posting to Slack as one of the per-subject bots, from a job.
 *
 * The jobs run as plain ESM outside the compiled app, so they cannot import the
 * TypeScript notifier. They share its routing table instead — slack-bots.mjs is
 * generated from lib/agents/slack-bots.ts — so a job and the app always agree
 * about which bot speaks for what, and with whose token.
 *
 * Never throws: a notification that fails is not a reason for the work it was
 * reporting to fail.
 */
import { postingIdentity, resolveBotByKey } from './slack-bots.mjs';

export async function postAsBot(botKey, text, env = process.env) {
  const target = env.SLACK_CEO_USER_ID;
  if (!target) return { ok: false, reason: 'no Slack destination configured' };
  if (!text) return { ok: false, reason: 'nothing to say' };

  const bot = resolveBotByKey(botKey, env);
  if (!bot.token) return { ok: false, reason: 'no Slack token configured' };
  const as = postingIdentity(bot);

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bot.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: target,
        text,
        unfurl_links: false,
        ...(as ? { username: as.username, icon_emoji: as.icon } : {}),
      }),
    });
    const body = await res.json().catch(() => null);
    return body?.ok
      ? {
          ok: true,
          as: bot.identity.username,
          posture: bot.posture,
          // Where the message landed, so a job that asked him something can
          // come back next run and read what he answered under it.
          channel: body.channel ?? null,
          ts: body.ts ?? null,
        }
      : { ok: false, reason: body?.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * What he replied under a message one of the bots posted.
 *
 * Only ever the thread the job itself started, by channel and timestamp — no
 * searching, no reading anything else. Needs `im:history` on the token that
 * posted; without it Slack says `missing_scope`, which is returned as-is
 * rather than swallowed, because a job that silently cannot hear his answer
 * would wait for it forever.
 */
export async function readReplies(botKey, channel, ts, env = process.env) {
  if (!channel || !ts) return { ok: false, reason: 'nothing to read' };
  const bot = resolveBotByKey(botKey, env);
  if (!bot.token) return { ok: false, reason: 'no Slack token configured' };

  try {
    const url =
      `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channel)}` +
      `&ts=${encodeURIComponent(ts)}&limit=30`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bot.token}` } });
    const body = await res.json().catch(() => null);
    if (!body?.ok) return { ok: false, reason: body?.error ?? `http_${res.status}` };
    return {
      ok: true,
      // His replies only: anything the bot itself wrote is not an answer.
      messages: (body.messages ?? [])
        .filter((m) => m.ts !== ts && !m.bot_id && !m.subtype)
        .map((m) => ({ ts: m.ts, text: String(m.text ?? '') })),
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
