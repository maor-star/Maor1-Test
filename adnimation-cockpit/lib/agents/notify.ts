import { eq } from 'drizzle-orm';
import { agents, db } from '@/lib/db';
import { createSlackAdapter } from '@/lib/integrations/slack';
import { postingIdentity, resolveBot } from './slack-bots';
import type { RunReport } from './types';

/**
 * Telling him what an agent did, in Slack.
 *
 * Per agent, and off by default. A notification for every action is a
 * notification he stops reading, and an agent he has stopped reading about is
 * an agent running unobserved — which is worse than one that never told him at
 * all, because he thinks he is watching it.
 *
 * Only work speaks. An agent that halted, found nothing, or was switched off
 * says nothing at all: he asked for a message about what was done and nothing
 * else, and he is right — a stream of "stopped: this agent is switched off" is
 * how a channel becomes noise and the one message that mattered gets skimmed
 * past. A halt or a failure is on the agents screen, in the run log, which is
 * where he looks when something is not happening.
 */

export interface NotifyOptions {
  /** Say something even when the agent is set not to notify. */
  force?: boolean;
}

export function reportLine(agentName: string, report: RunReport): string | null {
  const did = report.actions.filter((a) => a.performed);

  switch (report.outcome) {
    case 'completed':
      // Nothing happened is not news.
      if (did.length === 0) return null;
      return (
        `:robot_face: *${agentName}* did ${did.length === 1 ? 'this' : 'these'}:\n` +
        did.map((a) => `• ${a.detail}`).join('\n')
      );
    // Nothing happened is not news, and neither is a reason it did not.
    case 'halted':
    case 'failed':
    case 'dry_run':
      return null;
  }
}

export async function notifyRun(
  agentId: string,
  agentName: string,
  report: RunReport,
  options: NotifyOptions = {},
): Promise<{ sent: boolean; reason?: string }> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const wants = agent?.notifySlack ?? false;

  if (!wants && !options.force) return { sent: false, reason: 'notifications off' };

  const text = reportLine(agentName, report);
  if (!text) return { sent: false, reason: 'nothing worth saying' };

  const target = process.env.SLACK_CEO_USER_ID;
  if (!target) return { sent: false, reason: 'no Slack destination configured' };

  // Which bot speaks for this agent, and with whose token. Its own app where
  // it has one; otherwise its carrier's, under its own name and icon.
  const bot = resolveBot(agentName);
  if (!bot.token) return { sent: false, reason: 'no Slack token configured' };
  const as = postingIdentity(bot);

  const provenance =
    bot.posture === 'own'
      ? ''
      : bot.posture === 'carried'
        ? ` · via ${bot.via?.username ?? 'another bot'}`
        : ' · posted by the shared bot';

  const result = await createSlackAdapter(bot.token)
    .postMessage({
      target,
      text,
      contextLines: [`${bot.identity.username} · ${agentName} · ${report.outcome}${provenance}`],
      ...(as ? { username: as.username, icon: as.icon } : {}),
    })
    .catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : 'slack failed',
    }));

  return result.ok ? { sent: true } : { sent: false, reason: 'error' in result ? result.error : 'slack refused it' };
}
