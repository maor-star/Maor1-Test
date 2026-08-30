import { eq } from 'drizzle-orm';
import { db, opportunities } from '@/lib/db';
import { createSlackAdapter, parsePermalink } from '@/lib/integrations/slack';
import type { SlackAdapter } from '@/lib/integrations/types';
import type { OpportunityInput } from './rules';

/**
 * Capturing something out of Slack.
 *
 * A permalink is the whole input. Slack puts the channel and the timestamp in
 * the URL, so "copy link to message" in Slack and paste here is the entire
 * interaction — he never has to retype what somebody said.
 *
 * The bot reads the thread with the history scopes it holds, which covers
 * public and private channels it has been added to, plus its own DMs. It
 * cannot read his personal DMs with other people: a bot token never can, and
 * the honest response there is to say so and keep the text he pasted, rather
 * than to fail and lose the capture.
 */

export interface SlackCaptureResult {
  ok: boolean;
  id?: string;
  /** Set when the message could not be read but the opportunity was still saved. */
  warning?: string;
  error?: string;
}

export async function captureSlackPermalink(
  permalink: string,
  createdBy: string,
  overrides: Partial<OpportunityInput> = {},
  slack: SlackAdapter = createSlackAdapter(),
): Promise<SlackCaptureResult> {
  const parsed = parsePermalink(permalink);
  if (!parsed) {
    return {
      ok: false,
      error: 'That is not a Slack message link. In Slack: More actions → Copy link.',
    };
  }

  let excerpt: string | null = null;
  let author: string | null = null;
  let at: Date | null = null;
  let warning: string | undefined;

  try {
    const thread = await slack.readThread(parsed.channel, parsed.ts);
    const first = thread[0];
    if (first) {
      excerpt = first.text.slice(0, 4000);
      author = first.authorName;
      at = first.at;
    } else {
      warning = 'Slack returned nothing for that link — saved without the message text.';
    }
  } catch {
    // Almost always the bot not being in that conversation. Saving anyway is
    // the right trade: he keeps the capture and the link, and can paste the
    // text himself.
    warning =
      'Could not read that conversation — the bot is not in it. Saved with the link only; ' +
      'add the bot to the channel to capture the text too.';
  }

  const title = overrides.title?.trim() || excerpt?.split('\n')[0]?.slice(0, 200) || 'From Slack';

  try {
    const [created] = await db
      .insert(opportunities)
      .values({
        title,
        kind: overrides.kind ?? 'other',
        status: overrides.status ?? 'new',
        note: overrides.note ?? null,
        counterparty: overrides.counterparty ?? author,
        valueCents: overrides.valueCents ?? null,
        source: 'slack',
        sourceRef: `${parsed.channel}:${parsed.ts}`,
        sourceUrl: permalink,
        sourceExcerpt: excerpt,
        sourceAt: at,
        createdBy,
      })
      .onConflictDoUpdate({
        target: [opportunities.source, opportunities.sourceRef],
        set: { archivedAt: null, lastTouchedAt: new Date() },
      })
      .returning({ id: opportunities.id });

    if (!created) return { ok: false, error: 'Could not save it' };
    return { ok: true, id: created.id, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save it' };
  }
}

/**
 * The same capture, driven by a Slack reaction rather than a paste.
 *
 * This is what the webhook calls: he adds the agreed emoji to any message in a
 * conversation the bot can see, and it lands here. Used by
 * /api/webhooks/slack — see that route for why it is off until the signing
 * secret is set.
 */
export async function captureSlackReaction(
  channel: string,
  ts: string,
  createdBy: string,
  slack: SlackAdapter = createSlackAdapter(),
): Promise<SlackCaptureResult> {
  const permalink = `https://slack.com/archives/${channel}/p${ts.replace('.', '')}`;
  return captureSlackPermalink(permalink, createdBy, {}, slack);
}

/** Whether a conversation has already been captured, so the UI can say so. */
export async function alreadyCaptured(channel: string, ts: string): Promise<boolean> {
  const [row] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.sourceRef, `${channel}:${ts}`))
    .limit(1);
  return row !== undefined;
}
