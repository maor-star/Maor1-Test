import { differenceInHours } from 'date-fns';
import {
  CEO_OWNERSHIP_HANDOVER_DAYS, DELEGATION_STALE_DAYS, ZOMBIE_SNOOZE_THRESHOLD,
  type TaskPriority,
} from './types';
import { daysOverdue } from '@/lib/scoring/heat-score';

/**
 * Spec 6.3 — the hygiene rules, as pure functions over a task snapshot so they
 * can be unit-tested without a database. The Inngest job (inngest/functions/
 * task-hygiene.ts) applies them and raises one alert per violation.
 */

export type HygieneCode =
  | 'NO_OWNER'
  | 'NO_DUE_DATE_HIGH_PRIORITY'
  | 'P0_NOT_MOVING'
  | 'ZOMBIE'
  | 'CEO_HOLDING_TOO_LONG';

export interface HygieneSnapshot {
  id: string;
  title: string;
  priority: TaskPriority;
  status: string;
  dueDate: string | null;
  ownerPersonId: string | null;
  ownerIsCeo: boolean;
  snoozeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HygieneViolation {
  code: HygieneCode;
  taskId: string;
  severity: 'info' | 'watch' | 'warning' | 'critical';
  title: string;
  whatHappened: string;
  recommendedAction: string;
}

/** Rule 1: a task with no owner for more than 24 hours. */
const OWNERLESS_GRACE_HOURS = 24;
/** Rule 3: a P0 that has not moved for three days escalates. */
const P0_STALL_DAYS = 3;

export function evaluateHygiene(task: HygieneSnapshot, now = new Date()): HygieneViolation[] {
  const out: HygieneViolation[] = [];
  if (task.status === 'done') return out;

  if (task.ownerPersonId === null && differenceInHours(now, task.createdAt) > OWNERLESS_GRACE_HOURS) {
    out.push({
      code: 'NO_OWNER',
      taskId: task.id,
      severity: 'warning',
      title: `משימה ללא בעלים: ${task.title}`,
      whatHappened: `המשימה נוצרה לפני יותר מ-${OWNERLESS_GRACE_HOURS} שעות ואין לה בעלים.`,
      recommendedAction: 'לשייך בעלים או לסגור את המשימה.',
    });
  }

  if (!task.dueDate && (task.priority === 'P0' || task.priority === 'P1')) {
    out.push({
      code: 'NO_DUE_DATE_HIGH_PRIORITY',
      taskId: task.id,
      severity: 'warning',
      title: `${task.priority} ללא תאריך יעד: ${task.title}`,
      whatHappened: `משימה בעדיפות ${task.priority} ללא תאריך יעד.`,
      recommendedAction: 'לקבוע תאריך יעד או להוריד עדיפות.',
    });
  }

  const daysSinceMovement = Math.floor(
    (now.getTime() - task.updatedAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (task.priority === 'P0' && daysSinceMovement >= P0_STALL_DAYS) {
    out.push({
      code: 'P0_NOT_MOVING',
      taskId: task.id,
      severity: 'critical',
      title: `P0 תקוע ${daysSinceMovement} ימים: ${task.title}`,
      whatHappened: `משימה בעדיפות P0 לא זזה ${daysSinceMovement} ימים.`,
      recommendedAction: 'לטפל היום, להאציל, או להוריד עדיפות במפורש.',
    });
  }

  if (task.snoozeCount >= ZOMBIE_SNOOZE_THRESHOLD) {
    out.push({
      code: 'ZOMBIE',
      taskId: task.id,
      severity: 'watch',
      title: `Zombie — נדחתה ${task.snoozeCount} פעמים: ${task.title}`,
      whatHappened: `המשימה נדחתה ${task.snoozeCount} פעמים.`,
      recommendedAction: 'להעלות לדיון בישיבת הנהלה: לסגור או להעלות עדיפות.',
    });
  }

  const ageDays = Math.floor((now.getTime() - task.createdAt.getTime()) / (24 * 60 * 60 * 1000));
  if (task.ownerIsCeo && ageDays > CEO_OWNERSHIP_HANDOVER_DAYS) {
    out.push({
      code: 'CEO_HOLDING_TOO_LONG',
      taskId: task.id,
      severity: 'info',
      title: `בבעלותי ${ageDays} ימים: ${task.title}`,
      whatHappened: `המנכ"ל הוא הבעלים של המשימה כבר ${ageDays} ימים.`,
      recommendedAction: 'לשקול להעביר בעלות.',
    });
  }

  return out;
}

/** Days a task is past due — re-exported so callers need one import. */
export { daysOverdue };
export { DELEGATION_STALE_DAYS };
