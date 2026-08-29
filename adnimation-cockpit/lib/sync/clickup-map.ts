import { CLICKUP_TO_PRIORITY } from '@/lib/integrations/clickup';
import type { ClickUpTask } from '@/lib/integrations/types';
import type { TaskPriority } from '@/lib/tasks/types';

/**
 * Pure ClickUp → mirror-row mapping (spec 6.1.2). Kept free of database
 * imports so it is unit-testable on its own.
 */

/** ClickUp statuses vary per space; map the common ones and pass the rest through. */
export function mapClickUpStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (['complete', 'closed', 'done'].includes(s)) return 'done';
  if (['in progress', 'in-progress', 'doing', 'active'].includes(s)) return 'in_progress';
  if (['blocked', 'on hold', 'waiting'].includes(s)) return 'blocked';
  if (['open', 'to do', 'todo', 'backlog', 'new'].includes(s)) return 'open';
  return s.replace(/\s+/g, '_');
}

const msToDate = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString().slice(0, 10);

export interface MirrorRow {
  clickupId: string;
  clickupUrl: string;
  title: string;
  description: string | null;
  status: string;
  priority: TaskPriority;
  dueDate: string | null;
  startDate: string | null;
  tags: string[];
  ownerEmail: string | null;
}

export function toMirrorRow(task: ClickUpTask): MirrorRow {
  return {
    clickupId: task.id,
    clickupUrl: task.url,
    title: task.name,
    description: task.description,
    status: mapClickUpStatus(task.status),
    // ClickUp leaves priority unset far more often than it sets it; treat that as P2.
    priority: task.priority ? CLICKUP_TO_PRIORITY[task.priority] : 'P2',
    dueDate: msToDate(task.dueDateMs),
    startDate: msToDate(task.startDateMs),
    tags: task.tags,
    ownerEmail: task.assigneeEmails[0] ?? null,
  };
}
