import { and, desc, eq, sql } from 'drizzle-orm';
import { agents, db, marketingPosts } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { chat, loadProviderKeys, resolveProvider, type ToolSpec } from '@/lib/copilot/provider';
import { effectiveSettings, type Settings } from '@/lib/agents/settings';
import { findWins, type Win, type WinSource } from './wins';
import { linkedInCredentials, publishToLinkedIn, type Publisher } from './linkedin';
import { MAX_POST_CHARS, type Draft } from './types';

export { MAX_POST_CHARS };
export type { Draft };

/**
 * The marketing agent: his wins, written up as posts he can publish.
 *
 * It never publishes. The agent's whole output is a draft in a table; the only
 * thing that puts words on the public internet is his click, on text he has
 * read and can edit first. That is not caution about the model's writing — it
 * is that a LinkedIn post is the one action in this system with no undo.
 *
 * What makes the writing his rather than a language model's is the agent's
 * playbook and brief, which are free text on the agents screen: paste in three
 * posts he liked and the next draft sounds like them. The declined drafts go
 * in too, as what not to do again.
 */

export const AGENT_NAME = 'marketing-writer';

/**
 * Lines he should look at twice before it goes out.
 *
 * Not a filter — the draft is shown either way. A model that has been told the
 * revenue figures will occasionally use one, and the difference between a good
 * post and a leak is a number, so the number gets a label on it rather than a
 * silent edit that would hide what the model tried to say.
 */
export function riskyBits(text: string): string[] {
  const flags: string[] = [];
  if (/(?:[$₪€£]\s?\d|(?<![a-z])\d[\d,.]*\s?(?:k|m|million|thousand)?\s?(?:usd|ils|eur|dollars|shekels))/i.test(text)) {
    flags.push('It names a figure — check it is one you are happy to publish.');
  }
  if (/\b\d{1,3}(\.\d+)?\s?%/.test(text)) {
    flags.push('It quotes a percentage.');
  }
  if (/\b(confidential|nda|under wraps|not public|internal)\b/i.test(text)) {
    flags.push('It refers to something confidential.');
  }
  if (/\b(cpm|ecpm|fill rate|revenue share|rev ?share|margin|take rate)\b/i.test(text)) {
    flags.push('It uses a commercial term from the deal (CPM, rev share, margin).');
  }
  return flags;
}

const RECORD_POST: ToolSpec = {
  name: 'record_post',
  description:
    'Record one LinkedIn post, finished and ready to publish. Call it once per post. ' +
    'Write the post itself in `body`, exactly as it should appear — no headline, no commentary, no markdown.',
  parameters: {
    type: 'object',
    properties: {
      occasion: { type: 'string', description: 'What the post is about, in one line, for the list.' },
      body: { type: 'string', description: 'The post. First line is the hook. Line breaks are fine. Under 1300 characters reads best.' },
      sourceRef: { type: 'string', description: 'The ref of the win it is about, copied from the list you were given.' },
    },
    required: ['occasion', 'body'],
  },
};

