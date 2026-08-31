import { z } from 'zod';

export const TASK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Spec 6.2 — priority names and SLAs, shown next to the selector. */
export const PRIORITY_META: Record<TaskPriority, { label: string; sla: string }> = {
  P0: { label: 'BURNING', sla: 'Respond within 4 hours' },
  P1: { label: 'CRITICAL', sla: 'Close within 3 business days' },
  P2: { label: 'IMPORTANT', sla: 'Close within 14 days' },
  P3: { label: 'TRACKING', sla: 'No SLA' },
};

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'delegated', 'done'] as const;

/**
 * What the list is ordered by.
 *
 * Heat is the default and stays the default: it is the whole point of the heat
 * score that the top of the list is what to do next. But "what came in today"
 * and "what has been sitting here longest" are different questions, and the
 * second one is how a task gets noticed before it is embarrassing.
 */
export const TASK_SORTS = ['heat', 'newest', 'oldest', 'due'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export const SORT_LABEL: Record<TaskSort, string> = {
  heat: 'Hottest first',
  newest: 'Newest first',
  oldest: 'Oldest first',
  due: 'Due soonest',
};
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'OPEN',
  in_progress: 'IN PROGRESS',
  blocked: 'BLOCKED',
  delegated: 'DELEGATED',
  done: 'DONE',
};

export const TASK_SOURCES = [
  'manual', 'alert', 'slack', 'email', 'meeting', 'contract', 'anomaly', 'agent',
] as const;

/**
 * Departments, as the company's ClickUp lists define them (see
 * lib/sync/departments.ts). APP, DISP, CTV and ASIA are the four the spec
 * sketched that the company has no list for; they are kept so existing rows
 * stay valid but are marked inactive and hidden from pickers.
 */
export const DEPT_CODES = [
  'CORE', 'VID', 'TRADING', 'SEAT', 'BID', 'GENERAL', 'HR', 'DEMAND', 'MKT', 'FIN', 'DEV',
  'APP', 'DISP', 'CTV', 'ASIA',
] as const;
export type DeptCode = (typeof DEPT_CODES)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const emptyToNull = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === '' ? null : v), inner);

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: emptyToNull(z.string().trim().max(20_000).nullable()).optional(),
  priority: z.enum(TASK_PRIORITIES).default('P2'),
  status: z.enum(TASK_STATUSES).default('open'),
  dueDate: emptyToNull(isoDate.nullable()).optional(),
  startDate: emptyToNull(isoDate.nullable()).optional(),
  deptId: emptyToNull(z.string().uuid().nullable()).optional(),
  ownerPersonId: emptyToNull(z.string().uuid().nullable()).optional(),
  parentId: emptyToNull(z.string().uuid().nullable()).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  moneyImpactCents: z.number().int().nonnegative().nullable().optional(),
  blockedPeople: z.array(z.string().uuid()).max(50).default([]),
  recurrenceRule: emptyToNull(z.string().trim().max(300).nullable()).optional(),
  source: z.enum(TASK_SOURCES).default('manual'),
  sourceRef: emptyToNull(z.string().trim().max(500).nullable()).optional(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskPatchSchema = taskInputSchema.partial().extend({
  id: z.string().uuid(),
});
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const commentInputSchema = z.object({
  taskId: z.string().uuid(),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(10_000),
});

/** Spec 6.3 — a task snoozed three times is a Zombie. */
export const ZOMBIE_SNOOZE_THRESHOLD = 3;
/** Spec 6.1.3 — a delegation with no movement for this long is stale. */
export const DELEGATION_STALE_DAYS = 3;
/** Spec 6.3 — the CEO owning a task this long suggests handing it over. */
export const CEO_OWNERSHIP_HANDOVER_DAYS = 21;
