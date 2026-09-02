import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { copilotDecisions, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { todayInTz } from '@/lib/utils';
import type { Settings } from '@/lib/agents/settings';
import { chat, loadProviderKeys, resolveProvider, type ToolResult, type Turn } from './provider';
import { READ_TOOL_SPECS, runTool, type ToolContext } from './tools';
import { systemBrief } from './service';

/**
 * The daily review — the autopilot agent's one action.
 *
 * It reads the company through the same tools the chat uses, then hands back a
 * list of decisions: what it saw, what it decided, what it would do. Whether a
 * decision is *done* or only *proposed* is not the model's call. It is the
 * agent's autonomy level and his permission dials: at level 1 everything is a
 * proposal he approves or declines on the Copilot screen; from level 2 the
 * kinds he has allowed are carried out, and every one is still written down
 * with its reasoning. Nothing here can send, sign, pay or touch the outside
 * world — the executable kinds are the cockpit's own reversible mutations.
 */

export const DECISION_KINDS = ['task', 'alert', 'note', 'stage', 'agent', 'none'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export interface Decision {
  area: string;
  title: string;
  reasoning: string;
  action: { kind: DecisionKind } & Record<string, unknown>;
}

const RECORD_TOOL = {
  name: 'record_decision',
  description:
    'Record one decision from the review. Call it once per decision. kind is what you would do about it: ' +
    'task (open a task: title, description, priority P0-P3, dueDate), alert (raise an alert: title, body, severity), ' +
    'note (log a note on a deal: dealId, summary), stage (move a deal: dealId, stage), ' +
    'agent (switch an agent on or off: agentName, enabled), or none (worth knowing, nothing to do).',
  parameters: {
    type: 'object',
    properties: {
      area: { type: 'string', description: 'lines | clients | deals | contracts | tasks | mail | agents | systems' },
      title: { type: 'string', description: 'One line: what you saw and what should happen.' },
      reasoning: { type: 'string', description: 'Why, with the figures you read. Two to four sentences.' },
      action: {
        type: 'object',
        description: 'The action, with kind and its fields.',
        properties: {
          kind: { type: 'string', description: 'task | alert | note | stage | agent | none' },
          title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string' }, dueDate: { type: 'string' },
          body: { type: 'string' }, severity: { type: 'string' },
          dealId: { type: 'string' }, summary: { type: 'string' }, stage: { type: 'string' },
          agentName: { type: 'string' }, enabled: { type: 'boolean' },
        },
        required: ['kind'],
      },
    },
    required: ['area', 'title', 'reasoning', 'action'],
  },
};

export interface AutopilotOptions {
  actor: string;
  settings: Settings;
  autonomyLevel: number;
  /** A run id to group the decisions under; one is made when absent. */
  runId?: string;
}

export interface AutopilotResult {
  ok: boolean;
  summary: string;
  decisions: number;
  executed: number;
  runId: string;
}

/** Which decision kinds may be carried out without him, at this level and with these dials. */
export function executableKinds(autonomyLevel: number, settings: Settings): Set<DecisionKind> {
  if (autonomyLevel < 2) return new Set();
  const allowed = Array.isArray(settings.mayAct) ? (settings.mayAct as string[]) : ['task', 'alert', 'note'];
  return new Set(allowed.filter((k): k is DecisionKind => (DECISION_KINDS as readonly string[]).includes(k) && k !== 'none'));
}

export async function runAutopilot(opts: AutopilotOptions): Promise<AutopilotResult> {
  const runId = opts.runId ?? crypto.randomUUID();
  await loadProviderKeys();
  const provider = resolveProvider(typeof opts.settings.provider === 'string' ? opts.settings.provider : 'auto');
  if (!provider) return { ok: false, summary: 'No model is connected.', decisions: 0, executed: 0, runId };

  const scope = Array.isArray(opts.settings.scope) ? (opts.settings.scope as string[]) : ['lines', 'clients', 'deals', 'contracts', 'tasks', 'mail', 'agents', 'systems'];
  const maxDecisions = typeof opts.settings.maxDecisions === 'number' ? opts.settings.maxDecisions : 12;
  const language = typeof opts.settings.language === 'string' ? opts.settings.language : 'match';
  const ctx: ToolContext = { actor: opts.actor, today: todayInTz() };
  const may = executableKinds(opts.autonomyLevel, opts.settings);

  const brief = systemBrief(
    ctx,
    [
      `This is the daily autonomous review, not a conversation. Nobody is typing.`,
      `Review these areas, in this order, reading each through its tool: ${scope.join(', ')}.`,
      `Then record at most ${maxDecisions} decisions with record_decision, most important first. Prefer fewer, sharper decisions over many small ones. Do not record a decision for something that already has an open task or alert with the same subject.`,
      `Write titles and reasoning in ${language === 'he' ? 'Hebrew' : language === 'en' ? 'English' : 'English'}. Ad-tech terms stay in English.`,
      may.size === 0
        ? `You are at autonomy level ${opts.autonomyLevel}: every decision is a proposal for Maor. Record them; do not call any other writing tool.`
        : `You are at autonomy level ${opts.autonomyLevel}. Decisions of kind ${[...may].join(', ')} will be carried out automatically after you record them; the rest wait for Maor. Still record everything; do not call the writing tools yourself.`,
      `When you have recorded your decisions, answer with a three-line summary of the company this morning.`,
    ].join('\n'),
  );

  const turns: Turn[] = [{ role: 'user', text: 'Run the daily review now.' }];
  const decisions: Decision[] = [];
  let summary = '';

  for (let round = 0; round < 14; round += 1) {
    const res = await chat(provider, { system: brief, turns, tools: [...READ_TOOL_SPECS, RECORD_TOOL], maxTokens: 3000 });
    if (!res.ok) return { ok: false, summary: res.error, decisions: decisions.length, executed: 0, runId };
    if (res.toolCalls.length === 0) {
      summary = res.text;
      break;
    }
    turns.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls });
    const results: ToolResult[] = [];
    for (const call of res.toolCalls) {
      if (call.name === 'record_decision') {
        const d = parseDecision(call.args);
        if (d && decisions.length < maxDecisions) decisions.push(d);
        results.push({ id: call.id, name: call.name, output: d ? 'Recorded.' : 'Ignored: missing area, title, reasoning or action.kind.' });
      } else {
        results.push({ id: call.id, name: call.name, output: await runTool(call, ctx) });
      }
    }
    turns.push({ role: 'tool', results });
  }

  let executed = 0;
  for (const d of decisions) {
    const canRun = may.has(d.action.kind) && d.action.kind !== 'none';
    let executedRef: string | null = null;
    if (canRun) {
      const out = await executeDecision(d, ctx);
      if (out.ok) {
        executed += 1;
        executedRef = out.ref;
      }
    }
    await db.insert(copilotDecisions).values({
      runId,
      area: d.area.slice(0, 40),
      title: d.title.slice(0, 300),
      reasoning: d.reasoning.slice(0, 4000),
      action: d.action as never,
      status: d.action.kind === 'none' ? 'noted' : canRun && executedRef ? 'executed' : 'proposed',
      executedRef,
    });
  }

  await writeAudit({
    actor: opts.actor,
    action: 'copilot.review',
    entityType: 'copilot_run',
    entityId: runId,
    after: { decisions: decisions.length, executed, provider, level: opts.autonomyLevel },
  });

  const line = `${decisions.length} decision(s), ${executed} carried out, ${decisions.length - executed} waiting for you.`;
  return { ok: true, summary: summary ? `${line}\n${summary}` : line, decisions: decisions.length, executed, runId };
}

