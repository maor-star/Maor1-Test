import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { contracts, db, mailThreads, opportunities, pipelineClients } from '@/lib/db';
import { WAITING_ON, type ContractStatus } from '@/lib/contracts/status';
import { KIND_TO_CLIENT_TYPE } from './rules';
import {
  LIVE_STATUSES, classify, inView, rank, type OpportunityListItem,
  type OpportunityInput, type OpportunityKind, type OpportunityRow,
  type OpportunitySource, type OpportunityStatus, type OpportunityView,
} from './rules';
import { detectOpportunity } from './detect';
import { writeAudit } from '@/lib/audit';
import { restorableSnapshot } from '@/lib/undo';

/**
 * The opportunities module — the list, and everything he does to it.
 *
 * Every mutation moves `lastTouchedAt`, because the one thing this module
 * exists to measure is how long something has sat without a decision. A row
 * he edited yesterday is not cold, whatever its next-step date says.
 */

export type { OpportunityListItem, OpportunityRow, OpportunityView } from './rules';
export {
  COLD_AFTER_DAYS, KIND_LABEL, OPPORTUNITY_KINDS, OPPORTUNITY_STATUSES, OPPORTUNITY_VIEWS,
  STATUS_LABEL, VIEW_LABEL, classify, parseMoneyToCents,
} from './rules';

type DbRow = typeof opportunities.$inferSelect;

function toRow(r: DbRow): OpportunityRow {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as OpportunityKind,
    status: r.status as OpportunityStatus,
    note: r.note,
    valueCents: r.valueCents,
    counterparty: r.counterparty,
    nextStep: r.nextStep,
    nextStepDate: r.nextStepDate,
    revisitOn: r.revisitOn,
    source: r.source as OpportunitySource,
    sourceUrl: r.sourceUrl,
    sourceExcerpt: r.sourceExcerpt,
    sourceAt: r.sourceAt,
    createdAt: r.createdAt,
    lastTouchedAt: r.lastTouchedAt,
    decidedAt: r.decidedAt,
    decidedNote: r.decidedNote,
    pipelineClientId: r.pipelineClientId,
    promotedAt: r.promotedAt,
  };
}

export async function listOpportunities(
  view: OpportunityView = 'open',
  now = new Date(),
): Promise<OpportunityListItem[]> {
  const rows = await db
    .select()
    .from(opportunities)
    .where(isNull(opportunities.archivedAt))
    .orderBy(desc(opportunities.lastTouchedAt));

  const mapped = rows.map((r) => ({ db: r, row: toRow(r) }));
  const kept = mapped.filter(({ row }) => inView(row, view, now));

  // Ranking is the module's opinion about what he should look at first, and it
  // is not the same as the order the database returns.
  const ranked = rank(kept.map(({ row }) => row), now);
  const byId = new Map(mapped.map(({ db: d, row }) => [row.id, d]));

  return ranked.map((row) => ({
    ...row,
    detectReasons: byId.get(row.id)?.detectReasons ?? [],
    state: classify(row, now),
  }));
}

export interface OpportunityCounts {
  open: number;
  cold: number;
  suggested: number;
  parked: number;
  decided: number;
  /** What the open ones add up to, for the ones he has sized. */
  openValueCents: number;
}

/**
 * The contracts pointing at these opportunities.
 *
 * Linking happens on the contract — it is where he is standing when he
 * notices the two belong together — and until now it showed nowhere else, so
 * from the opportunity's side the link he had just made was invisible. Read
 * for the whole list at once.
 */
export async function contractsForOpportunities(
  ids: string[],
): Promise<Map<string, { id: string; counterparty: string; status: string; waitingOn: string }[]>> {
  const out = new Map<string, { id: string; counterparty: string; status: string; waitingOn: string }[]>();
  if (ids.length === 0) return out;

  const rows = await db
    .select({
      id: contracts.id,
      opportunityId: contracts.opportunityId,
      counterparty: contracts.counterpartyName,
      status: contracts.status,
      waitingOnOverride: contracts.waitingOnOverride,
    })
    .from(contracts)
    .where(and(inArray(contracts.opportunityId, ids), isNull(contracts.archivedAt)));

  for (const row of rows) {
    if (!row.opportunityId) continue;
    const held = out.get(row.opportunityId) ?? [];
    held.push({
      id: row.id,
      counterparty: row.counterparty,
      status: row.status,
      waitingOn: row.waitingOnOverride ?? WAITING_ON[row.status as ContractStatus] ?? 'nobody',
    });
    out.set(row.opportunityId, held);
  }
  return out;
}

