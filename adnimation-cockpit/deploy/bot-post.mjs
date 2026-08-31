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
      ? { ok: true, as: bot.identity.username, posture: bot.posture }
      : { ok: false, reason: body?.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
