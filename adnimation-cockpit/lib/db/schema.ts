import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey,
  moneyCents, smallint, text, timestamptz, uuid,
} from './pg';
import {
  alertType, contractCategory, contractStatus, delegationStatus, deptCode, partnerType,
  renewalType, severity, taskLayer, taskPriority, taskSource,
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

export const partners = pgTable('partners', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  domain: text('domain'),
  type: partnerType('type').notNull(),
  ownerPersonId: uuid('owner_person_id').references(() => people.id),
  riskScore: smallint('risk_score').notNull().default(0),
  riskReason: text('risk_reason'),
  status: text('status').notNull().default('active'),
  wentLiveAt: date('went_live_at'),
  lastInteractionAt: timestamptz('last_interaction_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    partnerId: uuid('partner_id').references(() => partners.id),
    counterpartyName: text('counterparty_name').notNull(),
    category: contractCategory('category').notNull(),
    /** False while the category came from a rule and no person has confirmed it. */
    categoryConfirmed: boolean('category_confirmed').notNull().default(false),
    docType: text('doc_type').notNull(),
    deptId: uuid('dept_id').references(() => departments.id),
    status: contractStatus('status').notNull().default('draft'),
    statusChangedAt: timestamptz('status_changed_at').notNull().defaultNow(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    renewal: renewalType('renewal'),
    noticePeriodDays: integer('notice_period_days'),
    valueCents: moneyCents('value_cents'),
    commercialTerms: text('commercial_terms'),
    paymentTerms: text('payment_terms'),
    driveFolderId: text('drive_folder_id'),
    legalOwner: text('legal_owner'),
    bizOwnerPersonId: uuid('biz_owner_person_id').references(() => people.id),
    nextAlertAt: date('next_alert_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_contracts_status').on(t.status, t.statusChangedAt)],
);

export const contractVersions = pgTable('contract_versions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contractId: uuid('contract_id')
    .notNull()
    .references(() => contracts.id, { onDelete: 'cascade' }),
  versionNo: integer('version_no').notNull(),
  driveFileId: text('drive_file_id'),
  fileName: text('file_name').notNull(),
  fileHash: text('file_hash').notNull(),
  source: text('source').notNull(),
  receivedAt: timestamptz('received_at').notNull().defaultNow(),
  isApprovedBaseline: boolean('is_approved_baseline').notNull().default(false),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskComment = typeof taskComments.$inferSelect;
export type Delegation = typeof delegations.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type AppUser = typeof users.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type Partner = typeof partners.$inferSelect;