/**
 * One opportunity, whole — what the card needs wherever it is opened.
 *
 * Classified here rather than by the caller, so an opportunity opened from the
 * home screen shows the same "gone cold" state as the same row on its own
 * page. Two places deciding that separately is two places to get it wrong.
 */
export async function getOpportunity(
  id: string,
  now = new Date(),
): Promise<OpportunityListItem | null> {
  const [row] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  if (!row) return null;

  const mapped = toRow(row);
  return { ...mapped, state: classify(mapped, now), detectReasons: [] };
}

export async function opportunityCounts(now = new Date()): Promise<OpportunityCounts> {
  const rows = await db
    .select()
    .from(opportunities)
    .where(isNull(opportunities.archivedAt));

  const mapped = rows.map(toRow);
  const counts: OpportunityCounts = {
    open: 0, cold: 0, suggested: 0, parked: 0, decided: 0, openValueCents: 0,
  };

  for (const row of mapped) {
    const state = classify(row, now);
    if (row.status === 'suggested') counts.suggested += 1;
    if (row.status === 'new' || row.status === 'exploring') {
      counts.open += 1;
      counts.openValueCents += row.valueCents ?? 0;
    }
    if (row.status === 'parked') counts.parked += 1;
    if (row.status === 'won' || row.status === 'lost') counts.decided += 1;
    if (state.cold || state.dueToRevisit) counts.cold += 1;
  }

  return counts;
}

/** The few that belong on the home page: cold or due, worst first. */
export async function opportunitiesNeedingAttention(limit = 4, now = new Date()) {
  const rows = await listOpportunities('cold', now);
  return rows.slice(0, limit);
}

export async function createOpportunity(
  input: OpportunityInput,
  createdBy: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const [created] = await db
      .insert(opportunities)
      .values({
        title: input.title,
        kind: input.kind,
        status: input.status,
        note: input.note ?? null,
        counterparty: input.counterparty ?? null,
        valueCents: input.valueCents ?? null,
        nextStep: input.nextStep ?? null,
        nextStepDate: input.nextStepDate ?? null,
        revisitOn: input.revisitOn ?? null,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        sourceExcerpt: input.sourceExcerpt ?? null,
        createdBy,
      })
      .returning({ id: opportunities.id });

    if (!created) return { ok: false, error: 'Could not save it' };
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save it' };
  }
}

