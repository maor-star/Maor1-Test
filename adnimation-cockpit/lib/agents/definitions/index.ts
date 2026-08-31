import type { AgentInput } from '../types';

/**
 * The agents worth having, and the order they are safe to switch on.
 *
 * Every one starts at level 1: it proposes, he decides. The spec's rule is
 * that promotion is earned over twenty runs, and the point of starting there
 * is not ceremony — it is that he gets to see what each one *would* have done
 * before it starts doing it.
 *
 * `contract-countersign` is deliberately absent. It is the highest-risk agent
 * in the system, the brief puts it last and gates it behind legal
 * preconditions, and it needs an e-signature provider — the provider's audit
 * trail is the legal record, and a signature image composited onto a PDF is
 * not. Building the reading half now and the signing half later is the whole
 * design, not a shortcut.
 */
export const SEED_AGENTS: (AgentInput & { rationale: string })[] = [
  {
    name: 'contract-reader',
    description:
      'Reads every contract that arrives, summarises what it commits us to, and flags the ' +
      'clauses worth arguing about before signing.',
    rationale:
      'The one that saves the most reading. It never edits or signs — it tells him what is in ' +
      'the document so classifying it takes a minute instead of an evening.',
    triggerType: 'event',
    triggerConfig: { event: 'contract.version_added' },
    conditions: [
      { name: 'The file is readable', check: 'contract_has_drive_file', config: {} },
      { name: 'Claude is connected', check: 'claude_configured', config: {} },
    ],
    actions: [
      { type: 'summarise_contract', config: {} },
      { type: 'create_alert', config: { severity: 'info' } },
    ],
    autonomyLevel: 1,
    maxRunsPerHour: 20,
    enabled: false,
  },
  {
    name: 'contract-redliner',
    description:
      'Compares an arriving contract against the terms we normally accept and drafts the ' +
      'changes to ask for.',
    rationale:
      'The "fixes" half of what he asked for. It proposes redlines as a note on the contract; ' +
      'it does not edit the document, because an agent editing a legal document unsupervised ' +
      'is exactly what the autonomy ladder exists to prevent.',
    triggerType: 'event',
    triggerConfig: { event: 'contract.classified' },
    conditions: [
      { name: 'The file is readable', check: 'contract_has_drive_file', config: {} },
      { name: 'Claude is connected', check: 'claude_configured', config: {} },
      { name: 'Not already signed', check: 'contract_not_signed', config: {} },
    ],
    actions: [{ type: 'propose_contract_changes', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 20,
    enabled: false,
  },
  {
    name: 'contract-chaser',
    description:
      'Watches contracts sitting with the other side and drafts the chase at 7, 14 and 21 days.',
    rationale:
      'A contract waiting with the other side is the most common way a deal quietly dies. ' +
      'The draft goes to him; sending it is an irreversible action and stays his.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 8 * * 1-5' },
    conditions: [{ name: 'Something is overdue', check: 'contract_overdue', config: { days: 7 } }],
    actions: [{ type: 'draft_reply', config: {} }, { type: 'create_task', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'morning-brief',
    description:
      'One message before the day starts: yesterday’s profit, what went cold, what is waiting ' +
      'on you, and what is stuck with someone else.',
    rationale:
      'Everything the cockpit knows, pushed to him instead of waiting to be opened. Reversible, ' +
      'internal, and the natural first agent to promote past level 1.',
    triggerType: 'schedule',
    triggerConfig: { cron: '30 7 * * 0-4' },
    conditions: [{ name: 'There is something to say', check: 'brief_has_content', config: {} }],
    actions: [{ type: 'post_slack_internal', config: { to: 'ceo' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
  {
    name: 'revenue-watchdog',
    description:
      'Compares each business line against its own 28-day pattern and raises one alert when a ' +
      'line moves in a way it does not usually move.',
    rationale:
      'The exchange collapsed from $9,720 to $565 over three days and nothing told him. This ' +
      'is the agent that would have.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 9 * * *' },
    conditions: [{ name: 'A line moved abnormally', check: 'revenue_anomaly', config: {} }],
    actions: [{ type: 'create_alert', config: { severity: 'warning' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'opportunity-rescuer',
    description:
      'Finds opportunities that have gone quiet with no next step and drafts the one message ' +
      'that would restart each.',
    rationale:
      'Opportunities do not fail loudly, they stop being mentioned. This turns the cold list ' +
      'into drafted messages he only has to approve.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 10 * * 1' },
    conditions: [{ name: 'Something has gone cold', check: 'opportunity_cold', config: {} }],
    actions: [{ type: 'draft_reply', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
  {
    name: 'inbox-triage',
    description:
      'Sorts the mail waiting on you into what needs a real answer, what needs a line, and ' +
      'what needs nothing — and drafts the lines.',
    rationale:
      '337 conversations are waiting on him. Most need a sentence. This writes the sentences ' +
      'and leaves sending to him.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 */4 * * *' },
    conditions: [{ name: 'Mail is waiting', check: 'mail_waiting', config: {} }],
    actions: [{ type: 'draft_reply', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 8,
    enabled: false,
  },
  {
    name: 'delegation-chaser',
    description:
      'Notices hand-offs that have gone quiet and drafts the nudge, in the same Slack thread.',
    rationale:
      'Internal, reversible, and the thing he currently does by remembering. A good candidate ' +
      'for level 2 once it has a record.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 11 * * 1-5' },
    conditions: [{ name: 'A hand-off is stuck', check: 'delegation_stuck', config: {} }],
    actions: [{ type: 'post_slack_internal', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'invoice-forwarder',
    description:
      'Forwards every invoice that arrives to finance@adnimation.com, with the original message ' +
      'attached exactly as it came.',
    rationale:
      'The only agent that sends anything, and it physically cannot send outside the company — ' +
      'every recipient is checked against adnimation.com before anything leaves. It needs both ' +
      'the word and a document, because a missed invoice you forward by hand and a wrong one has ' +
      'finance chasing a payment that does not exist.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 */6 * * *' },
    conditions: [{ name: 'It really is an invoice', check: 'looks_like_invoice', config: {} }],
    actions: [{ type: 'send_internal_email', config: { to: 'finance@adnimation.com' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'renewal-warner',
    description:
      'Watches every signed contract for its notice period and warns you before the window to ' +
      'get out closes.',
    rationale:
      'An auto-renewal you notice a week late costs a year. The contract reader already finds ' +
      'the notice period; this is the thing that remembers it.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 8 * * 1' },
    conditions: [{ name: 'A notice window is closing', check: 'renewal_window', config: { days: 45 } }],
    actions: [{ type: 'create_alert', config: { severity: 'warning' } }, { type: 'create_task', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
  {
    name: 'meeting-prep',
    description:
      'Before each meeting, one card: who they are, what we last agreed, what is open with them, ' +
      'and what they are worth.',
    rationale:
      'Everything the cockpit knows about a counterparty, assembled in the ten minutes before ' +
      'you speak to them instead of in the hour after.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 6 * * 0-4' },
    conditions: [{ name: 'There is a meeting today', check: 'meeting_today', config: {} }],
    actions: [{ type: 'post_slack_internal', config: { to: 'ceo' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
  {
    name: 'payment-chaser',
    description:
      'Tracks invoices we have sent and drafts the chase when one goes past its terms.',
    rationale:
      'Money owed to us is the one number nobody in a small company is asked about daily. The ' +
      'draft goes to you; sending to a customer stays yours.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 9 * * 2' },
    conditions: [{ name: 'Something is overdue', check: 'receivable_overdue', config: { days: 7 } }],
    actions: [{ type: 'draft_reply', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
  {
    name: 'partner-health-watch',
    description:
      'Watches each demand and supply partner for a drop that is unusual for that partner, not ' +
      'just unusual in general.',
    rationale:
      'A partner halving is invisible in a company total. This compares each one against its own ' +
      'pattern, which is the only comparison that catches it early.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 10 * * *' },
    conditions: [{ name: 'A partner moved abnormally', check: 'partner_anomaly', config: {} }],
    actions: [{ type: 'create_alert', config: { severity: 'warning' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'weekly-review',
    description:
      'One message on Friday: what moved, what did not, what you said you would do and did not, ' +
      'and what is waiting on you going into next week.',
    rationale:
      'The report you would write yourself if you had an hour. Reversible, internal, and the ' +
      'natural second agent to promote.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 13 * * 4' },
    conditions: [],
    actions: [{ type: 'post_slack_internal', config: { to: 'ceo' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
  {
    name: 'intro-writer',
    description:
      'When you say who you want introduced to whom, drafts the introduction in your voice with ' +
      'the context both sides need.',
    rationale:
      'Introductions are high value and slow to write, which is why they get postponed. The ' +
      'draft is yours to send.',
    triggerType: 'manual',
    triggerConfig: {},
    conditions: [{ name: 'Claude is connected', check: 'claude_configured', config: {} }],
    actions: [{ type: 'draft_reply', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 10,
    enabled: false,
  },
  {
    name: 'expense-sorter',
    description:
      'Reads receipts and invoices as they arrive and files them by category and month, so the ' +
      'bookkeeping is done before anyone asks for it.',
    rationale:
      'The month-end scramble, removed. Filing is reversible and internal, which makes this a ' +
      'good candidate to run without asking once it has a record.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 5 * * *' },
    conditions: [{ name: 'Claude is connected', check: 'claude_configured', config: {} }],
    actions: [{ type: 'update_record', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'commitment-tracker',
    description:
      'Reads what you promised in Slack and email — "I will send you", "by Thursday" — and turns ' +
      'each into a task before you forget it.',
    rationale:
      'The promises you make in passing are the ones that damage trust when they are missed, and ' +
      'they are never written down anywhere.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 */4 * * *' },
    conditions: [{ name: 'Claude is connected', check: 'claude_configured', config: {} }],
    actions: [{ type: 'create_task', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 8,
    enabled: false,
  },
  {
    name: 'quiet-client-watch',
    description:
      'Notices a client you have not spoken to in longer than you usually would, and says who.',
    rationale:
      'Churn is quiet before it is loud. This is the list you would have made if you had ' +
      'remembered to make it.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 9 * * 1' },
    conditions: [{ name: 'Someone has gone quiet', check: 'client_quiet', config: { days: 30 } }],
    actions: [{ type: 'create_alert', config: { severity: 'info' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
];
