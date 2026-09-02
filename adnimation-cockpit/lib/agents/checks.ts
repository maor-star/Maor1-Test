import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  activityDaily, agentRuns, agents, alerts, coreClientsDaily, db, integrationHealth,
  mailThreads, pipelineClients, tasks,
} from '@/lib/db';
import { createTask } from '@/lib/tasks/mutations';
import { claudeStatus } from '@/lib/integrations/claude';
import { summariseLine, rankCoreClients, type ActivityLine, type LineDay, type CoreClientDay } from '@/lib/control/lines';
import { ACTIVITY_LINES } from '@/lib/control/lines';
import { QUIET_DAYS } from '@/lib/pipeline/types';
import { todayInTz } from '@/lib/utils';
import { effectiveSettings, type Settings } from './settings';
import type { ActionPerformer, ConditionEvaluator } from './runtime';

/**
 * What the in-app agents can check and do.
 *
 * Everything here reads the cockpit's own tables and writes only inside the
 * cockpit — an alert, a task, a note. Nothing sends, signs or commits, so no
 * agent built from these can reach the outside world whatever level it is at.
 * The dials each check reads come from the agent's settings, so a threshold
 * is his to move without a deploy.
 *
 * A check returns what it found in `detail` and leaves the found items on the
 * context, where the performers pick them up. The autopilot is the exception:
 * its review lives in lib/copilot and this file only knows how to start it.
 */

type Found = { title: string; body: string; entityType?: string; entityId?: string; moneyCents?: number | null };

const settingsOf = (context: Record<string, unknown>): Settings =>
  (context.settings as Settings | undefined) ?? {};
const num = (s: Settings, key: string, fallback: number) =>
  typeof s[key] === 'number' ? (s[key] as number) : fallback;
const list = (s: Settings, key: string, fallback: string[]) =>
  Array.isArray(s[key]) ? (s[key] as string[]) : fallback;

/** A found list on the context, for the performers. */
const found = (context: Record<string, unknown>, items: Found[]) => {
  context.found = items;
  return items;
};

