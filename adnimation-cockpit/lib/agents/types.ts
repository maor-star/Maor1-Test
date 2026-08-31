import { z } from 'zod';

/**
 * What an agent is — CLAUDE.md §6.
 *
 * A trigger, conditions, actions, an autonomy level and routing. The seven
 * hard constraints live in the runtime and in the database, not in the form,
 * because a constraint enforced only where it is typed is a constraint that
 * holds until someone calls the function another way.
 */

/**
 * Actions that cannot be taken back.
 *
 * This list is the reason the whole autonomy ladder exists. An agent holding
 * any of them may never run silently, at any level, however many successful
 * runs it has behind it.
 */
export const IRREVERSIBLE_ACTIONS = [
  'sign_contract',
  'send_external_email',
  'send_external_document',
  'create_financial_commitment',
  'archive_record',
] as const;
export type IrreversibleAction = (typeof IRREVERSIBLE_ACTIONS)[number];

/** Everything an agent can do. The reversible ones are safe to automate. */
export const ACTION_TYPES = [
  'summarise_contract',
  /*
   * Sending inside the company is its own action, apart from
   * send_external_email. The risk in a send is almost entirely about who
   * receives it: a misrouted invoice inside Adnimation is an awkward minute,
   * the same mail to a counterparty is a different kind of day. The narrowness
   * is enforced in lib/agents/internal-mail.ts, not assumed here.
   */
  'send_internal_email',
  'draft_reply',
  'propose_contract_changes',
  'post_slack_internal',
  'create_task',
  'create_alert',
  'update_record',
  'create_opportunity',
  ...IRREVERSIBLE_ACTIONS,
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export function isIrreversible(action: string): action is IrreversibleAction {
  return (IRREVERSIBLE_ACTIONS as readonly string[]).includes(action);
}

/**
 * Autonomy, as the spec defines it.
 *
 * 4 is the only one that acts without him seeing it first, which is why it is
 * forbidden to anything irreversible.
 */
export const AUTONOMY_LABEL: Record<number, string> = {
  1: 'PROPOSE ONLY — nothing happens without you',
  2: 'ACT, THEN TELL YOU',
  3: 'ACT UNLESS YOU OBJECT IN TIME',
  4: 'ACT SILENTLY',
};

/** §6.2 — a new agent starts at 1 and stays there until it has a record. */
export const PROMOTION_MIN_RUNS = 20;

export const TRIGGER_TYPES = ['schedule', 'event', 'manual'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const agentActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const agentConditionSchema = z.object({
  name: z.string().min(1),
  /** A named check the runtime knows how to evaluate. */
  check: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  conditions: z.array(agentConditionSchema).default([]),
  actions: z.array(agentActionSchema).min(1, 'An agent that does nothing is not an agent'),
  autonomyLevel: z.number().int().min(1).max(4).default(1),
  maxRunsPerHour: z.number().int().min(1).max(120).default(10),
  enabled: z.boolean().default(true),
});

export type AgentInput = z.infer<typeof agentInputSchema>;

export interface AgentRecord {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: { name: string; check: string; config: Record<string, unknown> }[];
  actions: { type: string; config: Record<string, unknown> }[];
  autonomyLevel: number;
  hasIrreversibleAction: boolean;
  maxRunsPerHour: number;
  enabled: boolean;
  runCount: number;
  createdAt: Date;
}

export interface ConditionResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ActionResult {
  type: string;
  performed: boolean;
  detail: string;
}

export type RunOutcome = 'completed' | 'halted' | 'failed' | 'dry_run';

export interface RunReport {
  outcome: RunOutcome;
  conditions: ConditionResult[];
  actions: ActionResult[];
  haltReason?: string;
  error?: string;
}

/**
 * §6.1 — validated at write time as well as at run time.
 *
 * Both, deliberately. Write-time keeps an impossible agent out of the
 * database; run-time means an agent that became impossible after it was saved
 * — because the action list changed, or the row was edited another way — still
 * cannot act.
 */
export function validateAgentConfig(
  input: Pick<AgentInput, 'actions' | 'autonomyLevel'> & { runCount?: number },
  existing?: { autonomyLevel: number; runCount: number },
): { ok: true } | { ok: false; error: string } {
  const irreversible = input.actions.filter((a) => isIrreversible(a.type));

  if (irreversible.length > 0 && input.autonomyLevel === 4) {
    return {
      ok: false,
      error:
        `Level 4 is silent execution, and ${irreversible
          .map((a) => a.type)
          .join(', ')} cannot be undone. An agent holding an irreversible action ` +
        'may run at most at level 3.',
    };
  }

  // §6.2 — promotion is earned, and the rule lives here rather than in the
  // form so it cannot be skipped by saving another way.
  if (existing && input.autonomyLevel > existing.autonomyLevel) {
    if (existing.runCount < PROMOTION_MIN_RUNS) {
      return {
        ok: false,
        error:
          `This agent has ${existing.runCount} runs. It needs ${PROMOTION_MIN_RUNS} ` +
          'before it can be promoted.',
      };
    }
  }

  return { ok: true };
}