function voice(settings: Settings, playbook: string, brief: string, declined: string[]): string {
  const language = typeof settings.language === 'string' ? settings.language : 'en';
  const nameClients = settings.nameClients === true;
  const hashtags = typeof settings.hashtags === 'string' ? settings.hashtags.trim() : '';
  const tone = typeof settings.tone === 'string' ? settings.tone : 'direct';

  return [
    `You write LinkedIn posts for Maor Davidovich, CEO of Adnimation — an Israeli ad-tech company doing publisher monetisation, a bidder, an ad exchange, seat leasing and display trading.`,
    `You are writing as him, in the first person. He publishes them himself; nothing you write is sent anywhere by you.`,
    ``,
    `The post:`,
    `- ${language === 'he' ? 'Hebrew' : 'English'}. Ad-tech terms stay in English either way.`,
    `- ${tone === 'warm' ? 'Warm, personal' : tone === 'formal' ? 'Measured and professional' : 'Direct and plain'}. No corporate throat-clearing, no "thrilled to announce", no emoji walls, no invented quotes.`,
    `- A hook in the first line that stands on its own, then what actually happened, then what it means for publishers or partners. Short paragraphs.`,
    `- Under 1300 characters.`,
    nameClients
      ? `- You may name the partner or client.`
      : `- Do NOT name the client or partner. Describe them — "a leading Israeli news publisher", "a European CTV partner". He will add the name himself if he wants it.`,
    hashtags ? `- End with these hashtags: ${hashtags}` : `- No hashtags.`,
    `- Never publish a figure: no revenue, no CPM, no rev share, no percentages, no contract terms. Nothing that came from inside a document.`,
    `- Never claim anything the material does not say. If a win is thin, write the smaller true post rather than the bigger invented one.`,
    playbook ? `\nHow he wants this done (his own words, they win over everything above except the rules about figures and naming):\n${playbook.slice(0, 20_000)}` : '',
    brief ? `\nStanding instructions:\n${brief.slice(0, 4000)}` : '',
    declined.length
      ? `\nPosts he declined — do not write like these again:\n${declined.map((d) => `— ${d.slice(0, 300)}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface DraftRunResult {
  ok: boolean;
  drafted: number;
  detail: string;
}

/**
 * One run: find the wins, write a post for each, store them as drafts.
 *
 * Called by the agent on its schedule and by the button on the marketing
 * screen. Both go through here so a hand-run and a scheduled run cannot drift.
 */
export async function draftFromWins(
  options: { actor: string; settings?: Settings; max?: number } = { actor: 'system' },
): Promise<DraftRunResult> {
  const [agent] = await db.select().from(agents).where(eq(agents.name, AGENT_NAME)).limit(1);
  const settings = options.settings ?? effectiveSettings(AGENT_NAME, agent?.settings ?? {});

  await loadProviderKeys();
  const provider = resolveProvider(typeof settings.provider === 'string' ? settings.provider : 'auto');
  if (!provider) return { ok: false, drafted: 0, detail: 'No model is connected — set a key on the Keys screen.' };

  const sources = (Array.isArray(settings.sources) ? (settings.sources as string[]) : ['contracts', 'deals']).filter(
    (s): s is WinSource => ['contracts', 'deals', 'mail'].includes(s),
  );
  const max = options.max ?? (typeof settings.maxPosts === 'number' ? settings.maxPosts : 2);
  const wins = await findWins({
    sources,
    days: typeof settings.lookbackDays === 'number' ? settings.lookbackDays : 30,
    limit: max,
  });
  if (wins.length === 0) return { ok: true, drafted: 0, detail: 'Nothing new worth posting about.' };

  const declined = await db
    .select({ body: marketingPosts.body })
    .from(marketingPosts)
    .where(eq(marketingPosts.status, 'declined'))
    .orderBy(desc(marketingPosts.createdAt))
    .limit(3);

  const system = voice(settings, agent?.playbook ?? '', agent?.instructions ?? '', declined.map((d) => d.body));
  const material = wins
    .map((w) => `ref: ${w.ref}\nwhat: ${w.occasion}\ndetail: ${w.detail}\nwhen: ${w.at.toISOString().slice(0, 10)}`)
    .join('\n\n');

  const res = await chat(provider, {
    system,
    turns: [
      {
        role: 'user',
        text:
          `Here is what has happened lately. Write a post for each one that deserves one — at most ${max}. ` +
          `Skip any that would make a weak post; a skipped one is not a failure.\n\n${material}`,
      },
    ],
    tools: [RECORD_POST],
    maxTokens: 2000,
  });
  if (!res.ok) return { ok: false, drafted: 0, detail: res.error };

  let drafted = 0;
  for (const call of res.toolCalls) {
    if (call.name !== 'record_post') continue;
    const body = typeof call.args.body === 'string' ? call.args.body.trim() : '';
    const occasion = typeof call.args.occasion === 'string' ? call.args.occasion.trim() : '';
    if (!body || !occasion) continue;
    const ref = typeof call.args.sourceRef === 'string' ? call.args.sourceRef : '';
    const win: Win | undefined = wins.find((w) => w.ref === ref) ?? wins[drafted];
    const saved = await storeDraft({
      sourceKind: win?.kind ?? 'manual',
      sourceRef: win?.ref ?? null,
      occasion: occasion.slice(0, 300),
      body: body.slice(0, MAX_POST_CHARS),
      model: res.model,
    });
    if (saved) drafted += 1;
  }

  await writeAudit({
    actor: options.actor,
    action: 'marketing.drafted',
    entityType: 'marketing_post',
    entityId: AGENT_NAME,
    after: { wins: wins.length, drafted, provider },
  });

  return {
    ok: true,
    drafted,
    detail: drafted
      ? `${drafted} post(s) waiting for you on the marketing screen.`
      : `Read ${wins.length} thing(s) and decided none of them made a post.`,
  };
}

/** Stores one draft; a second draft about the same win is dropped, not stacked. */
export async function storeDraft(input: {
  sourceKind: string;
  sourceRef: string | null;
  occasion: string;
  body: string;
  model?: string | null;
}): Promise<string | null> {
  if (input.sourceRef) {
    const [dup] = await db
      .select({ id: marketingPosts.id })
      .from(marketingPosts)
      .where(and(eq(marketingPosts.sourceKind, input.sourceKind), eq(marketingPosts.sourceRef, input.sourceRef)))
      .limit(1);
    if (dup) return null;
  }
  const [row] = await db
    .insert(marketingPosts)
    .values({
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      occasion: input.occasion,
      body: input.body,
      flags: riskyBits(input.body),
      model: input.model ?? null,
    })
    .returning({ id: marketingPosts.id });
  return row?.id ?? null;
}

export async function listDrafts(limit = 40): Promise<Draft[]> {
  const rows = await db
    .select()
    .from(marketingPosts)
    .orderBy(sql`case when status = 'draft' then 0 else 1 end`, desc(marketingPosts.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    sourceKind: r.sourceKind,
    sourceRef: r.sourceRef,
    occasion: r.occasion,
    body: r.editedBody ?? r.body,
    flags: r.flags ?? [],
    status: r.status,
    postedUrl: r.postedUrl,
    postedAt: r.postedAt,
    createdAt: r.createdAt,
    model: r.model,
  }));
}

export async function draftCounts(): Promise<{ waiting: number; posted: number; declined: number }> {
  const [row] = await db
    .select({
      waiting: sql<number>`count(*) filter (where status = 'draft')::int`,
      posted: sql<number>`count(*) filter (where status = 'posted')::int`,
      declined: sql<number>`count(*) filter (where status = 'declined')::int`,
    })
    .from(marketingPosts);
  return { waiting: row?.waiting ?? 0, posted: row?.posted ?? 0, declined: row?.declined ?? 0 };
}

/** His edit. Kept beside the original, so what the agent wrote is still readable. */
export async function editDraft(id: string, body: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim();
  if (!text) return { ok: false, error: 'A post cannot be empty.' };
  if (text.length > MAX_POST_CHARS) return { ok: false, error: `LinkedIn stops at ${MAX_POST_CHARS} characters.` };

  const [before] = await db.select().from(marketingPosts).where(eq(marketingPosts.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such draft.' };
  if (before.status === 'posted') return { ok: false, error: 'That one is already published.' };
  // Saving the same words again is not a change, and should not look like one
  // in the audit log.
  if ((before.editedBody ?? before.body).trim() === text) return { ok: true };

  await db
    .update(marketingPosts)
    .set({ editedBody: text, flags: riskyBits(text), updatedAt: new Date() })
    .where(eq(marketingPosts.id, id));
  await writeAudit({
    actor,
    action: 'marketing.edit',
    entityType: 'marketing_post',
    entityId: id,
    before: { body: before.editedBody ?? before.body },
    after: { body: text },
  });
  return { ok: true };
}

export async function declineDraft(id: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const [before] = await db.select().from(marketingPosts).where(eq(marketingPosts.id, id)).limit(1);
  if (!before) return { ok: false, error: 'No such draft.' };
  if (before.status === 'posted') return { ok: false, error: 'That one is already published.' };

  await db
    .update(marketingPosts)
    .set({ status: 'declined', declinedAt: new Date(), decidedBy: actor, updatedAt: new Date() })
    .where(eq(marketingPosts.id, id));
  await writeAudit({ actor, action: 'marketing.decline', entityType: 'marketing_post', entityId: id, after: { occasion: before.occasion } });
  return { ok: true };
}

export interface PublishOutcome {
  ok: boolean;
  error?: string;
  url?: string | null;
}

/**
 * His click, and the only path to LinkedIn.
 *
 * Publishing is audited before the fact as well as after — the audit row is
 * written whatever LinkedIn answers, because "we tried to publish this" is the
 * thing worth being able to look up later.
 */
export async function publishDraft(
  id: string,
  actor: string,
  publisher: Publisher = publishToLinkedIn,
): Promise<PublishOutcome> {
  const [row] = await db.select().from(marketingPosts).where(eq(marketingPosts.id, id)).limit(1);
  if (!row) return { ok: false, error: 'No such draft.' };
  if (row.status === 'posted') return { ok: false, error: 'That one is already published.', url: row.postedUrl };

  const credentials = await linkedInCredentials();
  if ('missing' in credentials) {
    return {
      ok: false,
      error: `LinkedIn is not connected — paste ${credentials.missing.join(' and ')} on the Keys screen. The text is yours to copy meanwhile.`,
    };
  }

  const text = row.editedBody ?? row.body;
  const result = await publisher(text, credentials);

  await writeAudit({
    actor,
    action: result.ok ? 'marketing.published' : 'marketing.publish_failed',
    entityType: 'marketing_post',
    entityId: id,
    after: { text: text.slice(0, 2000), url: result.url ?? null, error: result.error ?? null },
  });

  if (!result.ok) return { ok: false, error: result.error ?? 'LinkedIn refused it.' };

  await db
    .update(marketingPosts)
    .set({ status: 'posted', postedAt: new Date(), postedUrl: result.url ?? null, decidedBy: actor, updatedAt: new Date() })
    .where(eq(marketingPosts.id, id));
  return { ok: true, url: result.url ?? null };
}

/** Whether the PUBLISH button can do anything yet, for the screen to say so. */
export async function linkedInReady(): Promise<{ ready: boolean; missing: string[] }> {
  const credentials = await linkedInCredentials();
  return 'missing' in credentials ? { ready: false, missing: credentials.missing } : { ready: true, missing: [] };
}

/** Used by the agent's condition: is there anything to write about at all? */
export async function hasMaterial(settings: Settings): Promise<{ count: number; first: string | null }> {
  const sources = (Array.isArray(settings.sources) ? (settings.sources as string[]) : ['contracts', 'deals']).filter(
    (s): s is WinSource => ['contracts', 'deals', 'mail'].includes(s),
  );
  const wins = await findWins({
    sources,
    days: typeof settings.lookbackDays === 'number' ? settings.lookbackDays : 30,
    limit: typeof settings.maxPosts === 'number' ? settings.maxPosts : 2,
  });
  return { count: wins.length, first: wins[0]?.occasion ?? null };
}
