import { desc, eq, sql } from 'drizzle-orm';
import { agentRuns, agents, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { claudeStatus } from '@/lib/integrations/claude';
import { SEED_AGENTS } from './definitions';
import { globalKill, runAgent, setGlobalKill, type Runtime } from './runtime';
import {
  isIrreversible, validateAgentConfig, type AgentInput, type AgentRecord,
} from './types';

export { globalKill, setGlobalKill };

type Row = typeof agents.$inferSelect;

function toRecord(r: Row): AgentRecord {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    triggerType: r.triggerType,
    triggerConfig: (r.triggerConfig ?? {}) as Record<string, unknown>,
    conditions: (r.conditions ?? []) as AgentRecord['conditions'],
    actions: (r.actions ?? []) as AgentRecord['actions'],
    autonomyLevel: r.autonomyLevel,
    hasIrreversibleAction: r.hasIrreversibleAction,
    maxRunsPerHour: r.maxRunsPerHour,
    enabled: r.enabled,
    runCount: r.runCount,
    createdAt: r.createdAt,
  };
}

export interface AgentListItem extends AgentRecord {
  rationale: string | null;
  lastRun: { startedAt: Date; outcome: string | null; haltReason: string | null } | null;
  runsToday: number;
}

export async function listAgents(): Promise<AgentListItem[]> {
  const rows = await db.select().from(agents).orderBy(agents.name);
  const rationales = new Map(SEED_AGENTS.map((a) => [a.name, a.rationale]));

  return Promise.all(
    rows.map(async (r) => {
      const [last] = await db
        .select({
          startedAt: agentRuns.startedAt,
          outcome: agentRuns.outcome,
          haltReason: agentRuns.haltReason,
        })
        .from(agentRuns)
        .where(eq(agentRuns.agentId, r.id))
        .orderBy(desc(agentRuns.startedAt))
        .limit(1);

      const [today] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(agentRuns)
        .where(sql`${agentRuns.agentId} = ${r.id} and ${agentRuns.startedAt} > now() - interval '1 day'`);

      return {
        ...toRecord(r),
        rationale: rationales.get(r.name) ?? null,
        lastRun: last ?? null,
        runsToday: today?.n ?? 0,
      };
    }),
  );
}

export interface AgentsOverview {
  total: number;
  enabled: number;
  killed: boolean;
  claudeConnected: boolean;
  claudeReason?: string;
  /** Agents holding an action that cannot be taken back. */
  irreversible: number;
}

export async function agentsOverview(): Promise<AgentsOverview> {
  const rows = await db.select().from(agents);
  const claude = claudeStatus();

  return {
    total: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    killed: await globalKill(),
    claudeConnected: claude.configured,
    ...(claude.reason ? { claudeReason: claude.reason } : {}),
    irreversible: rows.filter((r) =>
      ((r.actions ?? []) as { type: string }[]).some((a) => isIrreversible(a.type)),
    ).length,
  };
}

/**
 * Put the built-in definitions in the database, without touching what he has
 * changed.
 *
 * Re-running this must never re-enable an agent he switched off or reset a
 * level he set, so an existing agent is left exactly as it is. It only ever
 * adds what is missing.
 */
export async function seedAgents(actor: string): Promise<{ added: string[] }> {
  const existing = new Set((await db.select({ name: agents.name }).from(agents)).map((r) => r.name));
  const added: string[] = [];

  for (const definition of SEED_AGENTS) {
    if (existing.has(definition.name)) continue;

    const hasIrreversible = definition.actions.some((a) => isIrreversible(a.type));
    await db.insert(agents).values({
      name: definition.name,
      description: definition.description ?? null,
      triggerType: definition.triggerType,
      triggerConfig: definition.triggerConfig as never,
      conditions: definition.conditions as never,
      actions: definition.actions as never,
      // Whatever a definition says, a new agent starts at 1 (§6.2).
      autonomyLevel: 1,
      hasIrreversibleAction: hasIrreversible,
      maxRunsPerHour: definition.maxRunsPerHour,
      enabled: definition.enabled,
    });
    added.push(definition.name);
  }

  if (added.length > 0) {
    await writeAudit({
      actor,
      action: 'agents.seed',
      entityType: 'agents',
      after: { added },
    });
  }
  return { added };
}

export async function setAgentEnabled(
  id: string,
  enabled: boolean,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const [before] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such agent' };

  await db.update(agents).set({ enabled }).where(eq(agents.id, id));
  await writeAudit({
    actor,
    action: enabled ? 'agent.enable' : 'agent.disable',
    entityType: 'agent',
    entityId: id,
    before: { enabled: before.enabled },
    after: { enabled },
  });
  return { ok: true };
}

/**
 * Change an agent's autonomy.
 *
 * Validated here rather than in the form, so the rules hold however this is
 * called: level 4 stays closed to anything irreversible, and a promotion has
 * to be earned.
 */
export async function setAutonomy(
  id: string,
  level: number,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const [before] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such agent' };

  const check = validateAgentConfig(
    {
      actions: ((before.actions ?? []) as { type: string }[]).map((a) => ({
        type: a.type as never,
        config: {},
      })),
      autonomyLevel: level,
    },
    { autonomyLevel: before.autonomyLevel, runCount: before.runCount },
  );
  if (!check.ok) return { ok: false, error: check.error };

  await db
    .update(agents)
    .set({ autonomyLevel: level, lastLevelChangeAt: new Date() })
    .where(eq(agents.id, id));

  await writeAudit({
    actor,
    action: 'agent.autonomy',
    entityType: 'agent',
    entityId: id,
    before: { autonomyLevel: before.autonomyLevel },
    after: { autonomyLevel: level },
  });
  return { ok: true };
}

/**
 * The evaluators and performers the runtime knows.
 *
 * Deliberately small for now: everything here either reads or writes inside
 * the cockpit. Nothing sends, signs or commits, so no agent can currently do
 * something to the outside world — whatever level it is set to.
 */
export function buildRuntime(): Runtime {
  return {
    conditions: {
      claude_configured: async () => {
        const status = claudeStatus();
        return {
          passed: status.configured,
          detail: status.configured ? 'Claude is connected.' : (status.reason ?? 'No key.'),
        };
      },
      contract_has_drive_file: async (_config, context) => {
        const has = Boolean(context.driveFileId);
        return { passed: has, detail: has ? 'The document is in Drive.' : 'Nothing to read yet.' };
      },
      contract_not_signed: async (_config, context) => {
        const signed = context.status === 'signed';
        return { passed: !signed, detail: signed ? 'Already signed.' : 'Still open.' };
      },
    },
    actions: {},
  };
}

export async function runById(
  id: string,
  options: { dryRun?: boolean; triggeredBy?: string } = {},
) {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!row) return { outcome: 'failed' as const, conditions: [], actions: [], error: 'No such agent' };
  return runAgent(toRecord(row), buildRuntime(), options);
}

export { recentRuns } from './runtime';
export { AUTONOMY_LABEL, IRREVERSIBLE_ACTIONS, PROMOTION_MIN_RUNS, isIrreversible } from './types';
export type { AgentInput, AgentRecord };
