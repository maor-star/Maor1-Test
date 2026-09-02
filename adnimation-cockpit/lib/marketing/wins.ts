import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { contracts, db, mailThreads, marketingPosts, pipelineClients } from '@/lib/db';

/**
 * What happened lately that is worth telling the world about.
 *
 * Three sources, in descending order of how sure we are that something real
 * occurred: a contract that reached `signed`, a deal that went live or was
 * closed as won, and — the loosest — a mail thread whose subject reads like an
 * achievement. The looseness is the point: the model decides whether the third
 * kind is a post, and he decides whether the post goes out. Neither of them
 * can invent the first two.
 *
 * A win that already has a draft is not a win again. That is enforced here and
 * by a unique index, because the failure mode of a weekly agent is four posts
 * about the same signature.
 */

export const WIN_SOURCES = ['contracts', 'deals', 'mail'] as const;
export type WinSource = (typeof WIN_SOURCES)[number];

export interface Win {
  kind: WinSource;
  /** Stable id of the thing itself, so the same win is never drafted twice. */
  ref: string;
  /** One line: what happened. */
  occasion: string;
  /** Everything the model may use, already trimmed to what is safe to know. */
  detail: string;
  at: Date;
  /** The other side's name, when there is one. */
  counterparty: string | null;
}

/**
 * Subjects that read like something went right.
 *
 * Deliberately short and deliberately English-and-Hebrew: a longer list finds
 * more, and most of what it finds is somebody else's newsletter.
 */
const ACHIEVEMENT = /\b(signed|countersigned|fully executed|welcome aboard|kick ?off|went live|now live|launch(ed)?|partnership|award|milestone|renewal|renewed|expansion)\b/i;
const ACHIEVEMENT_HE = /(נחתם|חתמנו|עלה לאוויר|השקה|שותפות|פרס|אבן דרך|חידוש|הרחבה)/;

/** Mail that is plainly not an achievement however the subject reads. */
const NOT_A_WIN = /(unsubscribe|newsletter|invoice|receipt|statement|payment failed|out of office|webinar|noreply|no-reply)/i;

export interface FindWinsOptions {
  sources?: WinSource[];
  /** How far back to look. */
  days?: number;
  limit?: number;
}

export async function findWins(options: FindWinsOptions = {}): Promise<Win[]> {
  const sources = options.sources?.length ? options.sources : [...WIN_SOURCES];
  const days = Math.min(120, Math.max(1, options.days ?? 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const limit = Math.min(20, Math.max(1, options.limit ?? 6));

  const wins: Win[] = [];

  if (sources.includes('contracts')) {
    const rows = await db
      .select()
      .from(contracts)
      .where(and(isNull(contracts.archivedAt), eq(contracts.status, 'signed'), gte(contracts.statusChangedAt, since)))
      .orderBy(desc(contracts.statusChangedAt))
      .limit(limit * 2);
    for (const c of rows) {
      wins.push({
        kind: 'contracts',
        ref: c.id,
        occasion: `Signed with ${c.counterpartyName}`,
        // The category says which side of the business it is, which is the
        // part of a contract that is safe to talk about. Terms are not here on
        // purpose: nothing in a draft should come from inside the document.
        detail: `A ${c.category} agreement with ${c.counterpartyName} was signed on ${c.statusChangedAt.toISOString().slice(0, 10)}.`,
        at: c.statusChangedAt,
        counterparty: c.counterpartyName,
      });
    }
  }

  if (sources.includes('deals')) {
    const rows = await db
      .select()
      .from(pipelineClients)
      .where(
        and(
          isNull(pipelineClients.archivedAt),
          gte(pipelineClients.updatedAt, since),
          sql`(${pipelineClients.stage} = 'live' or (${pipelineClients.closeOutcome} = 'won'))`,
        ),
      )
      .orderBy(desc(pipelineClients.updatedAt))
      .limit(limit * 2);
    for (const d of rows) {
      wins.push({
        kind: 'deals',
        ref: d.id,
        occasion: d.closeOutcome === 'won' ? `Won ${d.name}` : `${d.name} is live`,
        detail:
          `${d.name}${d.domain ? ` (${d.domain})` : ''} — a ${d.clientType} partner — ` +
          `${d.closeOutcome === 'won' ? 'closed as won' : 'reached the live stage'} on ${(d.closedAt ?? d.updatedAt).toISOString().slice(0, 10)}.`,
        at: d.closedAt ?? d.updatedAt,
        counterparty: d.name,
      });
    }
  }

  if (sources.includes('mail')) {
    const rows = await db
      .select()
      .from(mailThreads)
      .where(and(gte(mailThreads.lastMessageAt, since), eq(mailThreads.knownContact, true)))
      .orderBy(desc(mailThreads.lastMessageAt))
      .limit(200);
    for (const m of rows) {
      const subject = m.subject ?? '';
      if (NOT_A_WIN.test(subject)) continue;
      if (!ACHIEVEMENT.test(subject) && !ACHIEVEMENT_HE.test(subject)) continue;
      wins.push({
        kind: 'mail',
        ref: m.threadId,
        occasion: subject.slice(0, 200),
        detail: `From ${m.counterpartName ?? m.counterpartEmail ?? 'a contact'}${m.knownCompany ? ` at ${m.knownCompany}` : ''}: “${subject}”. ${m.snippet?.slice(0, 300) ?? ''}`,
        at: m.lastMessageAt,
        counterparty: m.knownCompany ?? m.counterpartName ?? null,
      });
    }
  }

  const fresh = await withoutDrafted(wins);
  return fresh.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Drops the wins that already have a draft, posted or declined. */
export async function withoutDrafted(wins: Win[]): Promise<Win[]> {
  if (wins.length === 0) return [];
  const existing = await db
    .select({ kind: marketingPosts.sourceKind, ref: marketingPosts.sourceRef })
    .from(marketingPosts);
  const seen = new Set(existing.map((e) => `${e.kind}:${e.ref}`));
  return wins.filter((w) => !seen.has(`${w.kind}:${w.ref}`));
}
