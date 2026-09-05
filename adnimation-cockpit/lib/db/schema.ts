import { customType } from 'drizzle-orm/pg-core';
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

/** Postgres bytea as a Buffer; drizzle has no built-in for it. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

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
    /*
     * The next move and when it happens — the same pair the deals board has.
     * A due date is when the task ends; these are what happens next, which on
     * a list he works down is the more useful of the two.
     */
    nextStep: text('next_step'),
    nextStepDate: date('next_step_date'),
    /**
     * When it last moved, which is not when the row was last written: the
     * ClickUp poll touches every mirrored row whether or not anything
     * happened.
     */
    lastTouchAt: timestamptz('last_touch_at'),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    lastSyncedAt: timestamptz('last_synced_at'),
    /** Fields the cockpit owns on a mirrored task; the sync leaves them alone. */
    pinnedFields: text('pinned_fields').array().notNull().default([]),
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
    /** Overrides the status's idea of whose move it is. Null follows the status. */
    waitingOnOverride: text('waiting_on_override'),
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
    linkedinUrl: text('linkedin_url'),
    website: text('website'),
    address: text('address'),
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
    /* What the signature gave beyond the name — see migration 0033. */
    mobile: text('mobile'),
    linkedinUrl: text('linkedin_url'),
    website: text('website'),
    address: text('address'),
    country: text('country'),
    city: text('city'),
    /** The signature block itself: the fact behind every field above. */
    signature: text('signature'),
    signatureAt: timestamptz('signature_at'),
    sourceThreadId: text('source_thread_id'),
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
    stage: text('stage').notNull().default('open_new'),
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
    /** How far into going live it is — see lib/pipeline/integration.ts. */
    integrationSteps: jsonb('integration_steps').notNull().default({}),
    /** Finished, and off the active board. Never deleted. */
    closedAt: timestamptz('closed_at'),
    closeOutcome: text('close_outcome'),
    closeNote: text('close_note'),
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
/**
 * The control panel's lines — one row per business line per day, pulled from
 * the Ad Ops Architect source by the activity sync. See
 * db/migrations/0030_activity_lines.sql.
 */
