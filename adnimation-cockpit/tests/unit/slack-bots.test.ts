import { describe, expect, it } from 'vitest';
import { AGENT_BOT, BOTS, botFor, botStatuses, resolveBot } from '@/lib/agents/slack-bots';
import { SEED_AGENTS } from '@/lib/agents/definitions';

/**
 * A bot per kind of work.
 *
 * The point is that he can mute the noisy one without losing the one that
 * matters, which only holds if every agent is actually assigned — an agent
 * silently falling back to a catch-all is how one bot becomes all of them
 * again.
 */
describe('slack bots — who speaks for whom', () => {
  it('assigns every built-in agent to a bot explicitly', () => {
    for (const agent of SEED_AGENTS) {
      expect(AGENT_BOT[agent.name], `${agent.name} has no bot`).toBeTruthy();
    }
  });

  it('assigns every agent to a bot that exists', () => {
    const keys = new Set(BOTS.map((b) => b.key));
    for (const key of Object.values(AGENT_BOT)) expect(keys).toContain(key);
  });

  it('gives an unknown agent a bot rather than nothing', () => {
    expect(botFor('something-new').key).toBeTruthy();
  });

  it('groups the mail work under the mail bot', () => {
    expect(botFor('mail-answerer').key).toBe('mail');
    expect(botFor('promo-filer').key).toBe('mail');
  });

  it('uses a bot’s own token when it has one', () => {
    const resolved = resolveBot('invoice-forwarder', {
      SLACK_BOT_TOKEN: 'shared',
      SLACK_BOT_TOKEN_MONEY: 'money-token',
    });
    expect(resolved.token).toBe('money-token');
    expect(resolved.ownToken).toBe(true);
  });

  it('falls back to the shared token, and says it is not really that bot', () => {
    const resolved = resolveBot('invoice-forwarder', {
      SLACK_BOT_TOKEN: 'shared',
    });
    expect(resolved.token).toBe('shared');
    expect(resolved.ownToken).toBe(false);
  });

  it('reports nothing rather than guessing when no token exists at all', () => {
    expect(resolveBot('invoice-forwarder', {}).token).toBeNull();
  });

  it('reports which bots have their own identity', () => {
    const statuses = botStatuses({ SLACK_BOT_TOKEN_MAIL: 'x' });
    expect(statuses.find((s) => s.key === 'mail')?.hasOwnToken).toBe(true);
    expect(statuses.find((s) => s.key === 'money')?.hasOwnToken).toBe(false);
  });

  it('gives every bot a distinct name and env var', () => {
    expect(new Set(BOTS.map((b) => b.username)).size).toBe(BOTS.length);
    expect(new Set(BOTS.map((b) => b.tokenEnv)).size).toBe(BOTS.length);
  });
});