function parseDecision(args: Record<string, unknown>): Decision | null {
  const area = typeof args.area === 'string' ? args.area : null;
  const title = typeof args.title === 'string' ? args.title : null;
  const reasoning = typeof args.reasoning === 'string' ? args.reasoning : '';
  const action = (args.action && typeof args.action === 'object' ? args.action : null) as Record<string, unknown> | null;
  const kind = action && typeof action.kind === 'string' && (DECISION_KINDS as readonly string[]).includes(action.kind) ? (action.kind as DecisionKind) : null;
  if (!area || !title || !kind) return null;
  return { area, title, reasoning, action: { ...action, kind } };
}

/** Carry one decision out through the same tools the chat uses. */
export async function executeDecision(d: Decision, ctx: ToolContext): Promise<{ ok: boolean; ref: string | null; detail: string }> {
  const a = d.action;
  const call = (name: string, args: Record<string, unknown>) => runTool({ id: 'exec', name, args }, ctx);
  switch (a.kind) {
    case 'task': {
      const out = await call('create_task', { title: a.title ?? d.title, description: a.description ?? d.reasoning, priority: a.priority ?? 'P2', dueDate: a.dueDate ?? null });
      return { ok: out.startsWith('Opened'), ref: out, detail: out };
    }
    case 'alert': {
      const out = await call('raise_alert', { title: a.title ?? d.title, body: a.body ?? d.reasoning, severity: a.severity ?? 'warning' });
      return { ok: out.startsWith('Raised'), ref: out, detail: out };
    }
    case 'note': {
      const out = await call('note_deal', { dealId: a.dealId, summary: a.summary ?? d.title });
      return { ok: out.startsWith('Noted'), ref: out, detail: out };
    }
    case 'stage': {
      const out = await call('move_deal_stage', { dealId: a.dealId, stage: a.stage });
      return { ok: out.startsWith('Moved'), ref: out, detail: out };
    }
    case 'agent': {
      const out = await call('set_agent_enabled', { agentName: a.agentName, enabled: a.enabled });
      return { ok: out.startsWith('Switched'), ref: out, detail: out };
    }
    default:
      return { ok: false, ref: null, detail: 'Nothing to do.' };
  }
}

