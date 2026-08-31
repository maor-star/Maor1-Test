import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPES, AUTONOMY_LABEL, IRREVERSIBLE_ACTIONS, PROMOTION_MIN_RUNS, agentInputSchema,
  isIrreversible, validateAgentConfig,
} from '@/lib/agents/types';
import { SEED_AGENTS } from '@/lib/agents/definitions';

/**
 * The agent engine's hard constraints — CLAUDE.md §6.
 *
 * These are the rules that stop a system which acts on his behalf from doing
 * something he cannot take back. They are tested at the level they are
 * enforced, because a constraint that only holds in the form is a constraint
 * that holds until somebody calls the function another way.
 */
describe('agents — level 4 is forbidden to anything irreversible', () => {
  it.each(IRREVERSIBLE_ACTIONS)('refuses %s at level 4', (action) => {
    const result = validateAgentConfig({
      actions: [{ type: action, config: {} }],
      autonomyLevel: 4,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses level 4 when one action among several is irreversible', () => {
    const result = validateAgentConfig({
      actions: [
        { type: 'summarise_contract', config: {} },
        { type: 'create_task', config: {} },
        { type: 'sign_contract', config: {} },
      ],
      autonomyLevel: 4,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/sign_contract/);
  });

  it('allows an irreversible action at level 3, where he still sees it coming', () => {
    expect(
      validateAgentConfig({ actions: [{ type: 'sign_contract', config: {} }], autonomyLevel: 3 })
        .ok,
    ).toBe(true);
  });

  it('allows level 4 when nothing it does is irreversible', () => {
    expect(
      validateAgentConfig({
        actions: [{ type: 'summarise_contract', config: {} }, { type: 'create_alert', config: {} }],
        autonomyLevel: 4,
      }).ok,
    ).toBe(true);
  });

  it('knows which actions cannot be taken back', () => {
    expect(isIrreversible('sign_contract')).toBe(true);
    expect(isIrreversible('send_external_email')).toBe(true);
    expect(isIrreversible('summarise_contract')).toBe(false);
    // Every irreversible action must also be a real action type.
    for (const action of IRREVERSIBLE_ACTIONS) {
      expect(ACTION_TYPES).toContain(action);
    }
  });
});

describe('agents — promotion is earned, not typed', () => {
  it('refuses a promotion before the run count is met', () => {
    const result = validateAgentConfig(
      { actions: [{ type: 'create_task', config: {} }], autonomyLevel: 2 },
      { autonomyLevel: 1, runCount: PROMOTION_MIN_RUNS - 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(String(PROMOTION_MIN_RUNS));
  });

  it('allows it once the agent has a record', () => {
    expect(
      validateAgentConfig(
        { actions: [{ type: 'create_task', config: {} }], autonomyLevel: 2 },
        { autonomyLevel: 1, runCount: PROMOTION_MIN_RUNS },
      ).ok,
    ).toBe(true);
  });

  it('never blocks a demotion — turning an agent down is always allowed', () => {
    expect(
      validateAgentConfig(
        { actions: [{ type: 'create_task', config: {} }], autonomyLevel: 1 },
        { autonomyLevel: 3, runCount: 0 },
      ).ok,
    ).toBe(true);
  });

  it('still refuses level 4 for an irreversible action however many runs it has', () => {
    expect(
      validateAgentConfig(
        { actions: [{ type: 'send_external_email', config: {} }], autonomyLevel: 4 },
        { autonomyLevel: 3, runCount: 5000 },
      ).ok,
    ).toBe(false);
  });
});

describe('agents — the shape of one', () => {
  it('refuses an agent that does nothing', () => {
    const parsed = agentInputSchema.safeParse({
      name: 'Does nothing',
      triggerType: 'schedule',
      actions: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('starts a new agent at level 1', () => {
    const parsed = agentInputSchema.safeParse({
      name: 'Contract reader',
      triggerType: 'event',
      actions: [{ type: 'summarise_contract' }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.autonomyLevel).toBe(1);
  });

  it('defaults the rate limit, because an unlimited agent is a loop', () => {
    const parsed = agentInputSchema.safeParse({
      name: 'X',
      triggerType: 'schedule',
      actions: [{ type: 'create_task' }],
    });
    expect(parsed.success && parsed.data.maxRunsPerHour).toBe(10);
  });

  it('labels every autonomy level, so none is a bare number on screen', () => {
    for (const level of [1, 2, 3, 4]) expect(AUTONOMY_LABEL[level]).toBeTruthy();
  });
});

/**
 * The built-in agents, checked as a set.
 *
 * They are the ones that will actually be switched on, so the properties that
 * matter are properties of the whole list: nothing arrives switched on, nothing
 * arrives above level 1, and nothing that can send outside the company exists
 * at all yet.
 */
describe('agents — the built-in set', () => {
  it('ships every agent switched off', () => {
    for (const agent of SEED_AGENTS) {
      expect(agent.enabled, `${agent.name} arrives switched on`).toBe(false);
    }
  });

  it('ships every agent at level 1', () => {
    for (const agent of SEED_AGENTS) {
      expect(agent.autonomyLevel ?? 1, `${agent.name} is above level 1`).toBe(1);
    }
  });

  it('rate limits every one, because an unlimited agent is a loop', () => {
    for (const agent of SEED_AGENTS) {
      expect(agent.maxRunsPerHour ?? 10).toBeLessThanOrEqual(24);
    }
  });

  it('gives every one a reason it exists, in his terms not ours', () => {
    for (const agent of SEED_AGENTS) {
      expect(agent.rationale.length, `${agent.name} has no rationale`).toBeGreaterThan(40);
    }
  });

  it('contains no agent that signs, and none that mails the outside world', () => {
    // contract-countersign is gated behind legal preconditions and an
    // e-signature provider; external send has no agent that needs it yet.
    for (const agent of SEED_AGENTS) {
      for (const action of agent.actions) {
        expect(action.type).not.toBe('sign_contract');
        expect(action.type).not.toBe('send_external_email');
        expect(action.type).not.toBe('send_external_document');
      }
    }
  });

  it('passes its own validation — every definition is a legal agent', () => {
    for (const agent of SEED_AGENTS) {
      const result = validateAgentConfig({
        actions: agent.actions,
        autonomyLevel: agent.autonomyLevel ?? 1,
      });
      expect(result.ok, `${agent.name}: ${result.ok ? '' : result.error}`).toBe(true);
    }
  });

  it('has one and only one agent that sends anything, and it sends internally', () => {
    const senders = SEED_AGENTS.filter((a) =>
      a.actions.some((x) => x.type.startsWith('send_')),
    );
    expect(senders).toHaveLength(1);
    expect(senders[0]!.name).toBe('invoice-forwarder');
    expect(senders[0]!.actions.some((x) => x.type === 'send_internal_email')).toBe(true);
  });
});
