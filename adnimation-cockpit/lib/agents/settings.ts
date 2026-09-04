/**
 * What he can turn on each agent, with no database underneath.
 *
 * An agent's brief is free text — the corrections nobody could have
 * anticipated. Its settings are the opposite: the handful of dials that every
 * run of that agent reads, named and bounded, so changing one is a click and
 * not a sentence the model has to interpret. Both go to the agent; only these
 * are guaranteed to be obeyed, because the code reads them directly.
 *
 * Every field carries its default here. What is stored is only what he
 * changed, so a new dial added later is live for every agent the moment it
 * ships, at the value it should have.
 */

export type SettingField =
  | { key: string; label: string; help?: string; type: 'number'; default: number; min?: number; max?: number; step?: number; unit?: string }
  | { key: string; label: string; help?: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; help?: string; type: 'select'; default: string; options: { value: string; label: string }[] }
  | { key: string; label: string; help?: string; type: 'text'; default: string; placeholder?: string }
  | { key: string; label: string; help?: string; type: 'multi'; default: string[]; options: { value: string; label: string }[] };

export type Settings = Record<string, number | boolean | string | string[]>;

const LANGUAGE = {
  key: 'language',
  label: 'Language of what it writes',
  type: 'select' as const,
  default: 'match',
  options: [
    { value: 'match', label: 'Match the other side' },
    { value: 'he', label: 'Hebrew' },
    { value: 'en', label: 'English' },
  ],
};

const TONE = {
  key: 'tone',
  label: 'Tone',
  type: 'select' as const,
  default: 'direct',
  options: [
    { value: 'direct', label: 'Direct and short' },
    { value: 'warm', label: 'Warm' },
    { value: 'formal', label: 'Formal' },
  ],
};

const CHANNEL = {
  key: 'channel',
  label: 'Where it reports',
  type: 'select' as const,
  default: 'slack',
  options: [
    { value: 'slack', label: 'Slack, to you' },
    { value: 'alert', label: 'The action inbox only' },
    { value: 'both', label: 'Both' },
  ],
};

const QUIET_HOURS = {
  key: 'quietHours',
  label: 'Quiet hours',
  help: 'It will not post to you between these hours (Israel time). Alerts still land in the inbox.',
  type: 'text' as const,
  default: '22-07',
  placeholder: '22-07',
};

const MAX_ITEMS = (def: number, label = 'Most items per run') => ({
  key: 'maxItems',
  label,
  help: 'A run that produces more than this stops and tells you, rather than flooding you.',
  type: 'number' as const,
  default: def,
  min: 1,
  max: 100,
  step: 1,
});

const LINES = [
  { value: 'core_clients', label: 'Core clients' },
  { value: 'video', label: 'Video' },
  { value: 'apps', label: 'Apps' },
  { value: 'bidder', label: 'Bidder' },
  { value: 'trading_display', label: 'Trading · display' },
  { value: 'exchange', label: 'Exchange' },
  { value: 'seat_lease', label: 'Seat lease' },
];

