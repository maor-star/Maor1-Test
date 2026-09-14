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
 * Newest is the default: he opens the list after something has happened, and
 * what he is looking for is nearly always what just arrived. Heat — what to do
 * next — is one click away and the score is still on every row, and the daily
 * brief asks for heat by name, because that view is triage.
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

/**
 * What to call a status the cockpit did not invent.
 *
 * Most of the board is mirrored from ClickUp, and every ClickUp list defines
 * its own words: MAKE IT HAPPENED and STUCK are two of this company's, and
 * neither is in TASK_STATUSES. They still have to be readable, so an unknown
 * status is shown as itself rather than dropped.
 */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status as TaskStatus] ?? status.replace(/_/g, ' ').toUpperCase();
}

/**
 * The statuses a picker should offer.
 *
 * The five above plus whatever the loaded rows are actually in. Offering only
 * the five was a silent lie: a `<select>` whose value matches no option shows
 * the first one instead, so every task in a ClickUp-only status read as OPEN,
 * and touching the cell would have moved it there for real.
 */
export function statusOptionsFor(present: readonly string[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const status of [...TASK_STATUSES, ...present]) {
    const key = status.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ value: key, label: statusLabel(key) });
  }
  return out;
}

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

/**
 * A status is a word, not one of five.
 *
 * TASK_STATUSES is what the cockpit invents for a task he writes himself.
 * Nearly every task on the board is mirrored from ClickUp and carries that
 * list's own word — `make_it_happened` and `stuck` among this company's — so
 * an enum here rejected the statuses the board is already full of, and the
 * picker offering them would have failed on save.
 *
 * The shape is checked rather than the value: a status is short, and it is the
 * slug the mirror makes of a ClickUp word. Which words a given task may take
 * is ClickUp's to say, and it is asked — see remoteStatusFor.
 */
export const taskStatusSchema = z
  .string()
  .trim()
  .min(1, 'A task needs a status')
  .max(80)
  .default('open');

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: emptyToNull(z.string().trim().max(20_000).nullable()).optional(),
  priority: z.enum(TASK_PRIORITIES).default('P2'),
  status: taskStatusSchema,
  dueDate: emptyToNull(isoDate.nullable()).optional(),
  startDate: emptyToNull(isoDate.nullable()).optional(),
  deptId: emptyToNull(z.string().uuid().nullable()).optional(),
  ownerPersonId: emptyToNull(z.string().uuid().nullable()).optional(),
  parentId: emptyToNull(z.string().uuid().nullable()).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  moneyImpactCents: z.number().int().nonnegative().nullable().optional(),
  blockedPeople: z.array(z.string().uuid()).max(50).default([]),
  recurrenceRule: emptyToNull(z.string().trim().max(300).nullable()).optional(),
  /*
   * The next move and when it happens. Not required the way a deal's is —
   * a deal with no next step is a deal going quiet, while a task often is
   * its own next step.
   */
  nextStep: emptyToNull(z.string().trim().max(500).nullable()).optional(),
  nextStepDate: emptyToNull(isoDate.nullable()).optional(),
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

/**
 * A task snoozed this many times is not being deferred, it is being avoided.
 *
 * Lives here rather than beside the mutation that counts it, because the list
 * row that draws the badge is a client component and must not pull the
 * database in with it.
 */
export function isZombie(snoozeCount: number): boolean {
  return snoozeCount >= ZOMBIE_SNOOZE_THRESHOLD;
}
