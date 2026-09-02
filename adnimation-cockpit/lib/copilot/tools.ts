import { and, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  agents, alerts, contracts, crmCompanies, crmContacts, db, integrationHealth, pipelineClients,
} from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { loadControlPanel } from '@/lib/control/service';
import { summariseCompany } from '@/lib/revenue/company';
import { listPipeline, logTouch } from '@/lib/pipeline/service';
import { STAGES, type Stage } from '@/lib/pipeline/types';
import { listTasks } from '@/lib/tasks/queries';
import { createTask } from '@/lib/tasks/mutations';
import { mailCounts, mailNeedingReply } from '@/lib/mail/service';
import { listDelegations } from '@/lib/delegation/module';
import { listAgents, setAgentEnabled } from '@/lib/agents/module';
import { recentDecisions } from './autopilot';
import { explainSlackError, postToSlack, readSlack, slackChannels } from './slack-view';
import type { ToolCall, ToolSpec } from './provider';

/**
 * What the copilot can see and do.
 *
 * Every tool is a function in this file, reading through the same modules the
 * screens read and writing through the same mutations they write — with the
 * same audit rows and the same undo. The model gets a name, a description and
 * a schema; it never gets SQL, a connection, or a URL. That is the whole
 * security model: the copilot can do exactly what a screen can do, and
 * nothing a screen cannot.
 *
 * Outputs are kept short on purpose. A tool that returns two hundred rows is a
 * tool the model summarises badly; each one here returns the top of the list
 * and says how many more there were.
 */

export interface ToolContext {
  actor: string;
  today: string;
}

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? null : Math.round(cents / 100);

const READ: ToolSpec[] = [
  {
    name: 'get_control_panel',
    description: 'The seven business lines (core clients, video, apps, bidder, display trading, exchange, seat lease): last full day gross and profit in USD, seven-day totals, week-over-week trend, and the top accounts.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_pnl',
    description: 'Company profit and loss for a period: YESTERDAY, WTD, MTD, 7D, 30D. Gross, profit, margin, by business line, with the change against the previous period.',
    parameters: { type: 'object', properties: { period: { type: 'string', description: 'YESTERDAY | WTD | MTD | 7D | 30D' } } },
  },
  {
    name: 'list_deals',
    description: 'The deals board. Filter by stage (open_new, open_existing, negotiation, contract, integration, live, lost), by attention (only overdue or quiet), or search by name.',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string' },
        attention: { type: 'boolean', description: 'Only deals with an overdue next step or no recent conversation.' },
        q: { type: 'string', description: 'Name or domain to search.' },
      },
    },
  },
  {
    name: 'list_tasks',
    description: "Tasks — Maor's own and the team's ClickUp mirror. Filter by overdue, priority, or search.",
    parameters: {
      type: 'object',
      properties: {
        overdue: { type: 'boolean' },
        priority: { type: 'string', description: 'P0 | P1 | P2 | P3' },
        search: { type: 'string' },
        layer: { type: 'string', description: 'mine | company' },
      },
    },
  },
  {
    name: 'list_contracts',
    description: 'Contracts by status (unclassified, in_review, out_for_signature, signed, expired) with who they are with and how long they have waited.',
    parameters: { type: 'object', properties: { status: { type: 'string' } } },
  },
  {
    name: 'mail_waiting',
    description: 'Mail where the last word was theirs and it is from somebody the company deals with — what is waiting on Maor, oldest first — plus the counts.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'delegations_waiting',
    description: 'Work handed to the team in Slack that nobody has answered yet, longest quiet first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'crm_lookup',
    description: 'Find a company or person in the CRM by name, domain or email.',
    parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  },
  {
    name: 'agents_status',
    description: 'Every agent: on or off, autonomy level, last run and its outcome, run count.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'systems_health',
    description: 'The syncs (ClickUp, HubSpot, mail, revenue, source): last success, consecutive errors, last error. Open alerts count.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'slack_channels',
    description: 'Every Slack channel in the workspace, and whether the cockpit is in it (only those can be read or posted to).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_slack',
    description:
      'Read Slack. With text in q it searches the whole workspace; without it, it reads a channel you name, or sweeps the busiest channels the cockpit is in. ' +
      'Optionally narrow to a channel or to the last N hours. This is how you know what the company is saying.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name or id. Omit to sweep several.' },
        q: { type: 'string', description: 'Only messages containing this.' },
        sinceHours: { type: 'number', description: 'Only the last N hours.' },
        limit: { type: 'number', description: 'Messages per channel, up to 100 (default 25).' },
      },
    },
  },
  {
    name: 'recent_decisions',
    description: "The autopilot's recent decisions and whether Maor approved, declined or they were carried out.",
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  },
];