export const AGENT_SETTINGS: Record<string, SettingField[]> = {
  'contract-reader': [
    LANGUAGE,
    { key: 'flagValueOver', label: 'Flag any commitment over (USD)', type: 'number', default: 10_000, min: 0, step: 1000, unit: 'USD' },
    { key: 'summaryLength', label: 'Summary length', type: 'select', default: 'short', options: [{ value: 'short', label: 'Five lines' }, { value: 'full', label: 'Clause by clause' }] },
    CHANNEL,
  ],
  'contract-redliner': [
    LANGUAGE, TONE,
    { key: 'paymentTermsDays', label: 'Payment terms we accept (days)', type: 'number', default: 60, min: 0, max: 180, step: 15 },
    { key: 'noticeDays', label: 'Notice period we ask for (days)', type: 'number', default: 30, min: 0, max: 180, step: 15 },
    { key: 'neverAccept', label: 'Clauses to always strike', type: 'text', default: 'exclusivity, auto-renewal beyond 12 months, unlimited liability', placeholder: 'comma separated' },
  ],
  'contract-chaser': [
    LANGUAGE, TONE,
    { key: 'firstChaseDays', label: 'First chase after (days)', type: 'number', default: 7, min: 1, max: 60 },
    { key: 'secondChaseDays', label: 'Second chase after (days)', type: 'number', default: 14, min: 1, max: 90 },
    { key: 'escalateDays', label: 'Escalate to you after (days)', type: 'number', default: 21, min: 1, max: 120 },
  ],
  'renewal-warner': [
    { key: 'warnDays', label: 'Warn this many days before the notice window closes', type: 'number', default: 45, min: 7, max: 180 },
    { key: 'createTask', label: 'Also open a task', type: 'boolean', default: true },
    CHANNEL,
  ],
  'morning-brief': [
    { key: 'hour', label: 'Send at (hour, Israel time)', type: 'number', default: 7, min: 5, max: 11 },
    { key: 'weekends', label: 'Also on Friday and Saturday', type: 'boolean', default: false },
    { key: 'sections', label: 'What it covers', type: 'multi', default: ['profit', 'lines', 'deals', 'waiting', 'agents'], options: [
      { value: 'profit', label: 'Yesterday’s profit' }, { value: 'lines', label: 'Control panel lines' },
      { value: 'deals', label: 'Deals needing attention' }, { value: 'waiting', label: 'Mail and hand-offs waiting' },
      { value: 'agents', label: 'What the agents did overnight' },
    ] },
    LANGUAGE,
  ],
  'weekly-review': [
    { key: 'day', label: 'Day', type: 'select', default: 'thu', options: [{ value: 'thu', label: 'Thursday' }, { value: 'fri', label: 'Friday' }, { value: 'sun', label: 'Sunday' }] },
    { key: 'hour', label: 'Hour (Israel time)', type: 'number', default: 13, min: 6, max: 20 },
    LANGUAGE,
  ],
  'revenue-watchdog': [
    { key: 'dropPct', label: 'Alert when a line drops more than (%)', type: 'number', default: 25, min: 5, max: 90, step: 5, unit: '%' },
    { key: 'baselineDays', label: 'Baseline window (days)', type: 'number', default: 28, min: 7, max: 90, step: 7 },
    { key: 'minDailyUsd', label: 'Ignore lines below (USD/day)', type: 'number', default: 200, min: 0, step: 50, unit: 'USD' },
    CHANNEL,
  ],
  'activity-watch': [
    { key: 'lines', label: 'Lines it watches', type: 'multi', default: LINES.map((l) => l.value), options: LINES },
    { key: 'dropPct', label: 'Alert when a line drops more than (%)', type: 'number', default: 20, min: 5, max: 90, step: 5, unit: '%' },
    { key: 'risePct', label: 'Also tell you when a line rises more than (%)', type: 'number', default: 40, min: 10, max: 300, step: 10, unit: '%' },
    { key: 'compare', label: 'Compare against', type: 'select', default: 'week', options: [{ value: 'week', label: 'The previous 7 days' }, { value: 'sameday', label: 'The same weekday, 4 weeks' }] },
    CHANNEL, QUIET_HOURS,
  ],
  'core-client-guardian': [
    { key: 'topN', label: 'How many accounts count as core', type: 'number', default: 15, min: 3, max: 60 },
    { key: 'dropPct', label: 'Flag a drop of more than (%) week over week', type: 'number', default: 25, min: 5, max: 90, step: 5, unit: '%' },
    { key: 'draftOutreach', label: 'Draft a note to the account when it drops', type: 'boolean', default: true },
    { key: 'openTask', label: 'Open a task for the account manager', type: 'boolean', default: true },
    LANGUAGE, TONE, CHANNEL,
  ],
  'partner-health-watch': [
    { key: 'dropPct', label: 'Flag a partner down more than (%)', type: 'number', default: 30, min: 5, max: 90, step: 5, unit: '%' },
    { key: 'quietDays', label: 'Flag a partner with no conversation for (days)', type: 'number', default: 30, min: 7, max: 120 },
    { key: 'sides', label: 'Which sides', type: 'multi', default: ['demand', 'supply'], options: [{ value: 'demand', label: 'Demand' }, { value: 'supply', label: 'Supply' }] },
    CHANNEL,
  ],
  'deal-mover': [
    { key: 'overdueDays', label: 'Chase a next step this many days after it was due', type: 'number', default: 2, min: 0, max: 30 },
    { key: 'quietDays', label: 'Treat a deal as quiet after (days)', type: 'number', default: 14, min: 3, max: 90 },
    { key: 'draftFollowUp', label: 'Draft the follow-up mail', type: 'boolean', default: true },
    { key: 'proposeStage', label: 'Propose stage moves', type: 'boolean', default: true },
    { key: 'stages', label: 'Stages it works', type: 'multi', default: ['open_new', 'open_existing', 'negotiation', 'contract', 'integration'], options: [
      { value: 'open_new', label: 'Open — new' }, { value: 'open_existing', label: 'Open — existing' },
      { value: 'negotiation', label: 'Negotiation' }, { value: 'contract', label: 'Contract' }, { value: 'integration', label: 'Integration' },
    ] },
    LANGUAGE, TONE, MAX_ITEMS(10, 'Most drafts per run'),
  ],
  'inbox-triage': [
    { key: 'onlyKnown', label: 'Only mail from people the company deals with', type: 'boolean', default: true },
    { key: 'olderThanHours', label: 'Only mail waiting longer than (hours)', type: 'number', default: 24, min: 1, max: 336 },
    LANGUAGE, TONE, MAX_ITEMS(20, 'Most drafts per run'),
  ],
  'mail-answerer': [
    { key: 'maxSentences', label: 'Longest reply (sentences)', type: 'number', default: 3, min: 1, max: 8 },
    { key: 'onlyKnown', label: 'Only answer people the company deals with', type: 'boolean', default: false },
    { key: 'neverTopics', label: 'Never touch mail about', type: 'text', default: 'money, contracts, legal, staff, commitments', placeholder: 'comma separated' },
    { key: 'signOff', label: 'Sign-off', type: 'text', default: 'Best,\nMaor', placeholder: 'Best,\nMaor' },
    LANGUAGE, TONE, MAX_ITEMS(15, 'Most replies per run'),
  ],
  'meeting-booker': [
    { key: 'from', label: 'Earliest you start a meeting', help: 'Israel time. Offers step every half hour from here.', type: 'text', default: '10:30', placeholder: '10:30' },
    { key: 'to', label: 'Latest a meeting may end', type: 'text', default: '18:00', placeholder: '18:00' },
    {
      key: 'eveningFrom',
      label: 'An evening starts at',
      help: 'It never offers a time from here on by itself — it asks you in Slack first, with who it is and what it is about.',
      type: 'text', default: '18:00', placeholder: '18:00',
    },
    {
      key: 'days', label: 'Days you take meetings', type: 'multi', default: ['0', '1', '2', '3', '4'],
      options: [
        { value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }, { value: '2', label: 'Tuesday' },
        { value: '3', label: 'Wednesday' }, { value: '4', label: 'Thursday' }, { value: '5', label: 'Friday' },
        { value: '6', label: 'Saturday' },
      ],
    },
    { key: 'minutes', label: 'How long a meeting is (minutes)', type: 'number', default: 30, min: 15, max: 120, step: 15 },
    { key: 'offers', label: 'How many times to offer', type: 'number', default: 3, min: 1, max: 5 },
    { key: 'minLeadHours', label: 'Nothing sooner than (hours from now)', type: 'number', default: 18, min: 2, max: 96 },
    { key: 'horizonDays', label: 'How far ahead it looks (days)', type: 'number', default: 10, min: 3, max: 30 },
    { key: 'calendlyLink', label: 'Your booking link', help: 'Sent alongside the times, and on its own when the diary cannot be read.', type: 'text', default: '', placeholder: 'https://calendly.com/…' },
    { key: 'book', label: 'Put the meeting in the calendar itself', help: 'Off: it tells you they accepted and you add it.', type: 'boolean', default: true },
    { key: 'signOff', label: 'Sign-off', type: 'text', default: 'Best,\nMaor', placeholder: 'Best,\nMaor' },
  ],
  'invoice-forwarder': [
    { key: 'to', label: 'Forward to', type: 'text', default: 'finance@adnimation.com', placeholder: 'someone@adnimation.com' },
    { key: 'needsDocument', label: 'Only when a document is attached', type: 'boolean', default: true },
    { key: 'ignoreSenders', label: 'Never from', type: 'text', default: '', placeholder: 'comma separated addresses or domains' },
  ],
  'delegation-chaser': [
    { key: 'stuckDays', label: 'Nudge after (days without an answer)', type: 'number', default: 3, min: 1, max: 30 },
    { key: 'escalateAfter', label: 'Tell you after this many nudges', type: 'number', default: 2, min: 1, max: 5 },
    LANGUAGE, TONE, QUIET_HOURS,
  ],
  'commitment-tracker': [
    { key: 'sources', label: 'Read', type: 'multi', default: ['mail', 'slack'], options: [{ value: 'mail', label: 'Your sent mail' }, { value: 'slack', label: 'Your Slack messages' }] },
    { key: 'defaultDueDays', label: 'Due date when you named none (days)', type: 'number', default: 3, min: 1, max: 30 },
    { key: 'priority', label: 'Priority of the tasks it opens', type: 'select', default: 'P2', options: [{ value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }, { value: 'P3', label: 'P3' }] },
    MAX_ITEMS(10, 'Most tasks per run'),
  ],
  'task-hygiene': [
    { key: 'staleDays', label: 'A task is stale after (days untouched)', type: 'number', default: 14, min: 3, max: 90 },
    { key: 'zombieSnoozes', label: 'Snoozes before it is a zombie', type: 'number', default: 3, min: 2, max: 10 },
    { key: 'nudgeOwners', label: 'Nudge owners in Slack', type: 'boolean', default: false },
    { key: 'includeClickUp', label: 'Include the team’s ClickUp tasks', type: 'boolean', default: true },
    CHANNEL,
  ],
  'contact-harvester': [
    { key: 'lookbackDays', label: 'Read mail from the last (days)', type: 'number', default: 3, min: 1, max: 30 },
    { key: 'requireSignature', label: 'Only people with a signature block', type: 'boolean', default: false },
    { key: 'archiveRoleAccounts', label: 'Keep role accounts (info@, billing@) out', type: 'boolean', default: true },
  ],
  'systems-watch': [
    { key: 'staleHours', label: 'A sync is late after (hours)', type: 'number', default: 6, min: 1, max: 72 },
    { key: 'failedRuns', label: 'Alert after this many failed runs in a row', type: 'number', default: 2, min: 1, max: 10 },
    { key: 'watch', label: 'Watch', type: 'multi', default: ['syncs', 'timers', 'agents', 'source'], options: [
      { value: 'syncs', label: 'Data syncs (ClickUp, HubSpot, mail, revenue)' }, { value: 'timers', label: 'Job timers on the server' },
      { value: 'agents', label: 'Agent runs that failed' }, { value: 'source', label: 'The Ad Ops source going quiet' },
    ] },
    CHANNEL,
  ],
  'marketing-writer': [
    {
      key: 'sources', label: 'Where it looks for something to post about', type: 'multi',
      default: ['contracts', 'deals'],
      options: [
        { value: 'contracts', label: 'Contracts that were signed' },
        { value: 'deals', label: 'Deals that went live or were won' },
        { value: 'mail', label: 'Your mail (subjects that read like an achievement)' },
      ],
    },
    { key: 'lookbackDays', label: 'How far back it looks (days)', type: 'number', default: 30, min: 3, max: 120 },
    { key: 'maxPosts', label: 'Most drafts per run', type: 'number', default: 2, min: 1, max: 6 },
    {
      key: 'nameClients',
      label: 'May name the client',
      help: 'Off by default: it writes “a leading Israeli publisher” and you add the name yourself if you want it there.',
      type: 'boolean',
      default: false,
    },
    { key: 'hashtags', label: 'Hashtags to end with', type: 'text', default: '', placeholder: '#adtech #publishers' },
    {
      key: 'language', label: 'Language of the post', type: 'select', default: 'en',
      options: [{ value: 'en', label: 'English' }, { value: 'he', label: 'Hebrew' }],
    },
    TONE,
    { key: 'provider', label: 'Model', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Whichever key is set (Claude first)' }, { value: 'anthropic', label: 'Claude' }, { value: 'gemini', label: 'Gemini' },
    ] },
  ],
  autopilot: [
    { key: 'hour', label: 'Daily review at (hour, Israel time)', type: 'number', default: 6, min: 0, max: 23 },
    { key: 'provider', label: 'Model', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Whichever key is set (Claude first)' }, { value: 'anthropic', label: 'Claude' }, { value: 'gemini', label: 'Gemini' },
    ] },
    { key: 'scope', label: 'What it reviews', type: 'multi', default: ['lines', 'clients', 'deals', 'contracts', 'tasks', 'mail', 'slack', 'agents', 'systems'], options: [
      { value: 'lines', label: 'Control panel lines' }, { value: 'clients', label: 'Core clients' }, { value: 'deals', label: 'Deals' },
      { value: 'contracts', label: 'Contracts' }, { value: 'tasks', label: 'Tasks and hand-offs' }, { value: 'mail', label: 'Mail waiting on you' },
      { value: 'slack', label: 'Your Slack' },
      { value: 'agents', label: 'Other agents’ runs' }, { value: 'systems', label: 'Servers and syncs' },
    ] },
    {
      key: 'slackChannels',
      label: 'Slack channels it may write in',
      help: 'Comma separated, for example sales, ops. Leave empty for any channel the cockpit is in. A Slack message always waits for your approval, whatever the autonomy level.',
      type: 'text',
      default: '',
      placeholder: 'sales, ops',
    },
    { key: 'mayAct', label: 'What it may do on its own', type: 'multi', default: ['task', 'alert', 'note'], options: [
      { value: 'task', label: 'Open tasks' }, { value: 'alert', label: 'Raise alerts' }, { value: 'note', label: 'Log a note on a deal' },
      { value: 'stage', label: 'Move a deal’s stage' }, { value: 'agent', label: 'Switch other agents on or off' },
    ] },
    { key: 'maxDecisions', label: 'Most decisions per review', type: 'number', default: 12, min: 1, max: 50 },
    LANGUAGE,
  ],
};

