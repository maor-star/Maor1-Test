import { describe, expect, it } from 'vitest';
import {
  AGENT_BOT, BOTS, botFor, botStatuses, postingIdentity, resolveBot,
} from '@/lib/agents/slack-bots';
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
    expect(botFor('inbox-triage').key).toBe('mail');
  });

  it('uses a bot’s own token when it has one', () => {
    const resolved = resolveBot('invoice-forwarder', {
      SLACK_BOT_TOKEN: 'shared',
      SLACK_BOT_TOKEN_MONEY: 'money-token',
    });
    expect(resolved.token).toBe('money-token');
    expect(resolved.ownToken).toBe(true);
    expect(resolved.posture).toBe('own');
  });

  it('borrows its carrier’s token before the shared one, and says whose it was', () => {
    // Ledger has no app of its own; Paperwork carries it.
    const resolved = resolveBot('invoice-forwarder', {
      SLACK_BOT_TOKEN: 'shared',
      SLACK_BOT_TOKEN_CONTRACTS: 'paperwork-token',
    });
    expect(resolved.token).toBe('paperwork-token');
    expect(resolved.posture).toBe('carried');
    expect(resolved.via?.username).toBe('Paperwork');
    // It still arrives as Ledger, which is the whole point of borrowing.
    expect(postingIdentity(resolved)).toEqual({ username: 'Ledger', icon: ':bar_chart:' });
  });

  it('does not carry the noisy mail stream on any other bot', () => {
    // Muting Mailroom must not also mute the tasks or the money.
    for (const bot of BOTS) expect(bot.carrier).not.toBe('mail');
  });

  it('falls back to the shared token, and does not pretend to be the bot', () => {
    const resolved = resolveBot('invoice-forwarder', {
      SLACK_BOT_TOKEN: 'shared',
    });
    expect(resolved.token).toBe('shared');
    expect(resolved.ownToken).toBe(false);
    expect(resolved.posture).toBe('shared');
    // Asking the shared bot to rename itself either fails or is ignored, and a
    // notification that fails to send is worse than one under the wrong name.
    expect(postingIdentity(resolved)).toBeNull();
  });

  it('reports nothing rather than guessing when no token exists at all', () => {
    expect(resolveBot('invoice-forwarder', {}).token).toBeNull();
    expect(resolveBot('invoice-forwarder', {}).posture).toBe('none');
  });

  it('reports which bots have their own identity and who speaks for the rest', () => {
    const statuses = botStatuses({ SLACK_BOT_TOKEN_MAIL: 'x', SLACK_BOT_TOKEN_CONTRACTS: 'y' });
    expect(statuses.find((s) => s.key === 'mail')?.hasOwnToken).toBe(true);
    expect(statuses.find((s) => s.key === 'money')?.hasOwnToken).toBe(false);
    expect(statuses.find((s) => s.key === 'money')?.postsAs).toBe('Paperwork');
    expect(statuses.find((s) => s.key === 'work')?.postsAs).toBe(null);
  });

  it('names every carrier as a bot that exists', () => {
    const keys = new Set(BOTS.map((b) => b.key));
    for (const bot of BOTS) if (bot.carrier) expect(keys).toContain(bot.carrier);
  });

  it('gives every bot a distinct name and env var', () => {
    expect(new Set(BOTS.map((b) => b.username)).size).toBe(BOTS.length);
    expect(new Set(BOTS.map((b) => b.tokenEnv)).size).toBe(BOTS.length);
  });
});