export async function updateOpportunity(
  id: string,
  input: OpportunityInput,
  actor = 'unknown',
): Promise<{ ok: boolean; error?: string }> {
  try {
    // The row as it stands is what undo puts back, so it is read before the
    // write rather than reconstructed from the form afterwards.
    const [before] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    if (!before) return { ok: false, error: 'No opportunity with that id' };

    await db
      .update(opportunities)
      .set({
        title: input.title,
        kind: input.kind,
        status: input.status,
        note: input.note ?? null,
        counterparty: input.counterparty ?? null,
        valueCents: input.valueCents ?? null,
        nextStep: input.nextStep ?? null,
        nextStepDate: input.nextStepDate ?? null,
        revisitOn: input.revisitOn ?? null,
        lastTouchedAt: new Date(),
      })
      .where(eq(opportunities.id, id));

    await writeAudit({
      actor,
      action: 'opportunity.update',
      entityType: 'opportunity',
      entityId: id,
      before: restorableSnapshot('opportunity', before),
      after: restorableSnapshot('opportunity', input as unknown as Record<string, unknown>),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save it' };
  }
}

/**
 * Moving one along, which is the action he takes most.
 *
 * Deciding it — taken or missed — stamps `decidedAt`. Missed is recorded
 * rather than deleted: a list of what he passed on is the only way to find out
 * later whether he passes on the right things.
 */
export async function setOpportunityStatus(
  id: string,
  status: OpportunityStatus,
  note?: string | null,
  actor = 'unknown',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const [before] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    if (!before) return { ok: false, error: 'No opportunity with that id' };

    const decided = status === 'won' || status === 'lost';
    await db
      .update(opportunities)
      .set({
        status,
        lastTouchedAt: new Date(),
        decidedAt: decided ? new Date() : null,
        decidedNote: decided ? (note ?? null) : null,
      })
      .where(eq(opportunities.id, id));

    await writeAudit({
      actor,
      action: 'opportunity.status',
      entityType: 'opportunity',
      entityId: id,
      before: { status: before.status, decidedNote: before.decidedNote },
      after: { status, decidedNote: decided ? (note ?? null) : null },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update it' };
  }
}

export async function archiveOpportunity(
  id: string,
  actor = 'unknown',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const [before] = await db
      .select({ archivedAt: opportunities.archivedAt })
      .from(opportunities)
      .where(eq(opportunities.id, id))
      .limit(1);

    await db
      .update(opportunities)
      .set({ archivedAt: new Date() })
      .where(eq(opportunities.id, id));

    await writeAudit({
      actor,
      action: 'opportunity.archive',
      entityType: 'opportunity',
      entityId: id,
      before: { archivedAt: before?.archivedAt ?? null },
      after: { archivedAt: new Date() },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not archive it' };
  }
}

/**
 * Capture a mail thread as an opportunity.
 *
 * The thread is already mirrored, so this needs nothing from Gmail — it reads
 * the row the mail sync wrote. `sourceRef` is the thread id and is unique, so
 * capturing the same conversation twice updates rather than duplicates.
 */
export async function captureMailThread(
  threadId: string,
  createdBy: string,
  overrides: Partial<OpportunityInput> = {},
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [thread] = await db
    .select()
    .from(mailThreads)
    .where(eq(mailThreads.threadId, threadId))
    .limit(1);

  if (!thread) return { ok: false, error: 'That conversation is not in the mirror' };

  const detection = detectOpportunity({
    subject: thread.subject,
    snippet: thread.snippet,
    counterpartEmail: thread.counterpartEmail,
    counterpartName: thread.counterpartName,
    knownContact: thread.knownContact,
    knownCompany: thread.knownCompany,
    lastFromMe: thread.lastFromMe,
  });

  try {
    const [created] = await db
      .insert(opportunities)
      .values({
        title: overrides.title ?? thread.subject ?? 'Untitled opportunity',
        kind: overrides.kind ?? detection.kind,
        // Captured by hand means he already decided it is one.
        status: overrides.status ?? 'new',
        note: overrides.note ?? null,
        counterparty:
          overrides.counterparty ??
          thread.knownCompany ??
          thread.counterpartName ??
          thread.counterpartEmail,
        valueCents: overrides.valueCents ?? null,
        source: 'mail',
        sourceRef: thread.threadId,
        sourceUrl: `https://mail.google.com/mail/u/0/#all/${thread.threadId}`,
        sourceExcerpt: thread.snippet,
        sourceAt: thread.lastMessageAt,
        detectReasons: detection.reasons,
        detectScore: detection.score,
        createdBy,
      })
      .onConflictDoUpdate({
        target: [opportunities.source, opportunities.sourceRef],
        set: { status: 'new', archivedAt: null, lastTouchedAt: new Date() },
      })
      .returning({ id: opportunities.id });

    if (!created) return { ok: false, error: 'Could not capture it' };
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not capture it' };
  }
}

/**
 * Sweep the mirrored mail for things worth proposing.
 *
 * Files them as `suggested`, never as his. The unique index on
 * (source, source_ref) means a thread he already declined is not proposed
 * again — the insert collides and does nothing.
 */
export async function suggestFromMail(
  lookbackDays = 30,
  limit = 200,
): Promise<{ scanned: number; proposed: number }> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const threads = await db
    .select()
    .from(mailThreads)
    .where(
      and(
        eq(mailThreads.lastFromMe, false),
        sql`${mailThreads.lastMessageAt} >= ${since}`,
      ),
    )
    .orderBy(desc(mailThreads.lastMessageAt))
    .limit(limit);

  let proposed = 0;

  for (const thread of threads) {
    const detection = detectOpportunity({
      subject: thread.subject,
      snippet: thread.snippet,
      counterpartEmail: thread.counterpartEmail,
      counterpartName: thread.counterpartName,
      knownContact: thread.knownContact,
      knownCompany: thread.knownCompany,
      lastFromMe: thread.lastFromMe,
    });
    if (!detection.isOpportunity) continue;

    const inserted = await db
      .insert(opportunities)
      .values({
        title: thread.subject ?? 'Untitled opportunity',
        kind: detection.kind,
        status: 'suggested',
        counterparty:
          thread.knownCompany ?? thread.counterpartName ?? thread.counterpartEmail,
        source: 'mail',
        sourceRef: thread.threadId,
        sourceUrl: `https://mail.google.com/mail/u/0/#all/${thread.threadId}`,
        sourceExcerpt: thread.snippet,
        sourceAt: thread.lastMessageAt,
        detectReasons: detection.reasons,
        detectScore: detection.score,
        createdBy: 'mail-detector',
      })
      .onConflictDoNothing({
        target: [opportunities.source, opportunities.sourceRef],
      })
      .returning({ id: opportunities.id });

    if (inserted.length > 0) proposed += 1;
  }

  return { scanned: threads.length, proposed };
}

/**
 * An opportunity that has matured into a real deal.
 *
 * This is the crossing between the two modules: an opportunity is something
 * worth doing that nobody has committed to, a pipeline client is a deal being
 * worked with a stage and a next step. Promotion moves it across and links
 * both ways, so the opportunity does not look abandoned and the deal does not
 * look like it appeared from nowhere.
 *
 * The opportunity is marked `won` — it did what it was for. It stays in the
 * decided view with a link to the deal rather than disappearing, because the
 * question "which of the things I noticed actually turned into business" is
 * the whole reason to keep the list.
 */
export async function promoteToPipeline(
  id: string,
  actor: string,
  overrides: { stage?: string; clientType?: string; nextStep?: string; nextStepDate?: string } = {},
): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);

  if (!row) return { ok: false, error: 'No such opportunity' };
  if (row.pipelineClientId) {
    return { ok: false, error: 'This is already in the pipeline' };
  }

  // The pipeline is a list of counterparties, so it needs a name for one. The
  // opportunity's title is a note to himself ("talk to Markito about their
  // second site") and makes a poor client name, so the counterparty wins where
  // there is one.
  const name = (row.counterparty ?? row.title).trim().slice(0, 200);
  if (name === '') return { ok: false, error: 'Give it a counterparty first — the pipeline needs a name' };

  try {
    const [created] = await db
      .insert(pipelineClients)
      .values({
        name,
        clientType: overrides.clientType ?? KIND_TO_CLIENT_TYPE[row.kind as keyof typeof KIND_TO_CLIENT_TYPE] ?? 'other',
        // Something he has decided is a real deal is past a cold lead, but
        // calling it qualified is his judgement, not ours.
        stage: overrides.stage ?? 'lead',
        temperature: 'warm',
        valueCents: row.valueCents,
        nextStep: overrides.nextStep ?? row.nextStep,
        nextStepDate: overrides.nextStepDate ?? row.nextStepDate,
        source: `opportunity:${row.source}`,
        notes: [row.note, row.sourceExcerpt ? `From ${row.source}: ${row.sourceExcerpt}` : null]
          .filter(Boolean)
          .join('\n\n') || null,
        opportunityId: row.id,
      })
      .returning({ id: pipelineClients.id });

    if (!created) return { ok: false, error: 'Could not create the deal' };

    await db
      .update(opportunities)
      .set({
        pipelineClientId: created.id,
        promotedAt: new Date(),
        status: 'won',
        decidedAt: new Date(),
        decidedNote: `Promoted to the pipeline by ${actor}`,
        lastTouchedAt: new Date(),
      })
      .where(eq(opportunities.id, id));

    return { ok: true, clientId: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not promote it' };
  }
}

/**
 * Whether the Gmail capture label is actually doing anything.
 *
 * A label that exists but has been applied to nothing looks identical, from
 * the cockpit, to a label that works — both produce no opportunities. That is
 * exactly what happened the first time: the label was created and never
 * applied, and the screen had no way to say so. Counting the mirrored threads
 * that carry it turns a silent nothing into a visible nothing.
 */
export async function captureLabelHealth(labels: string[]): Promise<{
  label: string;
  threadsCarrying: number;
  captured: number;
}[]> {
  const out = [];
  for (const label of labels) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(mailThreads)
      .where(sql`${mailThreads.labels} @> array[${label}]::text[]`);

    const [caught] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(eq(opportunities.createdBy, 'gmail-label'));

    out.push({
      label,
      threadsCarrying: row?.n ?? 0,
      captured: caught?.n ?? 0,
    });
  }
  return out;
}

/** Accepting a suggestion makes it his; declining archives it for good. */
export async function decideSuggestion(
  id: string,
  accept: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await db
      .update(opportunities)
      .set(
        accept
          ? { status: 'new', lastTouchedAt: new Date() }
          : { archivedAt: new Date(), lastTouchedAt: new Date() },
      )
      .where(and(eq(opportunities.id, id), eq(opportunities.status, 'suggested')));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update it' };
  }
}

export { LIVE_STATUSES };
