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
      'Compares an arriving contract against the terms we normally accept, drafts the changes ' +
      'to ask for, and writes the covering email. Its brief is where your standing positions ' +
      'live — payment terms, notice periods, what you never agree to — and the same brief ' +
      'drives the “answer this one” button on every contract, whether this agent is on or off.',
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
    name: 'deal-mover',
    description:
      'Works the deals board: a next step that has come and gone gets its follow-up drafted, ' +
      'a deal nobody has spoken to gets flagged, and a deal that has clearly moved on gets a ' +
      'proposed stage change — each one yours to approve.',
    rationale:
      'Deals do not fail loudly, they stop being mentioned. This turns the board’s quiet rows ' +
      'into drafted messages and proposed moves he only has to approve.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 9 * * 0-4' },
    conditions: [{ name: 'A deal has gone quiet or overdue', check: 'deal_stale', config: {} }],
    actions: [{ type: 'draft_reply', config: {} }, { type: 'create_task', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
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
    name: 'mail-answerer',
    description:
      'Answers the genuinely trivial mail — acknowledgements, scheduling, "who should I speak ' +
      'to" — files what it answered under “Claude/Answered”. What is only information, with ' +
      'nothing asked of you, it does not answer at all: it files that under “Claude/Filed” and ' +
      'tells you in one line what it said. Everything else stays in your inbox.',
    rationale:
      'The only agent that puts words in your mouth to someone outside the company, so it is ' +
      'built to refuse. Two gates that must both pass: rules no model can argue past (nothing ' +
      'about money, contracts, legal, staff or any commitment), then the model’s own veto, which ' +
      'may only narrow what the rules allowed. Declining costs you one email; a wrong reply ' +
      'commits you in writing to someone who will hold you to it.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 */2 * * *' },
    conditions: [
      { name: 'Claude is connected', check: 'claude_configured', config: {} },
      { name: 'It is genuinely simple', check: 'mail_is_simple', config: {} },
    ],
    actions: [
      { type: 'draft_reply', config: {} },
      { type: 'update_record', config: { label: 'Claude/Answered', removeFromInbox: true } },
      { type: 'update_record', config: { label: 'Claude/Filed', removeFromInbox: true } },
    ],
    autonomyLevel: 1,
    maxRunsPerHour: 6,
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
    name: 'activity-watch',
    description:
      'Watches every line on the control panel — core clients, video, apps, bidder, display ' +
      'trading, the exchange, seat lease — against its own recent pattern, and says which line ' +
      'moved and by how much the morning it happens.',
    rationale:
      'The company total hides a line collapsing. Each line against its own week is the only ' +
      'comparison that catches it early, and the threshold is his to set.',
    triggerType: 'schedule',
    triggerConfig: { cron: '30 8 * * *' },
    conditions: [{ name: 'A line moved abnormally', check: 'activity_anomaly', config: {} }],
    actions: [{ type: 'create_alert', config: { severity: 'warning' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'core-client-guardian',
    description:
      'Watches the accounts that carry the company. When one drops against its own previous ' +
      'week it raises the flag, drafts the note to the account, and opens the task for whoever ' +
      'owns the relationship.',
    rationale:
      'Fifteen accounts are most of the money. A 25% drop in one of them is worth more than ' +
      'any other signal on the screen, and it is invisible in the total.',
    triggerType: 'schedule',
    triggerConfig: { cron: '45 8 * * *' },
    conditions: [{ name: 'A core account dropped', check: 'core_client_drop', config: {} }],
    actions: [
      { type: 'create_alert', config: { severity: 'warning' } },
      { type: 'draft_reply', config: {} },
      { type: 'create_task', config: {} },
    ],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'task-hygiene',
    description:
      'Keeps the task board honest: stale tasks, zombies snoozed three times, work with no ' +
      'owner and no date — surfaced daily, with the nudge drafted for whoever should move it.',
    rationale:
      'A task board nobody tends stops being believed. This is the tending, done every morning ' +
      'before he looks.',
    triggerType: 'schedule',
    triggerConfig: { cron: '15 8 * * 0-4' },
    conditions: [{ name: 'Something on the board is stale', check: 'task_stale', config: {} }],
    actions: [{ type: 'create_alert', config: { severity: 'info' } }, { type: 'post_slack_internal', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 4,
    enabled: false,
  },
  {
    name: 'contact-harvester',
    description:
      'Reads every mail that arrives and puts the person and their company into the CRM — name, ' +
      'title, phone, anything the signature gives — so the CRM is built by the mail rather than ' +
      'by remembering to type.',
    rationale:
      'The same harvest that built the CRM from a year of mail, run forward every few hours. ' +
      'Reversible: a contact it should not have added is archived, never deleted.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 */3 * * *' },
    conditions: [{ name: 'New mail has arrived', check: 'contact_harvest_pending', config: {} }],
    actions: [{ type: 'update_record', config: { target: 'crm' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 8,
    enabled: false,
  },
  {
    name: 'systems-watch',
    description:
      'Watches the machinery: the syncs from ClickUp, HubSpot, Gmail and the revenue source, ' +
      'the job timers on the server, and the other agents’ runs. A sync that is late or a job ' +
      'that failed twice is said out loud before the screen goes stale.',
    rationale:
      'Every panel here is only as true as the sync behind it. This is the one agent whose job ' +
      'is to doubt the others.',
    triggerType: 'schedule',
    triggerConfig: { cron: '*/30 * * * *' },
    conditions: [{ name: 'A system is late or failing', check: 'systems_stale', config: {} }],
    actions: [{ type: 'create_alert', config: { severity: 'critical' } }],
    autonomyLevel: 1,
    maxRunsPerHour: 6,
    enabled: false,
  },
  {
    name: 'marketing-writer',
    description:
      'Your marketing person. Reads what actually went right — contracts that were signed, deals ' +
      'that went live, achievements sitting in your mail — and writes the LinkedIn post about it, ' +
      'in your voice. Load it a document on this screen with posts you liked and it writes like ' +
      'those. It never publishes: the post waits on the Marketing screen, you edit it and press ' +
      'publish, and only then does it go out.',
    rationale:
      'The one agent whose output leaves the company, so the ladder is not the safeguard here — ' +
      'the design is. Drafting and publishing are different actions with different actors: the ' +
      'agent can only ever do the first, at any level.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 10 * * 0' },
    conditions: [
      { name: 'A model is connected', check: 'copilot_configured', config: {} },
      { name: 'Something happened worth posting about', check: 'marketing_material', config: {} },
    ],
    actions: [{ type: 'draft_linkedin_posts', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
  {
    name: 'meeting-booker',
    description:
      'Books your meetings. When someone you deal with asks for a time, it reads your diary, ' +
      'offers three that are actually free from 10:30 on — or sends your booking link when the ' +
      'diary cannot be read — files the thread under “Claude/Meetings” and tells you in Slack ' +
      'who it just put in your week. When they pick one of those times, it puts the meeting in ' +
      'your calendar. An evening, a weekend, or anything it is not certain about, it asks you ' +
      'in Slack first — who it is and what it is about — and answers only if you say yes. Every ' +
      'booking carries a Google Meet link, and whoever is already on the thread is on the ' +
      'invitation; anyone else it thinks the meeting needs, it asks you about first.',
    rationale:
      'Three outcomes rather than two, because you drew the lines yourself: it answers people ' +
      'you deal with, it asks you about the ones you might not want, and it says nothing at all ' +
      'to machines, strangers and cold pitches — those get silence, not a question. It can only ' +
      'ever offer times your calendar says are free, and it can only ever book a time it itself ' +
      'offered. Who it may invite is bounded the same way: the thread, or a colleague from your ' +
      'own roster that you said yes to — it cannot invent a person any more than it can invent ' +
      'an hour.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 */2 * * *' },
    conditions: [
      { name: 'Claude is connected', check: 'claude_configured', config: {} },
      { name: 'Someone you deal with asked to meet', check: 'meeting_requested', config: {} },
    ],
    actions: [
      { type: 'draft_reply', config: {} },
      { type: 'book_meeting', config: {} },
      { type: 'update_record', config: { label: 'Claude/Meetings', removeFromInbox: true } },
      { type: 'post_slack_internal', config: {} },
    ],
    autonomyLevel: 1,
    maxRunsPerHour: 6,
    enabled: false,
  },
  {
    name: 'autopilot',
    description:
      'The daily review of the whole company. Reads the control panel, the core clients, the ' +
      'deals, the contracts, the tasks, the mail waiting on you and the other agents’ runs, ' +
      'decides what should happen, and does what it is permitted to — opening tasks, raising ' +
      'alerts, noting deals — while writing down every decision and why. The Copilot screen is ' +
      'where you read the log and talk to it.',
    rationale:
      'The agent he asked for: one that manages rather than monitors. It is bounded by the same ' +
      'ladder as everything else — at level 1 it proposes; nothing external, nothing ' +
      'irreversible, ever — and its permissions are dials he sets, not assumptions it makes.',
    triggerType: 'schedule',
    triggerConfig: { cron: '0 6 * * *' },
    conditions: [{ name: 'A model is connected', check: 'copilot_configured', config: {} }],
    actions: [{ type: 'autopilot_review', config: {} }],
    autonomyLevel: 1,
    maxRunsPerHour: 2,
    enabled: false,
  },
];