const WRITE: ToolSpec[] = [
  {
    name: 'create_task',
    description: "Open a task on Maor's board. Reversible: it can be archived. Use for anything that needs a person to do something.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', description: 'P0 | P1 | P2 | P3 (default P2)' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD, optional' },
      },
      required: ['title'],
    },
  },
  {
    name: 'raise_alert',
    description: 'Raise an alert in the action inbox. Reversible: it is acknowledged, never deleted.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' }, severity: { type: 'string', description: 'info | warning | critical' } },
      required: ['title', 'body'],
    },
  },
  {
    name: 'note_deal',
    description: 'Log a note on a deal (counts as a conversation touch). Use the deal id from list_deals.',
    parameters: { type: 'object', properties: { dealId: { type: 'string' }, summary: { type: 'string' } }, required: ['dealId', 'summary'] },
  },
  {
    name: 'move_deal_stage',
    description: 'Move a deal to another stage. Reversible (undo on screen). Stages: open_new, open_existing, negotiation, contract, integration, live, lost.',
    parameters: { type: 'object', properties: { dealId: { type: 'string' }, stage: { type: 'string' } }, required: ['dealId', 'stage'] },
  },
  {
    name: 'post_slack',
    description:
      'Say something in a Slack channel, as the cockpit. Only channels the cockpit is in. ' +
      'The whole company sees it and it cannot be unsent — post only what Maor asked for, in the words he approved.',
    parameters: {
      type: 'object',
      properties: { channel: { type: 'string' }, text: { type: 'string' } },
      required: ['channel', 'text'],
    },
  },
  {
    name: 'set_agent_enabled',
    description: 'Switch an agent on or off by name. Never changes its autonomy level.',
    parameters: { type: 'object', properties: { agentName: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['agentName', 'enabled'] },
  },
];

export const READ_TOOL_SPECS: ToolSpec[] = READ;
export const TOOL_SPECS: ToolSpec[] = [...READ, ...WRITE];

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const short = (v: unknown, n = 200) => JSON.stringify(v).slice(0, n);