export const activityDaily = pgTable(
  'activity_daily',
  {
    line: text('line').notNull(),
    date: date('date').notNull(),
    grossCents: moneyCents('gross_cents').notNull().default(0),
    profitCents: moneyCents('profit_cents').notNull().default(0),
    impressions: moneyCents('impressions').notNull().default(0),
    entities: integer('entities'),
    source: text('source').notNull().default('lovable'),
    pulledAt: timestamptz('pulled_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.line, t.date] })],
);

/** One row per paying account per day — the core clients, ranked by money. */
export const coreClientsDaily = pgTable(
  'core_clients_daily',
  {
    account: text('account').notNull(),
    date: date('date').notNull(),
    isTrading: boolean('is_trading').notNull().default(false),
    grossCents: moneyCents('gross_cents').notNull().default(0),
    profitCents: moneyCents('profit_cents').notNull().default(0),
    impressions: moneyCents('impressions').notNull().default(0),
    source: text('source').notNull().default('lovable'),
    pulledAt: timestamptz('pulled_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.account, t.date] }), index('idx_core_clients_date').on(t.date)],
);

/** The copilot's conversations and the autopilot's decisions — db/migrations/0032_copilot.sql. */
export const copilotThreads = pgTable('copilot_threads', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  title: text('title').notNull().default('New conversation'),
  provider: text('provider').notNull().default('auto'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  archivedAt: timestamptz('archived_at'),
});

export const copilotMessages = pgTable(
  'copilot_messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid('thread_id').notNull().references(() => copilotThreads.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    toolCalls: jsonb('tool_calls').notNull().default([]),
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_copilot_messages_thread').on(t.threadId, t.createdAt)],
);

export const copilotDecisions = pgTable(
  'copilot_decisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid('run_id'),
    area: text('area').notNull(),
    title: text('title').notNull(),
    reasoning: text('reasoning').notNull(),
    action: jsonb('action').notNull().default({}),
    status: text('status').notNull().default('proposed'),
    executedRef: text('executed_ref'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    decidedAt: timestamptz('decided_at'),
    decidedBy: text('decided_by'),
  },
  (t) => [index('idx_copilot_decisions_status').on(t.status, t.createdAt)],
);

/** Credentials he set in the app. Values are encrypted — see lib/secrets/store.ts. */
export const appSecrets = pgTable('app_secrets', {
  key: text('key').primaryKey(),
  valueEnc: text('value_enc').notNull(),
  hint: text('hint'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by').notNull(),
});

/**
 * What the marketing agent wrote, and whether he let it out.
 *
 * The one table in the cockpit whose rows can end up on the public internet,
 * which is why publishing is a column set by his click and never by an agent.
 */
export const marketingPosts = pgTable(
  'marketing_posts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** contract | deal | mail | manual */
    sourceKind: text('source_kind').notNull(),
    sourceRef: text('source_ref'),
    occasion: text('occasion').notNull(),
    body: text('body').notNull(),
    /** Lines worth a second look before it goes out — figures, client names. */
    flags: text('flags').array().notNull().default([]),
    /** draft | posted | declined */
    status: text('status').notNull().default('draft'),
    editedBody: text('edited_body'),
    /** The picture Gemini drew for it, if he asked for one. */
    image: bytea('image'),
    imageMime: text('image_mime'),
    imagePrompt: text('image_prompt'),
    imageAt: timestamptz('image_at'),
    postedUrl: text('posted_url'),
    postedAt: timestamptz('posted_at'),
    declinedAt: timestamptz('declined_at'),
    decidedBy: text('decided_by'),
    model: text('model'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_marketing_open_drz').on(t.status, t.createdAt)],
);

export type MarketingPost = typeof marketingPosts.$inferSelect;

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

/**
 * The agent engine — CLAUDE.md §6. The table's own CHECK forbids level 4 for
 * an irreversible agent, and agent_runs carries triggers making it insert-only,
 * so the run log cannot be rewritten even by us.
 */
/**
 * Every run of an agent's job, with everything it printed.
 *
 * A dry run whose output lives only in the tab that started it cannot be
 * looked at the morning after; a timed run that printed into a journal on the
 * box may as well not have printed at all. Insert-only, like agent_runs.
 */
export const agentJobRuns = pgTable(
  'agent_job_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentName: text('agent_name').notNull(),
    dry: boolean('dry').notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    ok: boolean('ok'),
    output: text('output').notNull().default(''),
    summary: jsonb('summary').notNull().default({}),
  },
  (t) => [index('idx_agent_job_runs_agent').on(t.agentName, t.startedAt)],
);

/**
 * What an agent learned from his own mail, kept apart from what he told it.
 *
 * Retraining must never overwrite an instruction he wrote, and correcting an
 * instruction must never need a retrain — so the two live in different places
 * and meet only in the prompt.
 */
export const agentLearning = pgTable('agent_learning', {
  agentName: text('agent_name').primaryKey(),
  profile: text('profile'),
  examples: jsonb('examples').notNull().default([]),
  facts: jsonb('facts').notNull().default({}),
  threadsRead: integer('threads_read').notNull().default(0),
  startedAt: timestamptz('started_at'),
  learnedAt: timestamptz('learned_at'),
  error: text('error'),
  editedByHim: boolean('edited_by_him').notNull().default(false),
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  description: text('description'),
  triggerType: text('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config').notNull().default({}),
  conditions: jsonb('conditions').notNull().default([]),
  actions: jsonb('actions').notNull().default([]),
  autonomyLevel: smallint('autonomy_level').notNull().default(1),
  hasIrreversibleAction: boolean('has_irreversible_action').notNull().default(false),
  maxRunsPerHour: integer('max_runs_per_hour').notNull().default(10),
  enabled: boolean('enabled').notNull().default(true),
  runCount: integer('run_count').notNull().default(0),
  /** Whether this agent reports what it did in Slack. */
  notifySlack: boolean('notify_slack').notNull().default(false),
  /** What he has taught this agent, in his own words. */
  instructions: text('instructions'),
  instructionsUpdatedAt: timestamptz('instructions_updated_at'),
  /** Minimum minutes between real runs. Null runs whenever the timer fires. */
  runEveryMinutes: integer('run_every_minutes'),
  lastRanAt: timestamptz('last_ran_at'),
  /** His dials for this agent — see lib/agents/settings.ts. Only what he changed. */
  settings: jsonb('settings').notNull().default({}),
  /** The document behind the agent — see db/migrations/0035_agent_playbook.sql. */
  playbook: text('playbook'),
  playbookName: text('playbook_name'),
  playbookUpdatedAt: timestamptz('playbook_updated_at'),
  /** Set when the roster stopped carrying it. Hidden, never deleted. */
  retiredAt: timestamptz('retired_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastLevelChangeAt: timestamptz('last_level_change_at'),
});

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  agentId: uuid('agent_id').notNull(),
  triggeredBy: text('triggered_by').notNull(),
  dryRun: boolean('dry_run').notNull().default(false),
  startedAt: timestamptz('started_at').notNull().defaultNow(),
  finishedAt: timestamptz('finished_at'),
  conditionsEvaluated: jsonb('conditions_evaluated').notNull().default([]),
  actionsTaken: jsonb('actions_taken').notNull().default([]),
  recipients: text('recipients').array().notNull().default([]),
  outcome: text('outcome'),
  haltReason: text('halt_reason'),
  error: text('error'),
});

export type Agent = typeof agents.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
