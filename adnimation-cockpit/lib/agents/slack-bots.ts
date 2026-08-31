/**
 * A separate Slack bot per kind of work.
 *
 * One bot posting about invoices, contracts, revenue and mail is one stream he
 * learns to skim. Separate identities make each one skimmable on its own — and
 * more usefully, let him mute the noisy one without losing the one that matters.
 *
 * Two ways to get there, and the code takes whichever is available:
 *
 *   1. A real Slack app per bot, each with its own token. Genuinely separate:
 *      its own name, icon, and its own presence in the workspace. Needs an app
 *      created per bot, which only he can do.
 *   2. One token, posting under a different username and icon per bot. Visually
 *      separate in the channel, one app to maintain. Needs the
 *      `chat:write.customize` scope.
 *
 * Where neither is configured it falls back to the shared bot as itself, which
 * is what happens today — so nothing breaks while the apps are being made.
 */

export interface BotIdentity {
  key: string;
  /** Shown as the sender in Slack. */
  username: string;
  icon: string;
  /** Env var holding this bot's own token, when it has one. */
  tokenEnv: string;
  purpose: string;
}

export const BOTS: BotIdentity[] = [
  {
    key: 'mail',
    username: 'Cockpit Mail',
    icon: ':envelope:',
    tokenEnv: 'SLACK_BOT_TOKEN_MAIL',
    purpose: 'what arrived and what was answered on your behalf',
  },
  {
    key: 'contracts',
    username: 'Cockpit Contracts',
    icon: ':page_facing_up:',
    tokenEnv: 'SLACK_BOT_TOKEN_CONTRACTS',
    purpose: 'contracts arriving, classified, filed and falling due',
  },
  {
    key: 'money',
    username: 'Cockpit Money',
    icon: ':bar_chart:',
    tokenEnv: 'SLACK_BOT_TOKEN_MONEY',
    purpose: 'revenue, invoices, payments and anything that moved oddly',
  },
  {
    key: 'sales',
    username: 'Cockpit Sales',
    icon: ':handshake:',
    tokenEnv: 'SLACK_BOT_TOKEN_SALES',
    purpose: 'opportunities, the pipeline, and clients who have gone quiet',
  },
  {
    key: 'work',
    username: 'Cockpit Work',
    icon: ':clipboard:',
    tokenEnv: 'SLACK_BOT_TOKEN_WORK',
    purpose: 'tasks, hand-offs, commitments and the daily brief',
  },
];

/** Which bot speaks for which agent. */
export const AGENT_BOT: Record<string, string> = {
  'contract-reader': 'contracts',
  'contract-redliner': 'contracts',
  'contract-chaser': 'contracts',
  'renewal-warner': 'contracts',
  'invoice-forwarder': 'money',
  'payment-chaser': 'money',
  'expense-sorter': 'money',
  'revenue-watchdog': 'money',
  'partner-health-watch': 'money',
  'opportunity-rescuer': 'sales',
  'quiet-client-watch': 'sales',
  'intro-writer': 'sales',
  'meeting-prep': 'sales',
  'inbox-triage': 'mail',
  'mail-answerer': 'mail',
  'promo-filer': 'mail',
  'code-cleaner': 'mail',
  'morning-brief': 'work',
  'weekly-review': 'work',
  'delegation-chaser': 'work',
  'commitment-tracker': 'work',
};

export function botFor(agentName: string): BotIdentity {
  const key = AGENT_BOT[agentName] ?? 'work';
  return BOTS.find((b) => b.key === key) ?? BOTS[BOTS.length - 1]!;
}

export interface BotStatus extends BotIdentity {
  /** True when this bot has a token of its own. */
  hasOwnToken: boolean;
}

export type EnvLike = Record<string, string | undefined>;

export function botStatuses(env: EnvLike = process.env): BotStatus[] {
  return BOTS.map((bot) => ({ ...bot, hasOwnToken: Boolean(env[bot.tokenEnv]) }));
}

/**
 * The token to post as, and whether the identity has to be faked.
 *
 * Its own token means it really is that bot. Otherwise the shared token posts
 * under the bot's name, which needs chat:write.customize — and if that is not
 * granted either, Slack ignores the username and it arrives as the shared bot.
 * All three are fine; only the first is genuinely a separate bot.
 */
export function resolveBot(
  agentName: string,
  env: EnvLike = process.env,
): { token: string | null; identity: BotIdentity; ownToken: boolean } {
  const identity = botFor(agentName);
  const own = env[identity.tokenEnv];
  return own
    ? { token: own, identity, ownToken: true }
    : { token: env.SLACK_BOT_TOKEN ?? null, identity, ownToken: false };
}
