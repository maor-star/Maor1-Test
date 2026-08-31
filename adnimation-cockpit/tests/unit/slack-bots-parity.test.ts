import { describe, expect, it } from 'vitest';
import { BOTS, botFor, postingIdentity, resolveBot, resolveBotByKey } from '@/lib/agents/slack-bots';
import { SEED_AGENTS } from '@/lib/agents/definitions';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/slack-bots.mjs';

/**
 * The app and the jobs must agree about who is speaking.
 *
 * They post to the same person from the same workspace, so a disagreement
 * shows up as a message arriving under the wrong name — which is exactly the
 * thing separate bots exist to prevent.
 */
const ENVS: Record<string, string | undefined>[] = [
  {},
  { SLACK_BOT_TOKEN: 'shared' },
  { SLACK_BOT_TOKEN_MAIL: 'mail' },
  { SLACK_BOT_TOKEN_CONTRACTS: 'contracts', SLACK_BOT_TOKEN: 'shared' },
  { SLACK_BOT_TOKEN_SALES: 'sales' },
  { SLACK_BOT_TOKEN_MAIL: 'm', SLACK_BOT_TOKEN_CONTRACTS: 'c', SLACK_BOT_TOKEN_SALES: 's' },
  { SLACK_BOT_TOKEN_MONEY: 'own-money', SLACK_BOT_TOKEN_CONTRACTS: 'c' },
];

describe('slack bots — the generated copy matches the source', () => {
  it('routes every agent the same way in both, under every token combination', () => {
    for (const agent of SEED_AGENTS) {
      expect(js.botFor(agent.name).key).toBe(botFor(agent.name).key);
      for (const env of ENVS) {
        const ts = resolveBot(agent.name, env);
        const mjs = js.resolveBot(agent.name, env);
        expect(mjs.token, `${agent.name}`).toBe(ts.token);
        expect(mjs.posture, `${agent.name}`).toBe(ts.posture);
        expect(mjs.identity.username).toBe(ts.identity.username);
        expect(mjs.via?.username ?? null).toBe(ts.via?.username ?? null);
        expect(js.postingIdentity(mjs)).toEqual(postingIdentity(ts));
      }
    }
  });

  it('resolves by bot key the same way in both', () => {
    for (const bot of BOTS) {
      for (const env of ENVS) {
        expect(js.resolveBotByKey(bot.key, env).posture).toBe(resolveBotByKey(bot.key, env).posture);
      }
    }
  });

  it('carries the same table of names and icons', () => {
    expect(js.BOTS.map((b: { username: string; icon: string; key: string }) => [b.key, b.username, b.icon]))
      .toEqual(BOTS.map((b) => [b.key, b.username, b.icon]));
  });
});
