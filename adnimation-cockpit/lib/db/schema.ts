import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey,
  moneyCents, text, timestamptz, uuid,
} from './pg';
import {
  alertType, delegationStatus, deptCode, severity, taskLayer, taskPriority, taskSource,
} from './enums';

// Drizzle mirror of db/schema.sql. Milestone 1 defines the tables it actually
// reads or writes; later milestones add theirs as they ship (CLAUDE.md §8).

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull(), // 'owner' | 'operator' — CHECK lives in SQL
  slackId: text('slack_id'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: deptCode('code').notNull().unique(),
  nameHe: text('name_he').notNull(),
  ownerEmail: text('owner_email'),
  monthlyTargetCents: moneyCents('monthly_target_cents'),
  active: boolean('active').notNull().default(true),
});

export const people = pgTable('people', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  slackId: text('slack_id'),
  clickupId: text('clickup_id'),
  role: text('role'),
  managerId: uuid('manager_id'),
  deptId: uuid('dept_id').references(() => departments.id),
  isExternal: boolean('is_external').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    layer: taskLayer('layer').notNull(),
    clickupId: text('clickup_id').unique(),
    clickupUrl: text('clickup_url'),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    description: text('description'),
    deptId: uuid('dept_id').references(() => departments.id),
    ownerPersonId: uuid('owner_person_id').references(() => people.id),
    priority: taskPriority('priority').notNull().default('P2'),
    status: text('status').notNull().default('open'),
    dueDate: date('due_date'),
    startDate: date('start_date'),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    heatScore: integer('heat_score').notNull().default(0),
    blockedPeople: uuid('blocked_people').array().notNull().default(sql`'{}'`),
    snoozeUntil: timestamptz('snooze_until'),
    snoozeCount: integer('snooze_count').notNull().default(0),
    moneyImpactCents: moneyCents('money_impact_cents'),
    source: taskSource('source').notNull().default('manual'),
    sourceRef: text('source_ref'),
    recurrenceRule: text('recurrence_rule'),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    lastSyncedAt: timestamptz('last_synced_at'),
  },
  (t) => [
    index('idx_tasks_layer_status').on(t.layer, t.status),
    index('idx_tasks_due').on(t.dueDate),
    index('idx_tasks_heat').on(t.heatScore),
  ],
);

export const taskComments = pgTable('task_comments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  author: text('author').notNull(),
  body: text('body').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnId: uuid('depends_on_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('blocks'),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnId] })],
);

export const delegations = pgTable(
  'delegations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sourceEntityType: text('source_entity_type').notNull(),
    sourceEntityId: uuid('source_entity_id').notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    delegatedTo: uuid('delegated_to').notNull().references(() => people.id),
    clickupTaskId: text('clickup_task_id'),
    slackMessageUrl: text('slack_message_url'),
    note: text('note'),
    dueDate: date('due_date'),
    status: delegationStatus('status').notNull().default('sent'),
    delegatedAt: timestamptz('delegated_at').notNull().defaultNow(),
    lastMovementAt: timestamptz('last_movement_at').notNull().defaultNow(),
  },
  (t) => [index('idx_deleg_open').on(t.status, t.lastMovementAt)],
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    type: alertType('type').notNull(),
    severity: severity('severity').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    groupKey: text('group_key'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    whatHappened: text('what_happened').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    moneyImpactCents: moneyCents('money_impact_cents'),
    ownerPersonId: uuid('owner_person_id').references(() => people.id),
    recommendedAction: text('recommended_action').notNull(),
    createdBy: text('created_by').notNull().default('system'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    ackedBy: uuid('acked_by').references(() => users.id),
    ackedAt: timestamptz('acked_at'),
    snoozeUntil: timestamptz('snooze_until'),
    spawnedTaskId: uuid('spawned_task_id').references(() => tasks.id),
  },
  (t) => [index('idx_alerts_group').on(t.groupKey, t.createdAt)],
);

export const systemFlags = pgTable('system_flags', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const integrationHealth = pgTable('integration_health', {
  system: text('system').primaryKey(),
  lastSuccessAt: timestamptz('last_success_at'),
  lastAttemptAt: timestamptz('last_attempt_at'),
  consecutiveErrors: integer('consecutive_errors').notNull().default(0),
  lastError: text('last_error'),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_audit').on(t.entityType, t.entityId, t.createdAt)],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskComment = typeof taskComments.$inferSelect;
export type Delegation = typeof delegations.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type AppUser = typeof users.$inferSelect;
