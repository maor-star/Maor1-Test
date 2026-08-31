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
    // Null for a delegation started from the tracker itself rather than from
    // a task, alert or contract.
    sourceEntityId: uuid('source_entity_id'),
    taskId: uuid('task_id').references(() => tasks.id),
    delegatedTo: uuid('delegated_to').notNull().references(() => people.id),
    clickupTaskId: text('clickup_task_id'),
    slackMessageUrl: text('slack_message_url'),
    note: text('note'),
    dueDate: date('due_date'),
    status: delegationStatus('status').notNull().default('sent'),
    delegatedAt: timestamptz('delegated_at').notNull().defaultNow(),
    lastMovementAt: timestamptz('last_movement_at').notNull().defaultNow(),
    // Where the answer came back, when the cockpit found it, and enough of it
    // to know whether it is an answer or an "on it".
    replyChannel: text('reply_channel'),
    replyAt: timestamptz('reply_at'),
    replyAuthor: text('reply_author'),
    replyExcerpt: text('reply_excerpt'),
    replyUrl: text('reply_url'),
    repliesCheckedAt: timestamptz('replies_checked_at'),
    // The Slack thread the conversation lives in — kept as channel + ts so a
    // reply can be posted into it without re-parsing a permalink.
    slackChannelId: text('slack_channel_id'),
    slackThreadTs: text('slack_thread_ts'),
    /** True when the CEO is in the conversation too, not only the bot and them. */
    slackShared: boolean('slack_shared').notNull().default(false),
    title: text('title'),
    priority: text('priority').notNull().default('P2'),
    closedAt: timestamptz('closed_at'),
    closedNote: text('closed_note'),
    archivedAt: timestamptz('archived_at'),
    nudgeCount: integer('nudge_count').notNull().default(0),
    lastNudgeAt: timestamptz('last_nudge_at'),
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

    /** Where it arrived from, so it keeps its trail back to the conversation. */
    source: text('source').notNull().default('manual'),
    sourceRef: text('source_ref'),
    sourceUrl: text('source_url'),
    receivedAt: timestamptz('received_at'),
    /** What it belongs to. Either, both, or neither. */
    opportunityId: uuid('opportunity_id'),
    pipelineClientId: uuid('pipeline_client_id'),
    drivePath: text('drive_path'),
    notes: text('notes'),
    archivedAt: timestamptz('archived_at'),

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
  drivePath: text('drive_path'),
  mimeType: text('mime_type'),
  sizeBytes: moneyCents('size_bytes'),
  sourceRef: text('source_ref'),
  sourceUrl: text('source_url'),
  /** Set once the bytes are actually in Drive, not merely recorded. */
  uploadedAt: timestamptz('uploaded_at'),
});

/**
 * Attachments already looked at, so a re-scan does not re-propose what he has
 * dealt with. Keyed on where it came from rather than on the file, because the
 * same file arriving twice from two places is two decisions to make once each.
 */
export const contractIntakeSeen = pgTable('contract_intake_seen', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  source: text('source').notNull(),
  sourceRef: text('source_ref').notNull(),
  fileName: text('file_name'),
  fileHash: text('file_hash'),
  decided: text('decided').notNull().default('pending'),
  contractId: uuid('contract_id'),
  seenAt: timestamptz('seen_at').notNull().defaultNow(),
});

/**
 * The HubSpot mirror. Keyed on the HubSpot id, so a re-sync updates in place and
 * the cockpit and the CRM never disagree about which record is which.
 */
