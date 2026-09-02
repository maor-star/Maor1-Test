/**
 * A separate Slack bot per kind of work.
 *
 * One bot posting about invoices, contracts, revenue and mail is one stream he
 * learns to skim. Separate identities make each one skimmable on its own — and
 * more usefully, let him mute the noisy one without losing the one that matters.
 *
 * Three real apps exist in the workspace, each with its own token: Mailroom,
 * Paperwork and Rainmaker. The other two streams — Ledger and Foreman — have no
 * app of their own, so they post through a carrier's token under their own name
 * and icon, which needs `chat:write.customize`. They are visually separate and
 * arrive in the carrier's direct message.
 *
 * So there are three postures, and the code says which one it used rather than
 * pretending they are the same:
 *
 *   own      its own app. Genuinely that bot, its own DM, mutable on its own.
 *   carried  another app's token, posting under this bot's name and icon.
 *   shared   the original cockpit bot, as itself. The last resort.
 *
 * Which bot carries which matters. Mail is the noisiest stream — auto-replies,
 * promotional filing, triage — so nothing else rides on Mailroom: muting the
 * noise must not also mute the tasks. Ledger rides on Paperwork and Foreman on
 * Rainmaker, both low-volume.
 */

export interface BotIdentity {
  key: string;
  /** Shown as the sender in Slack. Matches the app name where it has one. */
  username: string;
  icon: string;
  /** Env var holding this bot's own token, when it has one. */
  tokenEnv: string;
  purpose: string;
  /** The bot whose token this one borrows when it has no app of its own. */
  carrier?: string;
}

export const BOTS: BotIdentity[] = [
  {
    key: 'mail',
    username: 'Mailroom',
    icon: ':envelope:',
    tokenEnv: 'SLACK_BOT_TOKEN_MAIL',
    purpose: 'what arrived and what was answered on your behalf',
  },
  {
    key: 'contracts',
    username: 'Paperwork',
    icon: ':page_facing_up:',
    tokenEnv: 'SLACK_BOT_TOKEN_CONTRACTS',
    purpose: 'contracts arriving, classified, filed and falling due',
  },
  {
    key: 'sales',
    username: 'Rainmaker',
    icon: ':handshake:',
    tokenEnv: 'SLACK_BOT_TOKEN_SALES',
    purpose: 'opportunities, the pipeline, and clients who have gone quiet',
  },
  {
    key: 'money',
    username: 'Ledger',
    icon: ':bar_chart:',
    tokenEnv: 'SLACK_BOT_TOKEN_MONEY',
    purpose: 'revenue, invoices, payments and anything that moved oddly',
    carrier: 'contracts',
  },
  {
    key: 'work',
    username: 'Foreman',
    icon: ':clipboard:',
    tokenEnv: 'SLACK_BOT_TOKEN_WORK',
    purpose: 'tasks, hand-offs, commitments and the daily brief',
    carrier: 'sales',
  },
];

/** Which bot speaks for which agent. */
export const AGENT_BOT: Record<string, string> = {
  'contract-reader': 'contracts',
  'contract-redliner': 'contracts',
  'contract-chaser': 'contracts',
  'renewal-warner': 'contracts',
  'invoice-forwarder': 'money',
  'revenue-watchdog': 'money',
  'partner-health-watch': 'money',
  'inbox-triage': 'mail',
  'mail-answerer': 'mail',
  'morning-brief': 'work',
  'weekly-review': 'work',
  'delegation-chaser': 'work',
  'commitment-tracker': 'work',
  // Autonomous management, added when the roster was reworked.
  'activity-watch': 'money',
  'core-client-guardian': 'sales',
  'deal-mover': 'sales',
  'task-hygiene': 'work',
  'contact-harvester': 'sales',
  'systems-watch': 'work',
  'autopilot': 'work',
};

export function botFor(agentName: string): BotIdentity {
  const key = AGENT_BOT[agentName] ?? 'work';
  return BOTS.find((b) => b.key === key) ?? BOTS[BOTS.length - 1]!;
}

export type EnvLike = Record<string, string | undefined>;

export type BotStatus = BotIdentity & { hasOwnToken: boolean; postsAs: string | null };

export function botStatuses(env: EnvLike = process.env): BotStatus[] {
  return BOTS.map((bot) => {
    const hasOwnToken = Boolean(env[bot.tokenEnv]);
    const carrier = bot.carrier ? BOTS.find((b) => b.key === bot.carrier) : undefined;
    const carried = !hasOwnToken && carrier && env[carrier.tokenEnv];
    return { ...bot, hasOwnToken, postsAs: carried ? carrier.username : null };
  });
}

/**
 * The token to post as, and how honest that identity is.
 *
 * `posture` is the part callers must not ignore: a message sent under the
 * shared bot arrives as the shared bot whatever we asked Slack to call it, so
 * the name is only reliable for `own` and `carried`.
 */
export function resolveBotByKey(
  key: string,
  env: EnvLike = process.env,
): {
  token: string | null;
  identity: BotIdentity;
  ownToken: boolean;
  posture: 'own' | 'carried' | 'shared' | 'none';
  via: BotIdentity | null;
} {
  const identity = BOTS.find((b) => b.key === key) ?? BOTS[BOTS.length - 1]!;

  const own = env[identity.tokenEnv];
  if (own) return { token: own, identity, ownToken: true, posture: 'own', via: null };

  const carrier = identity.carrier ? BOTS.find((b) => b.key === identity.carrier) : undefined;
  const carried = carrier ? env[carrier.tokenEnv] : undefined;
  if (carrier && carried) {
    return { token: carried, identity, ownToken: false, posture: 'carried', via: carrier };
  }

  const shared = env.SLACK_BOT_TOKEN;
  if (shared) return { token: shared, identity, ownToken: false, posture: 'shared', via: null };

  return { token: null, identity, ownToken: false, posture: 'none', via: null };
}

/** The same, for the bot that speaks for an agent. */
export function resolveBot(agentName: string, env: EnvLike = process.env) {
  return resolveBotByKey(botFor(agentName).key, env);
}

/**
 * The name and icon to post under, or null when the token cannot carry them.
 *
 * Only the tokens we know hold `chat:write.customize` are asked to rename
 * themselves. Asking the shared bot to do it would either be ignored or
 * refused, and a notification that fails to send is worse than one that arrives
 * under the wrong name.
 */
export function postingIdentity(resolved: {
  identity: BotIdentity;
  posture: string;
}): { username: string; icon: string } | null {
  if (resolved.posture !== 'own' && resolved.posture !== 'carried') return null;
  return { username: resolved.identity.username, icon: resolved.identity.icon };
}
