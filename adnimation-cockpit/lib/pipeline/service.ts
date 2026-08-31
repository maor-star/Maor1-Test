import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, people, pipelineClients, pipelineTouches } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { todayInTz } from '@/lib/utils';
import {
  QUIET_DAYS, pipelineInputSchema, touchInputSchema,
  type ClientType, type PipelineInput, type Stage,
} from './types';
import type { PipelineRow } from './board';

export { buildBoard, type PipelineBoard, type PipelineRow } from './board';

/**
 * The pipeline the CEO works.
 *
 * Distinct from the HubSpot mirror on purpose: that is a read-only copy of a
 * system somebody else maintains, this is his own working state. An edit here
 * survives every CRM sync, which is the whole point of keeping it separate.
 */

const daysSince = (d: Date | null, now: Date) =>
  d === null ? null : Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));

export interface PipelineFilter {
  stage?: Stage;
  clientType?: ClientType;
  q?: string;
  /** Only the ones that need attention: overdue next step, or gone quiet. */
  attention?: boolean;
  sort?: PipelineSort;
}

/**
 * What the list is ordered by.
 *
 * Newest first is the default: he opens this screen after something has
 * happened, and what he is looking for is nearly always the conversation that
 * just started. "Next step first" is the order for working the list top to
 * bottom, and it is one click away.
 *
 * Every order ends in a tiebreak, so two clients that compare equal do not
 * swap places between page loads.
 */
export const PIPELINE_SORTS = ['newest', 'oldest', 'next_step', 'value'] as const;
export type PipelineSort = (typeof PIPELINE_SORTS)[number];

export const PIPELINE_SORT_LABEL: Record<PipelineSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  next_step: 'Next step first',
  value: 'Biggest first',
};

function ordering(sort: PipelineSort = 'newest') {
  switch (sort) {
    case 'oldest':
      return [asc(pipelineClients.createdAt)];
    case 'next_step':
      // Nulls last: a client with no next step is not the most urgent thing on
      // the page, however overdue the ones with dates are.
      return [
        sql`${pipelineClients.nextStepDate} asc nulls last`,
        desc(pipelineClients.valueCents),
      ];
    case 'value':
      return [sql`${pipelineClients.valueCents} desc nulls last`, desc(pipelineClients.createdAt)];
    case 'newest':
    default:
      return [desc(pipelineClients.createdAt)];
  }
}

export async function listPipeline(filter: PipelineFilter = {}): Promise<PipelineRow[]> {
  const today = todayInTz();
  const now = new Date();
  const where = [isNull(pipelineClients.archivedAt)];

  if (filter.stage) where.push(eq(pipelineClients.stage, filter.stage));
  if (filter.clientType) where.push(eq(pipelineClients.clientType, filter.clientType));
  if (filter.q?.trim()) {
    const q = `%${filter.q.trim()}%`;
    where.push(or(ilike(pipelineClients.name, q), ilike(pipelineClients.domain, q))!);
  }

  const rows = await db
    .select({
      id: pipelineClients.id,
      name: pipelineClients.name,
      domain: pipelineClients.domain,
      clientType: pipelineClients.clientType,
      stage: pipelineClients.stage,
      temperature: pipelineClients.temperature,
      ownerPersonId: pipelineClients.ownerPersonId,
      ownerName: people.name,
      nextStep: pipelineClients.nextStep,
      nextStepDate: pipelineClients.nextStepDate,
      valueCents: pipelineClients.valueCents,
      probability: pipelineClients.probability,
      source: pipelineClients.source,
      notes: pipelineClients.notes,
      lastContactAt: pipelineClients.lastContactAt,
      touches: sql<number>`(select count(*)::int from pipeline_touches t where t.client_id = ${pipelineClients.id})`,
    })
    .from(pipelineClients)
    .leftJoin(people, eq(pipelineClients.ownerPersonId, people.id))
    .where(and(...where))
    .orderBy(...ordering(filter.sort));

  const mapped: PipelineRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    clientType: r.clientType as ClientType,
    stage: r.stage as Stage,
    temperature: r.temperature as 'hot' | 'warm' | 'cold',
    ownerName: r.ownerName,
    ownerPersonId: r.ownerPersonId,
    nextStep: r.nextStep,
    nextStepDate: r.nextStepDate,
    valueCents: r.valueCents,
    probability: r.probability,
    source: r.source,
    notes: r.notes,
    lastContactAt: r.lastContactAt,
    quietDays: daysSince(r.lastContactAt, now),
    stepOverdue: r.nextStepDate !== null && r.nextStepDate <= today,
    touches: r.touches,
  }));

  if (!filter.attention) return mapped;
  return mapped.filter(
    (r) => r.stepOverdue || (r.quietDays !== null && r.quietDays >= QUIET_DAYS) || r.quietDays === null,
  );
}