export const crmCompanies = pgTable(
  'crm_companies',
  {
    hubspotId: text('hubspot_id').primaryKey(),
    name: text('name').notNull(),
    domain: text('domain'),
    lifecycleStage: text('lifecycle_stage'),
    ownerId: text('owner_id'),
    ownerName: text('owner_name'),
    industry: text('industry'),
    country: text('country'),
    city: text('city'),
    phone: text('phone'),
    contactCount: integer('contact_count').notNull().default(0),
    hsCreatedAt: timestamptz('hs_created_at'),
    hsUpdatedAt: timestamptz('hs_updated_at'),
    syncedAt: timestamptz('synced_at').notNull().defaultNow(),
    // 'hubspot' for a copied record, 'local' for one created here. Once
    // editedAt is set the sync leaves the row alone — see db/migrations/0007.
    source: text('source').notNull().default('hubspot'),
    notes: text('notes'),
    editedAt: timestamptz('edited_at'),
    editedBy: text('edited_by'),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [index('idx_crm_companies_stage').on(t.lifecycleStage)],
);

export const crmContacts = pgTable(
  'crm_contacts',
  {
    hubspotId: text('hubspot_id').primaryKey(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    jobTitle: text('job_title'),
    companyName: text('company_name'),
    companyId: text('company_id'),
    lifecycleStage: text('lifecycle_stage'),
    ownerId: text('owner_id'),
    ownerName: text('owner_name'),
    lastActivityAt: timestamptz('last_activity_at'),
    hsCreatedAt: timestamptz('hs_created_at'),
    hsUpdatedAt: timestamptz('hs_updated_at'),
    syncedAt: timestamptz('synced_at').notNull().defaultNow(),
    source: text('source').notNull().default('hubspot'),
    notes: text('notes'),
    editedAt: timestamptz('edited_at'),
    editedBy: text('edited_by'),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [index('idx_crm_contacts_company').on(t.companyId)],
);

/**
 * The sales pipeline the CEO works himself. Deliberately separate from
 * `crmCompanies`, which mirrors HubSpot read-only: an edit here is his own
 * working state and must never be overwritten by the next CRM sync.
 */
export const pipelineClients = pgTable(
  'pipeline_clients',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    domain: text('domain'),
    clientType: text('client_type').notNull().default('other'),
    stage: text('stage').notNull().default('lead'),
    temperature: text('temperature').notNull().default('warm'),
    ownerPersonId: uuid('owner_person_id').references(() => people.id),
    nextStep: text('next_step'),
    nextStepDate: date('next_step_date'),
    valueCents: moneyCents('value_cents'),
    probability: smallint('probability'),
    source: text('source'),
    notes: text('notes'),
    lastContactAt: timestamptz('last_contact_at'),
    hubspotCompanyId: text('hubspot_company_id'),
    /** Where the deal came from, when it was promoted out of opportunities. */
    opportunityId: uuid('opportunity_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [index('idx_pipeline_stage_drz').on(t.stage)],
);

export const pipelineTouches = pgTable('pipeline_touches', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clientId: uuid('client_id')
    .notNull()
    .references(() => pipelineClients.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  happenedAt: timestamptz('happened_at').notNull().defaultNow(),
  createdBy: text('created_by').notNull().default('ceo'),
});

/**
 * The mailbox, mirrored. See db/migrations/0010_mail.sql — the screen reads
 * this table rather than Gmail, and nothing is ever written back.
 */
export const mailThreads = pgTable(
  'mail_threads',
  {
    threadId: text('thread_id').primaryKey(),
    subject: text('subject'),
    snippet: text('snippet'),
    counterpartName: text('counterpart_name'),
    counterpartEmail: text('counterpart_email'),
    participants: text('participants').array().notNull().default([]),
    messageCount: integer('message_count').notNull().default(1),
    lastMessageAt: timestamptz('last_message_at').notNull(),
    firstMessageAt: timestamptz('first_message_at'),
    /** The last word is theirs, so the ball is with him. */
    lastFromMe: boolean('last_from_me').notNull().default(false),
    unread: boolean('unread').notNull().default(false),
    starred: boolean('starred').notNull().default(false),
    gmailImportant: boolean('gmail_important').notNull().default(false),
    knownContact: boolean('known_contact').notNull().default(false),
    knownCompany: text('known_company'),
    labels: text('labels').array().notNull().default([]),
    syncedAt: timestamptz('synced_at').notNull().defaultNow(),
    dismissedAt: timestamptz('dismissed_at'),
  },
  (t) => [index('idx_mail_recent_drz').on(t.lastMessageAt)],
);

export type MailThread = typeof mailThreads.$inferSelect;

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
export type CrmCompany = typeof crmCompanies.$inferSelect;
export type NewCrmCompany = typeof crmCompanies.$inferInsert;
export type CrmContact = typeof crmContacts.$inferSelect;
export type PipelineClient = typeof pipelineClients.$inferSelect;
export type NewPipelineClient = typeof pipelineClients.$inferInsert;
export type PipelineTouch = typeof pipelineTouches.$inferSelect;
export type NewCrmContact = typeof crmContacts.$inferInsert;

/**
 * The company P&L by day, mirrored from the Ad Ops Architect source.
 *
 * This was a JSON fixture compiled into the build, which is why the numbers on
 * screen aged: refreshing them required a redeploy. Here a timer can write it.
 */
export const companyDaily = pgTable('company_daily', {
  date: date('date').primaryKey(),

  pubGrossCents: moneyCents('pub_gross_cents').notNull().default(0),
  pubSourceFeeCents: moneyCents('pub_source_fee_cents').notNull().default(0),
  pubNetAfterFeeCents: moneyCents('pub_net_after_fee_cents').notNull().default(0),
  pubPayoutCents: moneyCents('pub_payout_cents').notNull().default(0),
  pubProfitCents: moneyCents('pub_profit_cents').notNull().default(0),
  pubImpressions: moneyCents('pub_impressions').notNull().default(0),

  bidderGrossCents: moneyCents('bidder_gross_cents').notNull().default(0),
  bidderProfitCents: moneyCents('bidder_profit_cents').notNull().default(0),
  bidderImpressions: moneyCents('bidder_impressions').notNull().default(0),

  seatGrossCents: moneyCents('seat_gross_cents').notNull().default(0),
  seatPayoutCents: moneyCents('seat_payout_cents').notNull().default(0),
  seatProfitCents: moneyCents('seat_profit_cents').notNull().default(0),
  seatImpressions: moneyCents('seat_impressions').notNull().default(0),

  xeRevenueCents: moneyCents('xe_revenue_cents').notNull().default(0),
  xeCostCents: moneyCents('xe_cost_cents').notNull().default(0),
  xeProfitCents: moneyCents('xe_profit_cents').notNull().default(0),
  xeImpressions: moneyCents('xe_impressions').notNull().default(0),

  source: text('source').notNull().default('lovable'),
  pulledAt: timestamptz('pulled_at').notNull().defaultNow(),
});

export type CompanyDaily = typeof companyDaily.$inferSelect;

/**
 * Opportunities — what he noticed and has not acted on.
 *
 * The stage before the pipeline: no owner, no stage, no next step yet. They do
 * not fail loudly, they stop being mentioned, so `lastTouchedAt` is the column
 * the whole module is built around.
 */
export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('other'),
    status: text('status').notNull().default('new'),
    note: text('note'),
    counterparty: text('counterparty'),
    /** Null means he has not sized it — different from zero. */
    valueCents: moneyCents('value_cents'),
    nextStep: text('next_step'),
    nextStepDate: date('next_step_date'),
    revisitOn: date('revisit_on'),

    source: text('source').notNull().default('manual'),
    sourceUrl: text('source_url'),
    sourceExcerpt: text('source_excerpt'),
    /** The mail thread id or Slack ts, so the same thing is never captured twice. */
    sourceRef: text('source_ref'),
    sourceAt: timestamptz('source_at'),

    detectReasons: text('detect_reasons').array().notNull().default([]),
    detectScore: smallint('detect_score'),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: text('created_by'),
    lastTouchedAt: timestamptz('last_touched_at').notNull().defaultNow(),
    decidedAt: timestamptz('decided_at'),
    decidedNote: text('decided_note'),
    archivedAt: timestamptz('archived_at'),

    /** Set once it has matured into a real deal — see promoteToPipeline. */
    pipelineClientId: uuid('pipeline_client_id'),
    promotedAt: timestamptz('promoted_at'),
  },
  (t) => [index('idx_opportunities_live_drz').on(t.lastTouchedAt)],
);

export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
