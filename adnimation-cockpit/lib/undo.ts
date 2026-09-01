import { desc, eq, sql } from 'drizzle-orm';
import {
  auditLog, contracts, crmContacts, db, opportunities, pipelineClients, tasks,
} from '@/lib/db';
import { writeAudit } from '@/lib/audit';

/**
 * Putting the last thing back.
 *
 * Every mutation that matters already writes an audit row with the values as
 * they stood before it (CLAUDE.md §10). That is an undo log by another name,
 * so undo reads it rather than every action carrying its own inverse — one
 * mechanism, and no action that quietly forgets to be undoable.
 *
 * Three rules keep it honest:
 *
 *  · Only what the audit row actually holds. A `before` that recorded two
 *    fields restores two fields; it never guesses at the rest.
 *  · Only the most recent change to that row. Undoing a change with newer
 *    ones stacked on top would silently revert those too, which is not what
 *    the word means to the person clicking it.
 *  · The undo is itself audited. "It went back" has to be as traceable as
 *    what it went back from — and it means undo can be undone.
 *
 * Ten seconds is the window the screen offers. It is not enforced here: a
 * request that arrives late is still a legitimate correction, and refusing it
 * on a stopwatch would only mean re-doing the change by hand.
 */

/** The columns undo may write, per entity. Anything else is ignored. */
const RESTORABLE: Record<string, string[]> = {
  task: [
    'title', 'description', 'status', 'priority', 'dueDate', 'startDate', 'deptId',
    'ownerPersonId', 'tags', 'moneyImpactCents', 'archivedAt', 'snoozeUntil', 'recurrenceRule',
  ],
  opportunity: [
    'title', 'kind', 'status', 'note', 'valueCents', 'counterparty', 'nextStep', 'nextStepDate',
    'revisitOn', 'archivedAt', 'decidedNote',
  ],
  contract: [
    'counterpartyName', 'category', 'categoryConfirmed', 'docType', 'status', 'notes',
    'opportunityId', 'pipelineClientId', 'waitingOnOverride', 'archivedAt',
  ],
  pipeline_client: [
    'name', 'domain', 'clientType', 'stage', 'temperature', 'ownerPersonId', 'nextStep',
    'nextStepDate', 'valueCents', 'probability', 'source', 'notes', 'archivedAt',
  ],
  crm_contact: [
    'firstName', 'lastName', 'email', 'phone', 'jobTitle', 'companyName', 'companyId',
    'lifecycleStage', 'notes', 'archivedAt',
  ],
};

const TABLES = {
  task: tasks,
  opportunity: opportunities,
  contract: contracts,
  pipeline_client: pipelineClients,
  crm_contact: crmContacts,
} as const;

type Undoable = keyof typeof TABLES;

const idColumn = (entity: Undoable) =>
  entity === 'crm_contact' ? crmContacts.hubspotId : TABLES[entity].id;

export interface UndoResult {
  ok: boolean;
  error?: string;
  /** What was put back, for the message on screen. */
  restored?: string[];
}

/** Can this audit row be undone at all? Used to decide whether to offer it. */
export function isUndoable(entityType: string, before: unknown): boolean {
  if (!(entityType in RESTORABLE)) return false;
  if (before === null || typeof before !== 'object') return false;
  return Object.keys(before as Record<string, unknown>).some((key) =>
    RESTORABLE[entityType]!.includes(key),
  );
}

export async function undoAudit(auditId: number, actor: string): Promise<UndoResult> {
  const [entry] = await db.select().from(auditLog).where(eq(auditLog.id, auditId)).limit(1);
  if (!entry) return { ok: false, error: 'There is nothing to undo' };
  if (!entry.entityId) return { ok: false, error: 'That change has nothing to put back' };

  const entity = entry.entityType as Undoable;
  if (!isUndoable(entry.entityType, entry.before)) {
    return { ok: false, error: 'That change cannot be undone automatically' };
  }

  /*
   * Only the most recent change to this row.
   *
   * Undoing an older one would revert everything done since without saying so,
   * which is not what the word means to the person clicking it.
   */
  const [newest] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      sql`${auditLog.entityType} = ${entry.entityType} and ${auditLog.entityId} = ${entry.entityId}
          and ${auditLog.action} not like '%.undo'`,
    )
    .orderBy(desc(auditLog.id))
    .limit(1);

  if (newest && newest.id !== entry.id) {
    return { ok: false, error: 'Something else has changed since — undo it there instead' };
  }

  const before = entry.before as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of RESTORABLE[entry.entityType]!) {
    if (!(key in before)) continue;
    const value = before[key];
    // Dates cross the audit log as strings and have to go back as dates.
    patch[key] =
      (key.endsWith('At') || key === 'snoozeUntil') && typeof value === 'string'
        ? new Date(value)
        : value;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'That change cannot be undone automatically' };
  }

  await db
    .update(TABLES[entity])
    .set(patch as never)
    .where(eq(idColumn(entity), entry.entityId));

  await writeAudit({
    actor,
    action: `${entry.action}.undo`,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.after,
    after: patch,
  });

  return { ok: true, restored: Object.keys(patch) };
}

/** The id of the last change to a row, which is what undo is offered against. */
export async function lastChangeId(
  entityType: string,
  entityId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(sql`${auditLog.entityType} = ${entityType} and ${auditLog.entityId} = ${entityId}`)
    .orderBy(desc(auditLog.id))
    .limit(1);
  return row?.id ?? null;
}
