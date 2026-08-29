import { and, asc, desc, eq, isNull, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import { crmCompanies, db, departments, people, pipelineClients, tasks } from '@/lib/db';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { loadClients } from '@/lib/clients/service';
import { todayInTz } from '@/lib/utils';
import type { TaskPriority } from '@/lib/tasks/types';

/**
 * The overview's two work panels.
 *
 * Both answer "what needs me", and both are built to be honest about an empty
 * result: a quiet day is a real answer, and padding the list with whatever is
 * nearest would make the panel useless on the day it matters.
 */

export interface UrgentRow {
  id: string;
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  daysOverdue: number;
  deptCode: string | null;
  ownerName: string | null;
  clickupUrl: string | null;
}

/**
 * Overdue first, then whatever is burning without a date. Ordered by how late
 * it is, because a task three weeks past due is a different problem from one
 * that slipped yesterday.
 */
export async function urgentWork(limit = 8): Promise<{
  rows: UrgentRow[];
  overdue: number;
  burning: number;
  total: number;
}> {
  const today = todayInTz();
  const open = and(isNull(tasks.archivedAt), ne(tasks.status, 'done'));

  const [rows, [overdue], [burning], [total]] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        heatScore: tasks.heatScore,
        clickupUrl: tasks.clickupUrl,
        deptCode: departments.code,
        ownerName: people.name,
      })
      .from(tasks)
      .leftJoin(departments, eq(tasks.deptId, departments.id))
      .leftJoin(people, eq(tasks.ownerPersonId, people.id))
      .where(
        and(
          open,
          or(lte(tasks.dueDate, today), eq(tasks.priority, 'P0'), eq(tasks.priority, 'P1'))!,
        ),
      )
      .orderBy(asc(tasks.dueDate), desc(tasks.heatScore))
      .limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(open, lte(tasks.dueDate, today))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(open, or(eq(tasks.priority, 'P0'), eq(tasks.priority, 'P1'))!)),
    db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(open),
  ]);

  const now = new Date();
  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      priority: r.priority,
      dueDate: r.dueDate,
      daysOverdue: daysOverdue(r.dueDate, now),
      deptCode: r.deptCode,
      ownerName: r.ownerName,
      clickupUrl: r.clickupUrl,
    })),
    overdue: overdue?.n ?? 0,
    burning: burning?.n ?? 0,
    total: total?.n ?? 0,
  };
}

export interface ClientToCall {
  key: string;
  name: string;
  reason: string;
  because: string;
  tone: 'critical' | 'warning' | 'watch' | 'outline';
  moneyCents: number | null;
}

/**
 * Who is owed a conversation, from three signals in priority order:
 *  1. a pipeline client whose next step is past due — a commitment already made;
 *  2. a paying client whose revenue fell hard against its own recent run rate;
 *  3. a large client nobody has logged a conversation with.
 *
 * Revenue is the 30-day account pull, so this is about real money, not a CRM
 * field somebody forgot to update.
 */
export async function clientsToCall(limit = 8): Promise<ClientToCall[]> {
  const today = todayInTz();
  const out: ClientToCall[] = [];

  // 1. Pipeline commitments that have come due.
  const overdueSteps = await db
    .select({
      id: pipelineClients.id,
      name: pipelineClients.name,
      nextStep: pipelineClients.nextStep,
      nextStepDate: pipelineClients.nextStepDate,
      stage: pipelineClients.stage,
      valueCents: pipelineClients.valueCents,
    })
    .from(pipelineClients)
    .where(
      and(
        ne(pipelineClients.stage, 'lost'),
        ne(pipelineClients.stage, 'live'),
        isNotNull(pipelineClients.nextStepDate),
        lte(pipelineClients.nextStepDate, today),
      ),
    )
    .orderBy(asc(pipelineClients.nextStepDate))
    .limit(limit)
    .catch(() => []);

  for (const p of overdueSteps) {
    out.push({
      key: `pipeline:${p.id}`,
      name: p.name,
      reason: 'NEXT STEP DUE',
      because: `${p.nextStep ?? 'Next step'} — due ${p.nextStepDate}`,
      tone: 'critical',
      moneyCents: p.valueCents,
    });
  }

  // 2. Revenue that has dropped against the client's own run rate.
  if (out.length < limit) {
    // The 7-day window, because a client is compared against its own 30-day
    // run rate and the 30-day window has nothing to compare against.
    const { clients } = await loadClients('7D').catch(() => ({ clients: [] }));
    const falling = clients
      .filter((c) => c.profitCents > 0 && c.trendPct !== null && c.trendPct < -0.3)
      .sort((a, b) => (a.trendPct ?? 0) - (b.trendPct ?? 0))
      .slice(0, limit - out.length);

    for (const c of falling) {
      out.push({
        key: `revenue:${c.name}`,
        name: c.name,
        reason: 'REVENUE FALLING',
        because: `Down ${Math.round(Math.abs(c.trendPct ?? 0) * 100)}% against its own 30-day run rate`,
        tone: 'warning',
        moneyCents: c.profitCents,
      });
    }
  }

  // 3. Big CRM accounts with nobody assigned to them.
  if (out.length < limit) {
    const unowned = await db
      .select({ id: crmCompanies.hubspotId, name: crmCompanies.name, stage: crmCompanies.lifecycleStage })
      .from(crmCompanies)
      .where(and(eq(crmCompanies.lifecycleStage, 'customer'), isNull(crmCompanies.ownerName)))
      .orderBy(desc(crmCompanies.contactCount))
      .limit(limit - out.length)
      .catch(() => []);

    for (const c of unowned) {
      out.push({
        key: `crm:${c.id}`,
        name: c.name,
        reason: 'NO OWNER',
        because: 'A customer in the CRM with nobody assigned to it',
        tone: 'watch',
        moneyCents: null,
      });
    }
  }

  return out.slice(0, limit);
}