/** Agents the roster no longer carries. Seeding never brings these back. */
export const RETIRED_AGENTS = [
  'code-cleaner', 'promo-filer', 'intro-writer', 'expense-sorter', 'payment-chaser',
  'meeting-prep', 'quiet-client-watch', 'opportunity-rescuer',
] as const;

export function settingsFor(agentName: string): SettingField[] {
  return AGENT_SETTINGS[agentName] ?? [];
}

/** The defaults, as a flat object. */
export function defaultSettings(agentName: string): Settings {
  const out: Settings = {};
  for (const f of settingsFor(agentName)) out[f.key] = f.default;
  return out;
}

/**
 * What he set, over the defaults, with anything unknown or malformed ignored.
 *
 * Stored values are trusted no further than their declared type: a number
 * field holding a string, or a select holding a value that is no longer an
 * option, falls back to the default rather than reaching the code that reads it.
 */
export function effectiveSettings(agentName: string, stored: unknown): Settings {
  const out = defaultSettings(agentName);
  if (!stored || typeof stored !== 'object') return out;
  const raw = stored as Record<string, unknown>;
  for (const f of settingsFor(agentName)) {
    const v = raw[f.key];
    if (v === undefined || v === null) continue;
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) break;
        if (f.min !== undefined && n < f.min) break;
        if (f.max !== undefined && n > f.max) break;
        out[f.key] = n;
        break;
      }
      case 'boolean':
        if (typeof v === 'boolean') out[f.key] = v;
        else if (v === 'true' || v === '1') out[f.key] = true;
        else if (v === 'false' || v === '0') out[f.key] = false;
        break;
      case 'select':
        if (typeof v === 'string' && f.options.some((o) => o.value === v)) out[f.key] = v;
        break;
      case 'text':
        if (typeof v === 'string') out[f.key] = v.slice(0, 2000);
        break;
      case 'multi': {
        const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
        const allowed = new Set(f.options.map((o) => o.value));
        out[f.key] = arr.map(String).map((s) => s.trim()).filter((s) => allowed.has(s));
        break;
      }
    }
  }
  return out;
}

/**
 * From a submitted form to what gets stored: only fields the agent declares,
 * only values that differ from the default, so the row says what he changed
 * and nothing else.
 */
export function settingsFromForm(agentName: string, form: Record<string, string | string[]>): Settings {
  const parsed = effectiveSettings(agentName, normaliseForm(agentName, form));
  const defaults = defaultSettings(agentName);
  const out: Settings = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (JSON.stringify(v) !== JSON.stringify(defaults[k])) out[k] = v;
  }
  return out;
}

function normaliseForm(agentName: string, form: Record<string, string | string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of settingsFor(agentName)) {
    const v = form[f.key];
    if (f.type === 'boolean') {
      // A checkbox that is off is simply absent from the form.
      out[f.key] = v !== undefined && v !== '' && v !== '0' && v !== 'false';
    } else if (f.type === 'multi') {
      out[f.key] = v === undefined ? [] : Array.isArray(v) ? v : [v];
    } else if (v !== undefined) {
      out[f.key] = v;
    }
  }
  return out;
}
