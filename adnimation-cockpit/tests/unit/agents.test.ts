import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPES, AUTONOMY_LABEL, IRREVERSIBLE_ACTIONS, PROMOTION_MIN_RUNS, agentInputSchema,
  isIrreversible, validateAgentConfig,
} from '@/lib/agents/types';

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
