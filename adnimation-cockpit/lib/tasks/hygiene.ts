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
      title: `Unowned task: ${task.title}`,
      whatHappened: `Created more than ${OWNERLESS_GRACE_HOURS} hours ago and still has no owner.`,
      recommendedAction: 'Assign an owner or close the task.',
    });
  }

  if (!task.dueDate && (task.priority === 'P0' || task.priority === 'P1')) {
    out.push({
      code: 'NO_DUE_DATE_HIGH_PRIORITY',
      taskId: task.id,
      severity: 'warning',
      title: `${task.priority} with no due date: ${task.title}`,
      whatHappened: `A ${task.priority} task with no due date.`,
      recommendedAction: 'Set a due date or lower the priority.',
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
      title: `P0 stalled ${daysSinceMovement} days: ${task.title}`,
      whatHappened: `A P0 task has not moved in ${daysSinceMovement} days.`,
      recommendedAction: 'Handle today, delegate it, or explicitly lower the priority.',
    });
  }

  if (task.snoozeCount >= ZOMBIE_SNOOZE_THRESHOLD) {
    out.push({
      code: 'ZOMBIE',
      taskId: task.id,
      severity: 'watch',
      title: `Zombie — snoozed ${task.snoozeCount} times: ${task.title}`,
      whatHappened: `Snoozed ${task.snoozeCount} times.`,
      recommendedAction: 'Raise at the management meeting: close it or raise its priority.',
    });
  }

  const ageDays = Math.floor((now.getTime() - task.createdAt.getTime()) / (24 * 60 * 60 * 1000));
  if (task.ownerIsCeo && ageDays > CEO_OWNERSHIP_HANDOVER_DAYS) {
    out.push({
      code: 'CEO_HOLDING_TOO_LONG',
      taskId: task.id,
      severity: 'info',
      title: `Held by the CEO for ${ageDays} days: ${task.title}`,
      whatHappened: `The CEO has owned this task for ${ageDays} days.`,
      recommendedAction: 'Consider handing ownership over.',
    });
  }

  return out;
}

/** Days a task is past due — re-exported so callers need one import. */
export { daysOverdue };
export { DELEGATION_STALE_DAYS };