export async function upsertPipelineClient(
  input: PipelineInput & { id?: string },
  actor: string,
): Promise<string> {
  const parsed = pipelineInputSchema.parse(input);
  const values = {
    name: parsed.name,
    domain: parsed.domain ?? null,
    clientType: parsed.clientType,
    stage: parsed.stage,
    temperature: parsed.temperature,
    ownerPersonId: parsed.ownerPersonId ?? null,
    nextStep: parsed.nextStep ?? null,
    nextStepDate: parsed.nextStepDate ?? null,
    valueCents: parsed.valueCents ?? null,
    probability: parsed.probability ?? null,
    source: parsed.source ?? null,
    notes: parsed.notes ?? null,
    hubspotCompanyId: parsed.hubspotCompanyId ?? null,
    updatedAt: new Date(),
  };

  if (input.id) {
    const [before] = await db
      .select()
      .from(pipelineClients)
      .where(eq(pipelineClients.id, input.id))
      .limit(1);
    if (!before) throw new Error('No pipeline client with that id');

    await db.update(pipelineClients).set(values).where(eq(pipelineClients.id, input.id));
    await writeAudit({
      actor,
      action: 'pipeline.update',
      entityType: 'pipeline_client',
      entityId: input.id,
      before: { stage: before.stage, nextStep: before.nextStep, nextStepDate: before.nextStepDate },
      after: { stage: values.stage, nextStep: values.nextStep, nextStepDate: values.nextStepDate },
    });
    return input.id;
  }

  const [row] = await db.insert(pipelineClients).values(values).returning({ id: pipelineClients.id });
  if (!row) throw new Error('Pipeline insert returned nothing');

  await writeAudit({
    actor,
    action: 'pipeline.create',
    entityType: 'pipeline_client',
    entityId: row.id,
    after: values,
  });
  return row.id;
}

/** Logging a conversation is what makes "when did we last speak" a fact. */
export async function logTouch(
  input: { clientId: string; kind: string; summary: string },
  actor: string,
): Promise<void> {
  const parsed = touchInputSchema.parse(input);
  const now = new Date();

  await db.insert(pipelineTouches).values({
    clientId: parsed.clientId,
    kind: parsed.kind,
    summary: parsed.summary,
    happenedAt: now,
    createdBy: actor,
  });

  await db
    .update(pipelineClients)
    .set({ lastContactAt: now, updatedAt: now })
    .where(eq(pipelineClients.id, parsed.clientId));
}

export async function recentTouches(clientIds: string[], perClient = 3) {
  if (clientIds.length === 0) return new Map<string, { kind: string; summary: string; happenedAt: Date }[]>();

  const rows = await db
    .select()
    .from(pipelineTouches)
    .where(inArray(pipelineTouches.clientId, clientIds))
    .orderBy(desc(pipelineTouches.happenedAt));

  const byClient = new Map<string, { kind: string; summary: string; happenedAt: Date }[]>();
  for (const r of rows) {
    const list = byClient.get(r.clientId) ?? [];
    if (list.length < perClient) {
      list.push({ kind: r.kind, summary: r.summary, happenedAt: r.happenedAt });
      byClient.set(r.clientId, list);
    }
  }
  return byClient;
}

export async function listOwners() {
  return db.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.name));
}