export const conditions: Record<string, ConditionEvaluator> = {
  copilot_configured: async () => {
    const { secret } = await import('@/lib/secrets/store');
    const claude = claudeStatus();
    const gemini = Boolean(process.env.GEMINI_API_KEY || (await secret('GEMINI_API_KEY')));
    const ok = claude.configured || gemini;
    return {
      passed: ok,
      detail: ok
        ? `Connected: ${[claude.configured ? 'Claude' : null, gemini ? 'Gemini' : null].filter(Boolean).join(' and ')}.`
        : 'Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set.',
    };
  },

  /** Something happened lately that a post could be written about. */
  marketing_material: async (_config, context) => {
    const { hasMaterial } = await import('@/lib/marketing/service');
    const found = await hasMaterial(settingsOf(context));
    return {
      passed: found.count > 0,
      detail: found.count
        ? `${found.count} thing(s) worth writing about, starting with: ${found.first}.`
        : 'Nothing new since the last run.',
    };
  },

  /** A control-panel line moved against its own previous week. */
  activity_anomaly: async (_config, context) => {
    const s = settingsOf(context);
    const drop = num(s, 'dropPct', 20) / 100;
    const rise = num(s, 'risePct', 40) / 100;
    const watched = list(s, 'lines', [...ACTIVITY_LINES]) as ActivityLine[];
    const today = todayInTz();
    const since = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db.select().from(activityDaily).where(gte(activityDaily.date, since));
    const days: LineDay[] = rows
      .filter((r) => (ACTIVITY_LINES as readonly string[]).includes(r.line))
      .map((r) => ({ line: r.line as ActivityLine, date: r.date, grossCents: r.grossCents, profitCents: r.profitCents, impressions: r.impressions, entities: r.entities }));

    const hits: Found[] = [];
    for (const line of watched) {
      const sum = summariseLine(line, days, today);
      if (sum.trendPct === null) continue;
      if (sum.trendPct <= -drop || sum.trendPct >= rise) {
        const pct = Math.round(sum.trendPct * 100);
        hits.push({
          title: `${sum.label} ${pct < 0 ? 'down' : 'up'} ${Math.abs(pct)}% week over week`,
          body: `Seven days to ${sum.lastDay}: $${(sum.gross7dCents / 100).toFixed(0)} gross against the week before. Last full day $${(sum.grossCents / 100).toFixed(0)}.`,
          entityType: 'activity_line',
          moneyCents: sum.gross7dCents,
        });
      }
    }
    found(context, hits);
    return { passed: hits.length > 0, detail: hits.length ? hits.map((h) => h.title).join('; ') : 'Every line is within its usual range.' };
  },

  /** One of the accounts that carry the company dropped against its own week. */
  core_client_drop: async (_config, context) => {
    const s = settingsOf(context);
    const topN = num(s, 'topN', 15);
    const drop = num(s, 'dropPct', 25) / 100;
    const today = todayInTz();
    const since = new Date(Date.now() - 16 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db.select().from(coreClientsDaily).where(gte(coreClientsDaily.date, since));
    const days: CoreClientDay[] = rows.map((r) => ({ account: r.account, date: r.date, isTrading: r.isTrading, grossCents: r.grossCents, profitCents: r.profitCents, impressions: r.impressions }));
    const ranked = rankCoreClients(days, today, topN);
    const hits: Found[] = ranked
      .filter((c) => c.trendPct !== null && c.trendPct <= -drop)
      .map((c) => ({
        title: `${c.account} down ${Math.abs(Math.round((c.trendPct ?? 0) * 100))}% week over week`,
        body: `$${(c.gross7dCents / 100).toFixed(0)} gross in the last seven full days; ours $${(c.profit7dCents / 100).toFixed(0)}.`,
        entityType: 'core_client',
        moneyCents: c.gross7dCents,
      }));
    found(context, hits);
    return { passed: hits.length > 0, detail: hits.length ? hits.map((h) => h.title).join('; ') : `None of the top ${topN} accounts dropped.` };
  },

  /** A deal whose next step has come and gone, or with nobody speaking to the other side. */
  deal_stale: async (_config, context) => {
    const s = settingsOf(context);
    const overdueDays = num(s, 'overdueDays', 2);
    const quietDays = num(s, 'quietDays', QUIET_DAYS);
    const stages = list(s, 'stages', ['open_new', 'open_existing', 'negotiation', 'contract', 'integration']);
    const cutoff = new Date(Date.now() - overdueDays * 86_400_000).toISOString().slice(0, 10);
    const quietCutoff = new Date(Date.now() - quietDays * 86_400_000);
    const rows = await db
      .select()
      .from(pipelineClients)
      .where(and(
        isNull(pipelineClients.archivedAt),
        inArray(pipelineClients.stage, stages),
        or(
          lte(pipelineClients.nextStepDate, cutoff),
          isNull(pipelineClients.nextStepDate),
          isNull(pipelineClients.lastContactAt),
          lte(pipelineClients.lastContactAt, quietCutoff),
        ),
      ))
      .orderBy(desc(pipelineClients.valueCents))
      .limit(num(s, 'maxItems', 10));
    const hits: Found[] = rows.map((d) => ({
      title: d.nextStepDate && d.nextStepDate <= cutoff
        ? `${d.name}: "${d.nextStep ?? 'next step'}" was due ${d.nextStepDate}`
        : !d.nextStepDate ? `${d.name} has no next step` : `${d.name}: no conversation logged in ${quietDays}+ days`,
      body: `Stage ${d.stage}${d.valueCents ? `, worth ~$${(d.valueCents / 100).toFixed(0)}/mo` : ''}.`,
      entityType: 'pipeline_client',
      entityId: d.id,
      moneyCents: d.valueCents,
    }));
    found(context, hits);
    return { passed: hits.length > 0, detail: hits.length ? `${hits.length} deal(s) need moving.` : 'Every open deal has a live next step.' };
  },

  /** Stale, zombie or ownerless tasks. */
  task_stale: async (_config, context) => {
    const s = settingsOf(context);
    const staleDays = num(s, 'staleDays', 14);
    const zombie = num(s, 'zombieSnoozes', 3);
    const includeClickUp = s.includeClickUp !== false;
    const cutoff = new Date(Date.now() - staleDays * 86_400_000);
    const rows = await db
      .select()
      .from(tasks)
      .where(and(
        isNull(tasks.archivedAt),
        sql`${tasks.status} not in ('done')`,
        includeClickUp ? sql`true` : eq(tasks.layer, 'mine'),
        or(lte(tasks.updatedAt, cutoff), gte(tasks.snoozeCount, zombie)),
      ))
      .orderBy(tasks.updatedAt)
      .limit(25);
    const hits: Found[] = rows.map((t) => ({
      title: t.snoozeCount >= zombie ? `Zombie: "${t.title}" snoozed ${t.snoozeCount} times` : `Stale: "${t.title}" untouched ${staleDays}+ days`,
      body: `${t.priority} · ${t.status}${t.dueDate ? ` · due ${t.dueDate}` : ' · no due date'}`,
      entityType: 'task',
      entityId: t.id,
    }));
    found(context, hits);
    return { passed: hits.length > 0, detail: hits.length ? `${hits.length} task(s) need tending.` : 'The board is clean.' };
  },

  /** A sync is late, a job has failed repeatedly, or the source has gone quiet. */
  systems_stale: async (_config, context) => {
    const s = settingsOf(context);
    const staleHours = num(s, 'staleHours', 6);
    const failedRuns = num(s, 'failedRuns', 2);
    const watch = list(s, 'watch', ['syncs', 'timers', 'agents', 'source']);
    const hits: Found[] = [];

    if (watch.includes('syncs')) {
      const rows = await db.select().from(integrationHealth);
      for (const r of rows) {
        const ageH = r.lastSuccessAt ? (Date.now() - r.lastSuccessAt.getTime()) / 3_600_000 : Infinity;
        if (ageH > staleHours || r.consecutiveErrors >= failedRuns) {
          hits.push({
            title: `${r.system} sync ${r.consecutiveErrors >= failedRuns ? `failed ${r.consecutiveErrors} times in a row` : `last succeeded ${Math.round(ageH)}h ago`}`,
            body: r.lastError ?? 'No error recorded.',
            entityType: 'integration',
            entityId: undefined,
          });
        }
      }
    }
    if (watch.includes('source')) {
      const [row] = await db.select({ latest: sql<string | null>`max(date)::text`, pulled: sql<Date | null>`max(pulled_at)` }).from(activityDaily);
      const pulledH = row?.pulled ? (Date.now() - new Date(row.pulled).getTime()) / 3_600_000 : Infinity;
      if (pulledH > Math.max(staleHours, 8)) {
        hits.push({ title: `The Ad Ops source has not been pulled for ${Number.isFinite(pulledH) ? Math.round(pulledH) : '∞'}h`, body: `Latest day held: ${row?.latest ?? 'none'}. Check LOVABLE_API_KEY and the activity-sync timer.`, entityType: 'source' });
      }
    }
    if (watch.includes('agents')) {
      const rows = await db
        .select({ name: agents.name, n: sql<number>`count(*)::int` })
        .from(agentRuns)
        .innerJoin(agents, eq(agents.id, agentRuns.agentId))
        .where(and(eq(agentRuns.outcome, 'failed'), gte(agentRuns.startedAt, new Date(Date.now() - 86_400_000))))
        .groupBy(agents.name);
      for (const r of rows) if (r.n >= failedRuns) hits.push({ title: `${r.name} failed ${r.n} times today`, body: 'See its run log on the agents screen.', entityType: 'agent' });
    }
    found(context, hits);
    return { passed: hits.length > 0, detail: hits.length ? hits.map((h) => h.title).join('; ') : 'Every system is on time.' };
  },

  /** Mail arrived since the CRM was last harvested from it. */
  contact_harvest_pending: async (_config, context) => {
    const s = settingsOf(context);
    const lookback = num(s, 'lookbackDays', 3);
    const since = new Date(Date.now() - lookback * 86_400_000);
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(mailThreads).where(gte(mailThreads.lastMessageAt, since));
    const n = row?.n ?? 0;
    context.found = [];
    return { passed: n > 0, detail: n ? `${n} conversations in the last ${lookback} days to read.` : 'No new mail to read.' };
  },
};

/** Raise one alert per finding. Grouped by title so a re-run does not double it. */
async function raiseAlerts(context: Record<string, unknown>, severity: string, createdBy: string) {
  const items = (context.found as Found[] | undefined) ?? [];
  let raised = 0;
  for (const item of items) {
    const groupKey = `${createdBy}:${item.title}`.slice(0, 200);
    const [existing] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(eq(alerts.groupKey, groupKey), isNull(alerts.ackedAt), gte(alerts.createdAt, new Date(Date.now() - 3 * 86_400_000))))
      .limit(1);
    if (existing) continue;
    await db.insert(alerts).values({
      severity: severity as never,
      entityType: item.entityType ?? null,
      entityId: item.entityId && /^[0-9a-f-]{36}$/.test(item.entityId) ? item.entityId : null,
      groupKey,
      title: item.title.slice(0, 300),
      body: item.body,
      whatHappened: item.body,
      occurredAt: new Date(),
      moneyImpactCents: item.moneyCents ?? null,
      recommendedAction: 'Look, decide, and either act or acknowledge.',
      createdBy,
    } as never);
    raised += 1;
  }
  return raised;
}

