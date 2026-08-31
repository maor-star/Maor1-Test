import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { agentRuns, agents, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import {
  isIrreversible, validateAgentConfig,
  type ActionResult, type AgentRecord, type ConditionResult, type RunReport,
} from './types';

/**
 * The agent engine — CLAUDE.md §6.
 *
 * The seven hard constraints, in the order a run meets them:
 *
 *   4. the global kill switch, checked before anything else
 *      the agent's own enabled flag
 *   3. the rate limit — more than max_runs_per_hour halts AND disables it,
 *      because an agent running away is not something to catch twice
 *   1. level 4 with an irreversible action, refused at run time as well as at
 *      write time
 *   -  conditions, evaluated independently and every one recorded, passed or
 *      not, so a halt says which check stopped it
 *   5. dry run, which does everything above and stubs every side effect
 *   6. an agent_runs row throughout, insert-only at the database level
 *   7. no action may touch another agent's configuration
 *
 * A run that halts is a successful run of the safety machinery, not a failure,
 * and is recorded as such.
 */

export const KILL_SWITCH_FLAG = 'agents_global_kill';

/** §6.4 — env or the database flag; either one stops everything. */
export async function globalKill(): Promise<boolean> {
  if (process.env.AGENTS_GLOBAL_KILL === 'true') return true;
  try {
    const [row] = await db.execute<{ value: string }>(
      sql`select value from system_flags where key = ${KILL_SWITCH_FLAG} limit 1`,
    );
    return row?.value === 'true';
  } catch {
    // A flag we cannot read is not permission to run.
    return true;
  }
}

export async function setGlobalKill(on: boolean, actor: string): Promise<void> {
  await db.execute(
    sql`insert into system_flags (key, value) values (${KILL_SWITCH_FLAG}, ${String(on)})
        on conflict (key) do update set value = excluded.value`,
  );
  await writeAudit({
    actor,
    action: on ? 'agents.kill_all' : 'agents.resume_all',
    entityType: 'agents',
    after: { killed: on },
  });
}

/** What each named condition means. Unknown checks fail closed. */
export type ConditionEvaluator = (
  config: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<{ passed: boolean; detail: string }>;

/** What each action does. A dry run never reaches these. */
export type ActionPerformer = (
  config: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<{ performed: boolean; detail: string }>;

export interface Runtime {
  conditions: Record<string, ConditionEvaluator>;
  actions: Record<string, ActionPerformer>;
}

async function runsInLastHour(agentId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, agentId),
        gte(agentRuns.startedAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  return row?.n ?? 0;
}

export interface RunOptions {
  dryRun?: boolean;
  triggeredBy?: string;
  context?: Record<string, unknown>;
}

/**
 * Run one agent.
 *
 * Every exit writes a run row. There is no path out of here that leaves no
 * trace — an agent that halted silently is indistinguishable from one that
 * never fired, and the difference matters when something has gone wrong.
 */
export async function runAgent(
  agent: AgentRecord,
  runtime: Runtime,
  options: RunOptions = {},
): Promise<RunReport> {
  const dryRun = options.dryRun ?? false;
  const triggeredBy = options.triggeredBy ?? 'manual';
  const context = options.context ?? {};

  const [run] = await db
    .insert(agentRuns)
    .values({ agentId: agent.id, triggeredBy, dryRun })
    .returning({ id: agentRuns.id });

  const finish = async (report: RunReport) => {
    if (run) {
      await db
        .update(agentRuns)
        .set({
          finishedAt: new Date(),
          conditionsEvaluated: report.conditions as never,
          actionsTaken: report.actions as never,
          // The database enum says 'done'; the report says 'completed'. Map
          // rather than rename, so the log reads the way the schema declares.
          outcome: report.outcome === 'completed' ? 'done' : report.outcome,
          haltReason: report.haltReason ?? null,
          error: report.error ?? null,
        })
        .where(eq(agentRuns.id, run.id));
    }
    return report;
  };

  const halt = (reason: string, conditions: ConditionResult[] = []) =>
    finish({ outcome: 'halted', conditions, actions: [], haltReason: reason });

  // 4 — the kill switch, before anything else, including in a dry run: if
  // everything is stopped, nothing should be pretending to run either.
  if (await globalKill()) return halt('The global kill switch is on.');
  if (!agent.enabled) return halt('This agent is switched off.');

  // 3 — the loop protection. Halting is not enough on its own: an agent that
  // hit its limit will hit it again in a minute, so it is disabled and said so.
  const recent = await runsInLastHour(agent.id);
  if (recent > agent.maxRunsPerHour) {
    await db.update(agents).set({ enabled: false }).where(eq(agents.id, agent.id));
    await writeAudit({
      actor: 'agent-runtime',
      action: 'agent.rate_limited',
      entityType: 'agent',
      entityId: agent.id,
      after: { runsInLastHour: recent, limit: agent.maxRunsPerHour, disabled: true },
    });
    return halt(
      `${recent} runs in the last hour against a limit of ${agent.maxRunsPerHour}. ` +
        'The agent has been switched off.',
    );
  }

  // 1 — again at run time. The row may have been changed since it was saved.
  const config = validateAgentConfig({
    actions: agent.actions.map((a) => ({ type: a.type as never, config: a.config })),
    autonomyLevel: agent.autonomyLevel,
  });
  if (!config.ok) return halt(config.error);

  // Conditions, each evaluated and recorded whatever the others did, so the
  // log says which one stopped it rather than only that something did.
  const conditions: ConditionResult[] = [];
  for (const condition of agent.conditions) {
    const evaluator = runtime.conditions[condition.check];
    if (!evaluator) {
      conditions.push({
        name: condition.name,
        passed: false,
        detail: `No evaluator named "${condition.check}" — failing closed.`,
      });
      continue;
    }
    try {
      const result = await evaluator(condition.config, context);
      conditions.push({ name: condition.name, passed: result.passed, detail: result.detail });
    } catch (e) {
      conditions.push({
        name: condition.name,
        passed: false,
        detail: e instanceof Error ? e.message : 'The check itself failed',
      });
    }
  }

  const failed = conditions.filter((c) => !c.passed);
  if (failed.length > 0) {
    // Never partially proceed (§6, the signing path). One failed condition
    // stops the run, whatever the others said.
    return finish({
      outcome: 'halted',
      conditions,
      actions: [],
      haltReason: `Conditions not met: ${failed.map((c) => c.name).join(', ')}`,
    });
  }

  // 5 — a dry run against real data, with every side effect stubbed, producing
  // the full list it would have taken.
  if (dryRun) {
    return finish({
      outcome: 'dry_run',
      conditions,
      actions: agent.actions.map((a) => ({
        type: a.type,
        performed: false,
        detail: `Would have run ${a.type}${isIrreversible(a.type) ? ' (irreversible)' : ''}.`,
      })),
    });
  }

  const actions: ActionResult[] = [];
  for (const action of agent.actions) {
    // 7 — nothing an agent does may reconfigure another agent.
    if (String(action.config.entityType ?? '') === 'agent') {
      return finish({
        outcome: 'halted',
        conditions,
        actions,
        haltReason: 'An agent may not modify another agent’s configuration.',
      });
    }

    const performer = runtime.actions[action.type];
    if (!performer) {
      return finish({
        outcome: 'failed',
        conditions,
        actions,
        error: `No performer for action "${action.type}".`,
      });
    }

    try {
      const result = await performer(action.config, context);
      actions.push({ type: action.type, performed: result.performed, detail: result.detail });
      if (!result.performed) {
        return finish({
          outcome: 'halted',
          conditions,
          actions,
          haltReason: `${action.type} did not complete: ${result.detail}`,
        });
      }
    } catch (e) {
      return finish({
        outcome: 'failed',
        conditions,
        actions,
        error: e instanceof Error ? e.message : `${action.type} threw`,
      });
    }
  }

  await db
    .update(agents)
    .set({ runCount: sql`${agents.runCount} + 1` })
    .where(eq(agents.id, agent.id));

  return finish({ outcome: 'completed', conditions, actions });
}

export async function recentRuns(agentId: string, limit = 20) {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agentId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);
}
