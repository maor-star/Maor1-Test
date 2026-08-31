import { pgEnum } from 'drizzle-orm/pg-core';

// Mirrors the ENUM types in db/schema.sql. Keep the two in lockstep.
export const deptCode = pgEnum('dept_code', [
  'CORE', 'SEAT', 'APP', 'DISP', 'CTV', 'BID', 'VID', 'ASIA',
  // Added by db/migrations/0002 — the ClickUp lists the company actually works in.
  'TRADING', 'GENERAL', 'HR', 'DEMAND', 'MKT', 'FIN', 'DEV',
]);
export const taskPriority = pgEnum('task_priority', ['P0', 'P1', 'P2', 'P3']);
export const taskSource = pgEnum('task_source', [
  'manual', 'alert', 'slack', 'email', 'meeting', 'contract', 'anomaly', 'agent',
]);
export const taskLayer = pgEnum('task_layer', ['mine', 'company']);
export const partnerType = pgEnum('partner_type', [
  'demand', 'supply', 'publisher', 'vendor', 'strategic',
]);
export const dealStage = pgEnum('deal_stage', [
  'lead', 'intro', 'qualified', 'negotiation', 'proposal_sent',
  'contract_out', 'integration', 'live', 'lost', 'dormant',
]);
export const dealSource = pgEnum('deal_source', [
  'calendly', 'conference', 'referral', 'outbound', 'inbound', 'other',
]);
export const contractCategory = pgEnum('contract_category', ['demand', 'supply', 'general']);
export const contractStatus = pgEnum('contract_status', [
  'unclassified', 'draft', 'in_review', 'negotiation', 'out_for_signature',
  'awaiting_my_signature', 'signed', 'expired', 'cancelled',
]);
export const renewalType = pgEnum('renewal_type', ['auto', 'manual']);
export const versionSource = pgEnum('version_source', [
  'inbound_mail', 'generated', 'counterparty', 'manual_upload',
]);
export const riskLevel = pgEnum('risk_level', ['none', 'minor', 'material', 'redline']);
export const clauseStance = pgEnum('clause_stance', ['opening', 'compromise', 'redline']);
export const sigAuthMode = pgEnum('sig_auth_mode', ['per_doc', 'batch', 'conditional']);
export const sigStatus = pgEnum('sig_status', [
  'pending', 'sent', 'signed', 'declined', 'expired', 'cancelled',
]);
export const alertType = pgEnum('alert_type', [
  'REVENUE_ANOMALY', 'SITE_CHANGE', 'PARTNER_RISK', 'CONTRACT_DUE',
  'TASK_OVERDUE', 'PAYMENT_LATE', 'INTEGRATION_FAILURE', 'PEOPLE_EVENT',
  'SECURITY', 'PIPELINE', 'MANUAL',
]);
export const severity = pgEnum('severity', ['info', 'watch', 'warning', 'critical']);
export const platformType = pgEnum('platform_type', ['web', 'app', 'ctv']);
export const channelType = pgEnum('channel_type', ['slack', 'mail', 'whatsapp', 'meeting', 'call']);
export const agentOutcome = pgEnum('agent_outcome', ['done', 'halted', 'failed', 'dry_run']);
export const delegationStatus = pgEnum('delegation_status', [
  'sent', 'acknowledged', 'in_progress', 'done', 'stale',
]);
