import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { agentRuns, agents, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { claudeStatus } from '@/lib/integrations/claude';
import { SEED_AGENTS } from './definitions';
import { notifyRun } from './notify';
import { RUN_INTERVALS } from './types';
import { getLearning, recentJobRuns, type JobRun, type Learning } from './learning';
import { globalKill, runAgent, setGlobalKill, type Runtime } from './runtime';
import { conditions as checkConditions, performers as checkPerformers, settingsContext } from './checks';
import { RETIRED_AGENTS, effectiveSettings, settingsFor, type SettingField, type Settings } from './settings';
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
  notifySlack: boolean;
  /** Minimum minutes between runs. Null runs whenever its timer fires. */
  runEveryMinutes: number | null;
  lastRanAt: Date | null;
  instructions: string | null;
  learning: Learning | null;
  jobRuns: JobRun[];
  instructionsUpdatedAt: Date | null;
  lastRun: { startedAt: Date; outcome: string | null; haltReason: string | null } | null;
  runsToday: number;
  /** His dials, with the defaults filled in, and what each one is. */
  settings: Settings;
  settingFields: SettingField[];
  /** The document behind it, and where it came from. */
  playbook: string | null;
  playbookName: string | null;
  playbookUpdatedAt: Date | null;
}

export async function listAgents(): Promise<AgentListItem[]> {
  // Retired agents keep their rows and their history; they just stop being listed.
  const rows = await db.select().from(agents).where(isNull(agents.retiredAt)).orderBy(agents.name);
  const rationales = new Map(SEED_AGENTS.map((a) => [a.name, a.rationale]));

  const jobRuns = new Map(
    await Promise.all(rows.map(async (r) => [r.name, await recentJobRuns(r.name, 8)] as const)),
  );

  // One query for all of them rather than one per card.
  const learning = new Map(
    (await Promise.all(rows.map(async (r) => [r.name, await getLearning(r.name)] as const)))
      .filter((pair): pair is readonly [string, NonNullable<Awaited<ReturnType<typeof getLearning>>>] =>
        pair[1] !== null),
  );

  /*
   * Two grouped queries for every agent, not two queries per agent. With
   * twenty agents the difference is forty round trips on every load of the
   * screen — and this screen is opened to check on something that is late.
   */
  const ids = rows.map((r) => r.id);
  const lastRuns = ids.length
    ? await db
        .selectDistinctOn([agentRuns.agentId], {
          agentId: agentRuns.agentId,
          startedAt: agentRuns.startedAt,
          outcome: agentRuns.outcome,
          haltReason: agentRuns.haltReason,
        })
        .from(agentRuns)
        .where(inArray(agentRuns.agentId, ids))
        .orderBy(agentRuns.agentId, desc(agentRuns.startedAt))
    : [];
  const lastByAgent = new Map(lastRuns.map((r) => [r.agentId, r]));

  const todayRows = ids.length
    ? await db
        .select({ agentId: agentRuns.agentId, n: sql<number>`count(*)::int` })
        .from(agentRuns)
        .where(and(inArray(agentRuns.agentId, ids), sql`${agentRuns.startedAt} > now() - interval '1 day'`))
        .groupBy(agentRuns.agentId)
    : [];
  const todayByAgent = new Map(todayRows.map((r) => [r.agentId, r.n]));

  return rows.map((r) => {
      const last = lastByAgent.get(r.id);
      const today = { n: todayByAgent.get(r.id) ?? 0 };
  return {
        ...toRecord(r),
        rationale: rationales.get(r.name) ?? null,
        notifySlack: r.notifySlack,
        runEveryMinutes: r.runEveryMinutes,
        lastRanAt: r.lastRanAt,
        instructions: r.instructions,
        learning: learning.get(r.name) ?? null,
        jobRuns: jobRuns.get(r.name) ?? [],
        instructionsUpdatedAt: r.instructionsUpdatedAt,
        lastRun: last ? { startedAt: last.startedAt, outcome: last.outcome, haltReason: last.haltReason } : null,
        runsToday: today?.n ?? 0,
        settings: effectiveSettings(r.name, r.settings),
        settingFields: settingsFor(r.name),
        playbook: r.playbook,
        playbookName: r.playbookName,
        playbookUpdatedAt: r.playbookUpdatedAt,
      };
  });
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
  const rows = await db.select().from(agents).where(isNull(agents.retiredAt));
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

  /*
   * Retire what the roster no longer carries. The rows stay — their runs, their
   * briefs and their audit trail are still readable — but they leave the
   * screen and are switched off so no timer acts on them again.
   */
  const retiring = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    // inArray, not a hand-written `= any(…::text[])`: an array interpolated
    // into raw SQL becomes a row constructor, which Postgres refuses to cast
    // to an array — and this runs on every load of the agents screen.
    .where(and(inArray(agents.name, [...RETIRED_AGENTS]), isNull(agents.retiredAt)));
  if (retiring.length > 0) {
    await db
      .update(agents)
      .set({ retiredAt: new Date(), enabled: false })
      .where(inArray(agents.id, retiring.map((r) => r.id)));
    await writeAudit({ actor, action: 'agents.retire', entityType: 'agents', after: { retired: retiring.map((r) => r.name) } });
  }

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

/**
 * What he has taught an agent.
 *
 * Free text on purpose. The useful corrections are the ones nobody could have
 * anticipated — "the gym invoices are personal, leave them", "Elki's reports
 * are never invoices", "keep drafts to three sentences" — and a form with
 * fields for the corrections we thought of is a form that cannot hold them.
 *
 * It is passed to the model as part of the agent's own instructions, so it
 * shapes the work rather than filtering the result.
 */
export async function setInstructions(
  id: string,
  instructions: string | null,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const [before] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such agent' };

  const text = instructions?.trim() ?? '';
  await db
    .update(agents)
    .set({
      instructions: text === '' ? null : text,
      instructionsUpdatedAt: new Date(),
    })
    .where(eq(agents.id, id));

  await writeAudit({
    actor,
    action: 'agent.instructions',
    entityType: 'agent',
    entityId: id,
    before: { instructions: before.instructions },
    after: { instructions: text === '' ? null : text },
  });
  return { ok: true };
}

/**
 * His dials for one agent.
 *
 * Validated against the agent's own declaration, so a value the code would
 * not know how to read never lands in the row. Only what differs from the
 * default is stored; the rest is the default the day it ships.
 */
export async function setSettings(
  id: string,
  settings: Settings,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const [before] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such agent' };

  await db.update(agents).set({ settings: settings as never }).where(eq(agents.id, id));
  await writeAudit({
    actor,
    action: 'agent.settings',
    entityType: 'agent',
    entityId: id,
    before: { settings: before.settings },
    after: { settings },
  });
  return { ok: true };
}

/**
 * The document behind an agent.
 *
 * Longer than a brief and read the same way: at the top of every run, before
 * anything is decided. Kept as text whatever it arrived as, because what the
 * agent needs is the words — the file it came from is a label on them.
 *
 * There is a ceiling, and it is not arbitrary: a playbook goes into every
 * prompt this agent makes, so a document nobody trimmed is a bill on every run
 * for ever. Fifty thousand characters is a long chapter and still cheap.
 */
export const PLAYBOOK_MAX = 50_000;

export async function setPlaybook(
  id: string,
  playbook: string | null,
  name: string | null,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const [before] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such agent' };

  const text = (playbook ?? '').trim();
  if (text.length > PLAYBOOK_MAX) {
    return { ok: false, error: `That is ${text.length} characters. Trim it to ${PLAYBOOK_MAX}.` };
  }

  await db
    .update(agents)
    .set({
      playbook: text || null,
      playbookName: text ? (name?.trim() || null) : null,
      playbookUpdatedAt: text ? new Date() : null,
    })
    .where(eq(agents.id, id));

  await writeAudit({
    actor,
    action: 'agent.playbook',
    entityType: 'agent',
    entityId: id,
    before: { playbook: before.playbook, playbookName: before.playbookName },
    after: { playbook: text || null, playbookName: name ?? null },
  });
  return { ok: true };
}

/** Whether this agent reports what it did in Slack. */
export async function setNotifySlack(
  id: string,
  on: boolean,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const [before] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such agent' };

  await db.update(agents).set({ notifySlack: on }).where(eq(agents.id, id));
  await writeAudit({
    actor,
    action: 'agent.notify',
    entityType: 'agent',
    entityId: id,
    before: { notifySlack: before.notifySlack },
    after: { notifySlack: on },
  });
  return { ok: true };
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

export async function setRunEvery(
  id: string,
  minutes: number | null,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (minutes !== null && !RUN_INTERVALS.some((i) => i.minutes === minutes)) {
    return { ok: false, error: 'Not one of the intervals' };
  }

  const [before] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such agent' };

  await db.update(agents).set({ runEveryMinutes: minutes }).where(eq(agents.id, id));
  await writeAudit({
    actor,
    action: 'agent.schedule',
    entityType: 'agent',
    entityId: id,
    before: { runEveryMinutes: before.runEveryMinutes },
    after: { runEveryMinutes: minutes },
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
      ...checkConditions,
    },
    actions: checkPerformers,
  };
}

export async function runById(
  id: string,
  options: { dryRun?: boolean; triggeredBy?: string; context?: Record<string, unknown> } = {},
) {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!row) return { outcome: 'failed' as const, conditions: [], actions: [], error: 'No such agent' };

  // Every check and performer sees the agent's own dials.
  const context = { ...(await settingsContext(row.name)), ...(options.context ?? {}) };
  const report = await runAgent(toRecord(row), buildRuntime(), { ...options, context });

  // Telling him must never be able to fail the run it is reporting on.
  await notifyRun(row.id, row.name, report).catch(() => ({ sent: false }));

  return report;
}

export { recentRuns } from './runtime';
export {
  AUTONOMY_LABEL, IRREVERSIBLE_ACTIONS, PROMOTION_MIN_RUNS, RUN_INTERVALS, isIrreversible,
} from './types';
export type { AgentInput, AgentRecord };