export interface DecisionRow {
  id: string;
  runId: string | null;
  area: string;
  title: string;
  reasoning: string;
  action: Record<string, unknown>;
  status: string;
  executedRef: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export async function recentDecisions(limit = 40): Promise<DecisionRow[]> {
  const rows = await db.select().from(copilotDecisions).orderBy(desc(copilotDecisions.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id, runId: r.runId, area: r.area, title: r.title, reasoning: r.reasoning,
    action: (r.action ?? {}) as Record<string, unknown>, status: r.status, executedRef: r.executedRef,
    createdAt: r.createdAt, decidedAt: r.decidedAt,
  }));
}

export async function decisionCounts(): Promise<{ proposed: number; executed: number; today: number }> {
  const [row] = await db
    .select({
      proposed: sql<number>`count(*) filter (where status = 'proposed')::int`,
      executed: sql<number>`count(*) filter (where status in ('executed','approved'))::int`,
      today: sql<number>`count(*) filter (where created_at > now() - interval '1 day')::int`,
    })
    .from(copilotDecisions);
  return { proposed: row?.proposed ?? 0, executed: row?.executed ?? 0, today: row?.today ?? 0 };
}

/** He approves (which carries it out) or declines a proposed decision. */
export async function decide(id: string, approve: boolean, actor: string): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const [row] = await db.select().from(copilotDecisions).where(and(eq(copilotDecisions.id, id), eq(copilotDecisions.status, 'proposed'))).limit(1);
  if (!row) return { ok: false, error: 'That decision is not waiting on you.' };

  let executedRef: string | null = null;
  let detail = 'Declined.';
  if (approve) {
    const d: Decision = { area: row.area, title: row.title, reasoning: row.reasoning, action: row.action as Decision['action'] };
    const out = await executeDecision(d, { actor, today: todayInTz() });
    if (!out.ok) return { ok: false, error: out.detail };
    executedRef = out.ref;
    detail = out.detail;
  }
  await db
    .update(copilotDecisions)
    .set({ status: approve ? 'approved' : 'declined', decidedAt: new Date(), decidedBy: actor, executedRef })
    .where(eq(copilotDecisions.id, id));
  await writeAudit({ actor, action: approve ? 'copilot.approve' : 'copilot.decline', entityType: 'copilot_decision', entityId: id, after: { detail } });
  return { ok: true, detail };
}

/** Whether the autopilot has reviewed in the last day — for the screen's headline. */
export async function lastReviewAt(): Promise<Date | null> {
  const [row] = await db.select({ at: sql<Date | null>`max(created_at)` }).from(copilotDecisions).where(gte(copilotDecisions.createdAt, new Date(Date.now() - 7 * 86_400_000)));
  return row?.at ? new Date(row.at) : null;
}