export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  try {
    const out = await dispatch(call, ctx);
    return typeof out === 'string' ? out : JSON.stringify(out);
  } catch (e) {
    return `Tool failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function dispatch(call: ToolCall, ctx: ToolContext): Promise<unknown> {
  const a = call.args ?? {};
  switch (call.name) {
    case 'get_control_panel': {
      const p = await loadControlPanel();
      return {
        pulledAt: p.pulledAt,
        lines: p.lines.map((l) => ({
          line: l.line, lastDay: l.lastDay, grossUsd: money(l.grossCents), profitUsd: money(l.profitCents),
          gross7dUsd: money(l.gross7dCents), profit7dUsd: money(l.profit7dCents),
          weekOverWeekPct: l.trendPct === null ? null : Math.round(l.trendPct * 100), entities: l.entities, unit: l.unit, stale: l.stale,
        })),
        topAccounts: p.coreClients.map((c) => ({
          account: c.account, trading: c.isTrading, gross7dUsd: money(c.gross7dCents), ours7dUsd: money(c.profit7dCents),
          weekOverWeekPct: c.trendPct === null ? null : Math.round(c.trendPct * 100),
        })),
      };
    }
    case 'get_pnl': {
      const period = (['YESTERDAY', 'WTD', 'MTD', '7D', '30D'].includes(str(a.period)) ? str(a.period) : 'YESTERDAY') as 'YESTERDAY';
      const s = await summariseCompany(period);
      return {
        period, lastCompleteDay: s.lastCompleteDay, live: s.live,
        grossUsd: money(s.company.grossCents), profitUsd: money(s.company.profitCents),
        marginPct: s.company.marginPct === null ? null : Math.round(s.company.marginPct * 1000) / 10,
        changeVsPreviousPct: s.deltaPct === null ? null : Math.round(s.deltaPct * 100),
        lines: s.lines.map((l) => ({ line: l.label, grossUsd: money(l.grossCents), profitUsd: money(l.profitCents), shareOfProfitPct: Math.round(l.shareOfProfit * 100) })),
      };
    }
    case 'list_deals': {
      const stage = (STAGES as readonly string[]).includes(str(a.stage)) ? (str(a.stage) as Stage) : undefined;
      const rows = await listPipeline({ stage, attention: a.attention === true, q: str(a.q) || undefined, sort: 'next_step' });
      return {
        count: rows.length,
        deals: rows.slice(0, 30).map((d) => ({
          id: d.id, name: d.name, stage: d.stage, type: d.clientType, temperature: d.temperature, owner: d.ownerName,
          nextStep: d.nextStep, nextStepDate: d.nextStepDate, stepOverdue: d.stepOverdue, quietDays: d.quietDays,
          valueUsdPerMonth: money(d.valueCents), probability: d.probability,
        })),
      };
    }
    case 'list_tasks': {
      const rows = await listTasks({
        layer: a.layer === 'mine' || a.layer === 'company' ? a.layer : undefined,
        priority: ['P0', 'P1', 'P2', 'P3'].includes(str(a.priority)) ? [str(a.priority) as 'P0'] : undefined,
        search: str(a.search) || undefined,
        limit: 200,
      });
      const filtered = a.overdue === true ? rows.filter((t) => t.dueDate !== null && t.dueDate < ctx.today) : rows;
      return {
        count: filtered.length,
        tasks: filtered.slice(0, 30).map((t) => ({
          id: t.id, title: t.title, priority: t.priority, status: t.status, dueDate: t.dueDate, owner: t.ownerName,
          department: t.deptNameHe, layer: t.layer, heat: t.heatScore, snoozed: t.snoozeCount,
        })),
      };
    }
    case 'list_contracts': {
      const status = str(a.status) || null;
      const rows = await db
        .select()
        .from(contracts)
        .where(and(isNull(contracts.archivedAt), status ? eq(contracts.status, status as never) : sql`true`))
        .orderBy(desc(contracts.statusChangedAt))
        .limit(40);
      const now = Date.now();
      return {
        count: rows.length,
        contracts: rows.map((c) => ({
          id: c.id, with: c.counterpartyName, category: c.category, status: c.status, docType: c.docType,
          daysInStatus: c.statusChangedAt ? Math.floor((now - c.statusChangedAt.getTime()) / 86_400_000) : null,
          waitingOn: c.waitingOnOverride, valueUsd: money(c.valueCents), endDate: c.endDate, dealId: c.pipelineClientId,
        })),
      };
    }
    case 'mail_waiting': {
      const limit = typeof a.limit === 'number' ? Math.min(30, Math.max(1, a.limit)) : 10;
      const [rows, counts] = await Promise.all([mailNeedingReply(limit), mailCounts()]);
      return {
        waiting: counts.waiting, important: counts.important, oldestWaitingDays: counts.oldestWaitingDays, lastSyncedAt: counts.lastSyncedAt,
        conversations: rows.map((m) => ({ threadId: m.threadId, subject: m.subject, from: m.counterpartName ?? m.counterpartEmail, company: m.knownCompany, daysWaiting: m.daysWaiting, snippet: m.snippet?.slice(0, 160) })),
      };
    }
    case 'delegations_waiting': {
      const rows = (await listDelegations('waiting')).sort((x, y) => y.daysQuiet - x.daysQuiet);
      return { count: rows.length, delegations: rows.slice(0, 20).map((d) => ({ id: d.id, title: d.title, person: d.personName, daysQuiet: d.daysQuiet, nudges: d.nudgeCount, stuck: d.stuck })) };
    }
    case 'crm_lookup': {
      const q = `%${str(a.q).trim()}%`;
      if (q === '%%') return 'Give me something to search for.';
      const [companies, contacts] = await Promise.all([
        db.select().from(crmCompanies).where(and(isNull(crmCompanies.archivedAt), or(ilike(crmCompanies.name, q), ilike(crmCompanies.domain, q)))).limit(8),
        db.select().from(crmContacts).where(and(isNull(crmContacts.archivedAt), or(ilike(crmContacts.email, q), ilike(crmContacts.firstName, q), ilike(crmContacts.lastName, q), ilike(crmContacts.companyName, q)))).limit(12),
      ]);
      return {
        companies: companies.map((c) => ({ id: c.hubspotId, name: c.name, domain: c.domain, stage: c.lifecycleStage, owner: c.ownerName, contacts: c.contactCount })),
        contacts: contacts.map((p) => ({ id: p.hubspotId, name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(), email: p.email, title: p.jobTitle, company: p.companyName, phone: p.phone })),
      };
    }
    case 'agents_status': {
      const rows = await listAgents();
      return rows.map((r) => ({
        name: r.name, on: r.enabled, level: r.autonomyLevel, runs: r.runCount,
        lastRun: r.lastRun?.startedAt ?? null, lastOutcome: r.lastRun?.outcome ?? null,
        lastHalt: r.lastRun?.haltReason ?? null, runsToday: r.runsToday,
        // Whether he has told it how the job is done, and how much.
        hasPlaybook: Boolean(r.playbook), playbookChars: r.playbook?.length ?? 0,
      }));
    }
    case 'systems_health': {
      const [health, [open]] = await Promise.all([
        db.select().from(integrationHealth),
        db.select({ n: sql<number>`count(*)::int` }).from(alerts).where(isNull(alerts.ackedAt)),
      ]);
      return {
        openAlerts: open?.n ?? 0,
        systems: health.map((h) => ({ system: h.system, lastSuccessAt: h.lastSuccessAt, lastAttemptAt: h.lastAttemptAt, consecutiveErrors: h.consecutiveErrors, lastError: h.lastError?.slice(0, 200) ?? null })),
      };
    }
    case 'slack_channels': {
      let rows;
      try {
        rows = await slackChannels();
      } catch (e) {
        return explainSlackError(e);
      }
      return {
        count: rows.length,
        inTheCockpit: rows.filter((c) => c.readable).length,
        channels: rows.slice(0, 80).map((c) => ({
          name: c.name, id: c.id, private: c.isPrivate, readable: c.readable,
          members: c.memberCount, topic: c.topic ?? c.purpose,
        })),
      };
    }
    case 'read_slack': {
      const out = await readSlack({
        channel: str(a.channel) || null,
        q: str(a.q) || null,
        sinceHours: typeof a.sinceHours === 'number' ? a.sinceHours : null,
        limit: typeof a.limit === 'number' ? a.limit : undefined,
      });
      return {
        channelsRead: out.channelsRead,
        searchedWholeWorkspace: out.searched,
        skipped: out.skipped,
        count: out.lines.length,
        messages: out.lines.slice(0, 120).map((l) => ({
          channel: l.channel, from: l.fromCockpit ? 'the cockpit' : l.author,
          at: l.at, text: l.text.slice(0, 600), url: l.url,
        })),
      };
    }
    case 'recent_decisions': {
      const rows = await recentDecisions(typeof a.limit === 'number' ? Math.min(60, a.limit) : 20);
      return rows.map((d) => ({ id: d.id, at: d.createdAt, area: d.area, title: d.title, status: d.status, action: short(d.action, 160) }));
    }

    // ── writes ──────────────────────────────────────────────────────────
    case 'create_task': {
      const title = str(a.title).trim();
      if (!title) return 'A task needs a title.';
      const priority = ['P0', 'P1', 'P2', 'P3'].includes(str(a.priority)) ? (str(a.priority) as 'P2') : 'P2';
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(str(a.dueDate)) ? str(a.dueDate) : null;
      const task = await createTask(
        { title: title.slice(0, 300), description: str(a.description) || null, priority, status: 'open', dueDate, tags: ['copilot'], blockedPeople: [], source: 'agent', sourceRef: null },
        ctx.actor,
      );
      return `Opened task ${task.id}: "${title}"${dueDate ? ` due ${dueDate}` : ''}.`;
    }
    case 'raise_alert': {
      const title = str(a.title).trim();
      const body = str(a.body).trim();
      if (!title || !body) return 'An alert needs a title and a body.';
      const severity = ['info', 'warning', 'critical'].includes(str(a.severity)) ? str(a.severity) : 'warning';
      const groupKey = `copilot:${title}`.slice(0, 200);
      const [dup] = await db.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.groupKey, groupKey), isNull(alerts.ackedAt), gte(alerts.createdAt, new Date(Date.now() - 3 * 86_400_000)))).limit(1);
      if (dup) return `Not raised: an open alert with this title already exists (${dup.id}).`;
      const [row] = await db.insert(alerts).values({
        severity: severity as never, groupKey, title: title.slice(0, 300), body, whatHappened: body, occurredAt: new Date(),
        recommendedAction: 'Look, decide, and either act or acknowledge.', createdBy: ctx.actor,
      } as never).returning({ id: alerts.id });
      return `Raised ${severity} alert ${row?.id ?? ''}: "${title}".`;
    }
    case 'note_deal': {
      const dealId = str(a.dealId);
      const summary = str(a.summary).trim();
      if (!/^[0-9a-f-]{36}$/.test(dealId) || !summary) return 'Needs a deal id (from list_deals) and a summary.';
      await logTouch({ clientId: dealId, kind: 'note', summary: summary.slice(0, 2000) }, ctx.actor);
      return `Noted on deal ${dealId}: "${summary.slice(0, 80)}".`;
    }
    case 'move_deal_stage': {
      const dealId = str(a.dealId);
      const stage = str(a.stage);
      if (!/^[0-9a-f-]{36}$/.test(dealId)) return 'Needs a deal id from list_deals.';
      if (!(STAGES as readonly string[]).includes(stage)) return `Not a stage. Use one of: ${STAGES.join(', ')}.`;
      const [before] = await db.select().from(pipelineClients).where(eq(pipelineClients.id, dealId)).limit(1);
      if (!before) return 'No such deal.';
      await db.update(pipelineClients).set({ stage, updatedAt: new Date() }).where(eq(pipelineClients.id, dealId));
      await writeAudit({ actor: ctx.actor, action: 'pipeline.update', entityType: 'pipeline_client', entityId: dealId, before: { stage: before.stage }, after: { stage } });
      return `Moved ${before.name} from ${before.stage} to ${stage}.`;
    }
    case 'post_slack': {
      const channel = str(a.channel).trim();
      const text = str(a.text).trim();
      if (!channel || !text) return 'Needs a channel and the text to post.';
      const out = await postToSlack(channel, text);
      if (!out.ok) return `Not posted: ${out.error}`;
      await writeAudit({
        actor: ctx.actor,
        action: 'slack.post',
        entityType: 'slack_channel',
        entityId: out.channel ?? channel,
        after: { text: text.slice(0, 2000), url: out.url ?? null },
      });
      return `Posted in #${out.channel}${out.url ? ` — ${out.url}` : ''}.`;
    }
    case 'set_agent_enabled': {
      const name = str(a.agentName);
      const [row] = await db.select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.name, name), isNull(agents.retiredAt))).limit(1);
      if (!row) return `No agent called "${name}".`;
      if (row.name === 'autopilot') return 'The autopilot does not switch itself; that is his.';
      const res = await setAgentEnabled(row.id, a.enabled === true, ctx.actor);
      return res.ok ? `Switched ${row.name} ${a.enabled === true ? 'on' : 'off'}.` : `Could not: ${res.error}`;
    }
    default:
      return `Unknown tool ${call.name}.`;
  }
}