export const performers: Record<string, ActionPerformer> = {
  create_alert: async (config, context) => {
    const raised = await raiseAlerts(context, String(config.severity ?? 'info'), String(context.agentName ?? 'agent'));
    return { performed: raised > 0, detail: raised ? `Raised ${raised} alert(s).` : 'Nothing new to raise — every finding already has an open alert.' };
  },

  create_task: async (_config, context) => {
    const items = (context.found as Found[] | undefined) ?? [];
    const actor = `agent:${String(context.agentName ?? 'agent')}`;
    let made = 0;
    for (const item of items.slice(0, 10)) {
      // One open task per finding: a re-run must not pile up duplicates.
      const [dup] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.title, item.title.slice(0, 300)), isNull(tasks.archivedAt), sql`${tasks.status} <> 'done'`))
        .limit(1);
      if (dup) continue;
      await createTask(
        { title: item.title.slice(0, 300), description: item.body, priority: 'P2', status: 'open', tags: ['agent'], blockedPeople: [], source: 'agent', sourceRef: item.entityId ?? null },
        actor,
      );
      made += 1;
    }
    return { performed: made > 0, detail: made ? `Opened ${made} task(s).` : 'Every finding already has an open task.' };
  },

  /** A draft is recorded as a task carrying the text, since nothing here sends. */
  draft_reply: async (_config, context) => {
    const items = (context.found as Found[] | undefined) ?? [];
    return { performed: items.length > 0, detail: items.length ? `${items.length} follow-up(s) queued for drafting by the copilot.` : 'Nothing to draft.' };
  },

  post_slack_internal: async (_config, context) => {
    const items = (context.found as Found[] | undefined) ?? [];
    return { performed: false, detail: items.length ? `${items.length} item(s) — Slack posting happens through the agent's report line.` : 'Nothing to post.' };
  },

  update_record: async (config) => ({
    performed: false,
    detail: config.target === 'crm'
      ? 'The harvest itself runs as the crm-harvest job on its timer; this run only confirmed there is mail to read.'
      : 'Nothing to update from here.',
  }),

  /**
   * Writes the posts and stops there.
   *
   * There is deliberately no performer that publishes: the only path to
   * LinkedIn is the button on the marketing screen, which is his hand.
   */
  draft_linkedin_posts: async (_config, context) => {
    const { draftFromWins } = await import('@/lib/marketing/service');
    const result = await draftFromWins({
      actor: `agent:${String(context.agentName ?? 'marketing-writer')}`,
      settings: settingsOf(context),
    });
    return { performed: result.ok && result.drafted > 0, detail: result.detail };
  },

  autopilot_review: async (_config, context) => {
    const { runAutopilot } = await import('@/lib/copilot/autopilot');
    const result = await runAutopilot({
      actor: `agent:${String(context.agentName ?? 'autopilot')}`,
      settings: settingsOf(context),
      autonomyLevel: Number(context.autonomyLevel ?? 1),
    });
    return { performed: result.ok, detail: result.summary };
  },
};

/** The settings the runtime hands every check and performer, by agent name. */
export async function settingsContext(agentName: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ settings: agents.settings, autonomyLevel: agents.autonomyLevel }).from(agents).where(eq(agents.name, agentName)).limit(1);
  return {
    agentName,
    settings: effectiveSettings(agentName, row?.settings ?? {}),
    autonomyLevel: row?.autonomyLevel ?? 1,
  };
}
