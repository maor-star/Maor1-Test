import { heatScore } from '@/lib/scoring/heat-score';
import type { TaskPriority } from './types';

/**
 * Recomputes the stored heat score from a task's own fields (spec 6.2).
 * Pure — no database import — so both the mirror and the editor can call it
 * and unit tests can exercise it directly.
 */
export function computeHeat(
  row: {
    priority: TaskPriority;
    dueDate: string | null;
    moneyImpactCents: number | null;
    blockedPeople: string[];
    ownerPersonId: string | null;
  },
  now = new Date(),
): number {
  return heatScore({
    priority: row.priority,
    dueDate: row.dueDate,
    moneyImpactCents: row.moneyImpactCents,
    blockedPeopleCount: row.blockedPeople.length,
    // Nobody else is named on it, so it only moves if the CEO moves it.
    isSoleOwner: row.ownerPersonId === null,
    now,
  });
}
