import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, delegations, people, tasks } from '@/lib/db';
import { createGmailAdapter } from '@/lib/integrations/gmail';
import { createSlackAdapter } from '@/lib/integrations/slack';
import type { FoundReply, GmailAdapter, SlackAdapter } from '@/lib/integrations/types';
import { OPEN_DELEGATION_STATUSES } from './service';
import { matchTerms } from './reply-match';

export { matchTerms };

/**
 * The delegation reply radar.
 *
 * A delegation is answered somewhere else: Mor replies in the Slack thread the
 * cockpit posted, or she answers by email. Until those two places are read,
 * "no movement in four days" only means "nobody told the cockpit" — and the
 * tracker exists precisely to stop handed-off work from falling quietly.
 *
 * Slack is checked first because the cockpit posted the thread and therefore
 * knows exactly where to look; email is the fallback, matched on who sent it,
 * when, and whether it mentions the work. A found reply is movement, so the
 * delegation's clock resets and its status moves off `sent`.
 */

export interface ReplyCheck {
  checked: number;
  found: number;
  /** Set when neither channel is configured — the honest reason for zero. */
  unavailable: string | null;
}

async function probe(
  row: {
    slackMessageUrl: string | null;
    delegatedAt: Date;
    personEmail: string;
    personSlackId: string | null;
    taskTitle: string | null;
    note: string | null;
  },
  slack: SlackAdapter,
  gmail: GmailAdapter,
): Promise<FoundReply | null> {
  if (row.slackMessageUrl) {
    // Skip our own bot's post; anything else in the thread is an answer.
    const reply = await slack
      .findThreadReply(row.slackMessageUrl, process.env.SLACK_CEO_USER_ID)
      .catch(() => null);
    if (reply && reply.at > row.delegatedAt) return reply;
  }

  if (!gmail.configured) return null;

  return gmail
    .findReply({
      fromEmail: row.personEmail,
      since: row.delegatedAt,
      terms: matchTerms(row.taskTitle, row.note),
    })
    .catch(() => null);
}

/**
 * Looks for an answer to every open delegation that has not had one yet.
 *
 * Re-checking a delegation that already has a reply would overwrite the first
 * answer with the latest chatter, so answered ones are left alone — the first
 * reply is the one that mattered.
 */
export async function checkForReplies(
  slack: SlackAdapter = createSlackAdapter(),
  gmail: GmailAdapter = createGmailAdapter(),
  now = new Date(),
): Promise<ReplyCheck> {
  const rows = await db
    .select({
      id: delegations.id,
      slackMessageUrl: delegations.slackMessageUrl,
      delegatedAt: delegations.delegatedAt,
      note: delegations.note,
      status: delegations.status,
      personEmail: people.email,
      personSlackId: people.slackId,
      taskTitle: tasks.title,
    })
    .from(delegations)
    .innerJoin(people, eq(delegations.delegatedTo, people.id))
    .leftJoin(tasks, eq(delegations.taskId, tasks.id))
    .where(
      and(
        inArray(delegations.status, [...OPEN_DELEGATION_STATUSES]),
        isNull(delegations.replyAt),
      ),
    )
    .orderBy(desc(delegations.delegatedAt));

  const slackUsable = slack.name === 'slack' && Boolean(process.env.SLACK_BOT_TOKEN);
  if (!slackUsable && !gmail.configured) {
    return {
      checked: 0,
      found: 0,
      unavailable:
        'Neither Slack nor Gmail is connected, so replies cannot be read. Set SLACK_BOT_TOKEN, ' +
        'or GOOGLE_SERVICE_ACCOUNT_KEY with GMAIL_MAILBOX, to turn the radar on.',
    };
  }

  let found = 0;

  for (const row of rows) {
    const reply = await probe(row, slack, gmail);

    if (!reply) {
      await db
        .update(delegations)
        .set({ repliesCheckedAt: now })
        .where(eq(delegations.id, row.id));
      continue;
    }

    found += 1;

    // An answer is movement, so the staleness clock resets to the reply. The
    // status only moves forward — a delegation already in progress is not
    // demoted by a reply arriving.
    const status = row.status === 'sent' || row.status === 'stale' ? 'acknowledged' : row.status;

    await db
      .update(delegations)
      .set({
        repliesCheckedAt: now,
        replyChannel: reply.channel,
        replyAt: reply.at,
        replyAuthor: reply.author,
        replyExcerpt: reply.excerpt,
        replyUrl: reply.url,
        status,
        lastMovementAt: reply.at,
      })
      .where(eq(delegations.id, row.id));
  }

  return { checked: rows.length, found, unavailable: null };
}
