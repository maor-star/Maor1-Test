/**
 * Pure staleness predicate, kept free of database imports so both the UI and
 * the unit tests can use it without a connection.
 *
 * CLAUDE.md §10 — a sync failing for over two hours raises INTEGRATION_FAILURE.
 */
export const INTEGRATION_STALE_HOURS = 2;

export function isStale(lastSuccessAt: Date | null, now = new Date()): boolean {
  if (!lastSuccessAt) return true;
  return now.getTime() - lastSuccessAt.getTime() > INTEGRATION_STALE_HOURS * 60 * 60 * 1000;
}
