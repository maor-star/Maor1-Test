import { db, auditLog } from '@/lib/db';

/**
 * CLAUDE.md §10 — every mutation touching contracts, signatures or agent
 * config writes an audit row. Delegations write one too: they are the system's
 * outward-facing side effects.
 *
 * `audit_log` is append-only at the database level (schema.sql triggers), so
 * this can only ever insert.
 */
export interface AuditEntry {
  /** User email, or `agent:<name>` when an agent acted. */
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
  });
}
