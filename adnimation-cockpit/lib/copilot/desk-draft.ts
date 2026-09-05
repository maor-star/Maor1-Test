import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, deskDrafts } from '@/lib/db';
import { ask } from '@/lib/integrations/claude';
import { getLearning } from '@/lib/agents/learning';
import { readThread } from '@/lib/mail/read';
import { summariseContract } from '@/lib/contracts/summarise';
import type { DeskItem } from '@/lib/copilot/desk-rules';

/**
 * The answer he would have written, written for him.
 *
 * The point of the desk is not the list — he could already see all of this,
 * spread over six screens. The point is that every card arrives with the reply
 * already drafted, so the work left is reading it and pressing send. A card
 * with no draft on it is a card he has to think about from nothing, which is
 * the thing this screen exists to stop.
 *
 * Three things make a draft his rather than a model's: the voice profile the
 * mail agent learned from a year of his own replies, the thread itself, and
 * the standing rules he has given the agents. Nothing here sends anything —
 * every draft lands in a box he can edit, and only his click leaves the
 * building (CLAUDE.md §6, NEVER_AUTOMATIC).
 */

export const deskDraftSchema = z.object({
  /**
   * What the other side actually said, and where this stands — two or three
   * sentences of background.
   *
   * He asked for this and he was right to: a card that opens with a suggested
   * reply asks him to trust a recommendation about a conversation he cannot
   * see. The snippet on the card is one clipped line of the last message; this
   * is what the thread is about.
   */
  background: z.string(),
  /** The suggested message, ready to send, or the decision, ready to record. */
  text: z.string(),
  /** One line: why this is the answer. He reads this before the text. */
  why: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  /**
   * A contract's verdict: whether it is fine to proceed with, and the points
   * worth arguing about. Absent for everything that is not a document.
   */
  verdict: z
    .object({
      ok: z.boolean(),
      points: z.array(z.string()).max(8),
    })
    .nullish(),
  /**
   * Who this would be better handed to, in his own words ("Ravit", "finance"),
   * or null when it is his to answer. A suggestion, never an instruction: the
   * hand-over only happens when he picks a person and presses the button.
   */
  handTo: z.string().nullish(),
});

export type DeskDraft = z.infer<typeof deskDraftSchema>;

const VOICE_FALLBACK = `Short, direct, warm but not chatty. No corporate padding,
no promises he has not made, no figures he has not given. Answers in the language
the other person wrote in — Hebrew to Hebrew, English to English. Signs off as Maor.`;

/** What he sounds like, learned from his own replies where that has run. */
async function voice(): Promise<string> {
  const learned = await getLearning('mail-answerer').catch(() => null);
  const profile = learned?.profile?.trim();
  return profile && profile.length > 40 ? profile : VOICE_FALLBACK;
}

const SYSTEM = (profileText: string) => `You are preparing the CEO of Adnimation —
Maor Davidovich, an Israeli ad-tech company — for one thing on his desk. He will
read what you write, change what he wants, and press the button. You never send
anything yourself.

Write in his voice. This is how he writes, learned from his own replies:
${profileText}

Rules that do not bend:
· Never commit him to a number, a price, a date or a discount he has not given you.
· Never agree to terms on his behalf. Where the answer needs a decision only he
  can make, write the message that asks the question or buys the time, and say so
  in "why".
· Write in the language the other side used.
· Short. Two or three sentences is almost always right, and the whole answer
  has to fit in one JSON object — a reply that runs long comes back cut in half
  and is no use to him. Keep "why" to one line and each verdict point to one.
· Where you are guessing, say what you assumed in "why" rather than hiding it in
  confident prose. Low confidence is a useful answer; a confident wrong one is not.

Every answer carries a "background" of two or three sentences: who they are,
what they actually asked or said, and where the thing stands. Write it as you
would brief him walking into the room — he has not read the thread, and a
recommendation about a conversation he cannot see is one he cannot judge. Say
what is known, not what you assume.

Set "handTo" to the person or team this really belongs to when it is plainly not
his — finance, ad ops, a named colleague — and null when it is his to answer.`;

/** The prompt for one item, with as much of the real thing as can be fetched. */
async function promptFor(item: DeskItem): Promise<string> {
  const head = [
    `Channel: ${item.channel}`,
    `Who it is with: ${item.who}`,
    `What it is: ${item.title}`,
    `Waiting: ${item.waitingDays} day(s)`,
    item.context ? `What the cockpit knows: ${item.context}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (item.channel === 'mail' && item.target) {
    const thread = await readThread(item.target).catch(() => null);
    const body = thread?.messages
      .map((m) => `${m.fromMe ? 'Maor' : (m.from || item.who)}: ${m.text.slice(0, 4000)}`)
      .join('\n\n---\n\n');
    return [
      head,
      '',
      body ? `The conversation, oldest first:\n${body}` : 'The body could not be fetched — work from the summary above and keep the reply cautious.',
      '',
      'Write the reply he should send. Answer as JSON: ' +
        '{"background": "two or three sentences on what they wrote and where it stands", ' +
        '"text": "the reply", "why": "one line", "confidence": "high|medium|low", "handTo": null}',
    ].join('\n');
  }

  if (item.channel === 'contract') {
    return [
      head,
      '',
      'Read what is known about this contract and give him a verdict: is it fine to ' +
        'proceed with, or not, and what is worth arguing about. Then write the message ' +
        'he should send back to the counterparty — accepting, or asking for the changes ' +
        'you listed. If the document itself has not been read, say so in "why" and keep ' +
        'the verdict to what the record supports.',
      '',
      'Answer as JSON: {"background": "two or three sentences on what this contract is and where it stands", ' +
        '"text": "the message to send", "why": "one line", ' +
        '"confidence": "high|medium|low", "verdict": {"ok": boolean, "points": ["..."]}, "handTo": null}',
    ].join('\n');
  }

  if (item.channel === 'slack') {
    return [
      head,
      '',
      `Write the Slack message he should post in #${item.target ?? 'the channel'} in answer to this. ` +
        'Slack, so shorter and plainer than mail, and no sign-off.',
      '',
      'Answer as JSON: {"background": "two or three sentences on what was said in the channel", ' +
        '"text": "the message", "why": "one line", "confidence": "high|medium|low", "handTo": null}',
    ].join('\n');
  }

  if (item.channel === 'delegation') {
    return [
      head,
      '',
      'He handed this to somebody and nothing has come back. Write the chase — one ' +
        'message, friendly, that asks where it stands and makes the next step obvious. ' +
        'Not a reprimand.',
      '',
      'Answer as JSON: {"background": "two or three sentences on what he handed over and to whom", ' +
        '"text": "the message", "why": "one line", "confidence": "high|medium|low", "handTo": null}',
    ].join('\n');
  }

  // A deal or a task: what he should actually do next, said as one move.
  return [
    head,
    '',
    'This has gone quiet or is late. Say what the next move is — one concrete action ' +
      'he can take today, not a plan. If the move is a message to somebody, write that ' +
      'message as the text so he can send it.',
    '',
    'Answer as JSON: {"background": "two or three sentences on what this is and where it stands", ' +
      '"text": "the next move, or the message to send", "why": "one line", ' +
      '"confidence": "high|medium|low", "handTo": null}',
  ].join('\n');
}

export type DraftResult =
  | { ok: true; draft: DeskDraft }
  | { ok: false; error: string; needsKey?: boolean };

/**
 * One draft for one item.
 *
 * A contract is read first where there is a document to read — a verdict on a
 * contract nobody opened is worth nothing, and saying "it looks fine" about a
 * document you have not seen is the single most expensive thing this screen
 * could do.
 */
export async function draftForItem(item: DeskItem): Promise<DraftResult> {
  const profileText = await voice();

  let extra = '';
  if (item.channel === 'contract' && item.entityId) {
    const read = await summariseContract(item.entityId).catch(() => null);
    if (read && read.ok && read.summary) {
      extra = `\n\nThe document itself, read from Drive:\n${JSON.stringify(read.summary)}`;
    }
  }

  /*
   * A contract answer is a verdict, its points, and the message — three times
   * the length of a mail reply, and it has to fit inside one JSON object. Cut
   * off at the ceiling it comes back as an unterminated string, so the ceiling
   * is set to the work rather than the other way round.
   */
  const result = await ask<DeskDraft>((await promptFor(item)) + extra, {
    system: SYSTEM(profileText),
    schema: deskDraftSchema,
    maxTokens: item.channel === 'contract' ? 4000 : 2000,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, ...(result.needsKey ? { needsKey: true } : {}) };
  }
  if (!result.parsed) return { ok: false, error: 'Claude did not return a draft' };
  return { ok: true, draft: result.parsed };
}

/** What is stored against an item, and whether it still answers it. */
export interface StoredDraft {
  itemId: string;
  fingerprint: string;
  draft: DeskDraft;
  createdAt: Date;
  actedAt: Date | null;
  outcome: string | null;
}

export async function storedDrafts(): Promise<Map<string, StoredDraft>> {
  const rows = await db.select().from(deskDrafts);
  const out = new Map<string, StoredDraft>();
  for (const r of rows) {
    out.set(r.itemId, {
      itemId: r.itemId,
      fingerprint: r.fingerprint,
      draft: r.draft as DeskDraft,
      createdAt: r.createdAt,
      actedAt: r.actedAt,
      outcome: r.outcome,
    });
  }
  return out;
}

export async function saveDraft(item: DeskItem, draft: DeskDraft): Promise<void> {
  await db
    .insert(deskDrafts)
    .values({
      itemId: item.id,
      channel: item.channel,
      fingerprint: item.fingerprint,
      draft,
    })
    .onConflictDoUpdate({
      target: deskDrafts.itemId,
      set: {
        channel: item.channel,
        fingerprint: item.fingerprint,
        draft,
        createdAt: new Date(),
        // A redraft is a fresh answer to a moved conversation, so what he did
        // with the previous one is no longer what happened to this one.
        actedAt: null,
        outcome: null,
      },
    });
}

/** What he did with it, kept so the card can say so and the desk can drop it. */
export async function markActed(itemId: string, outcome: string): Promise<void> {
  await db
    .update(deskDrafts)
    .set({ actedAt: new Date(), outcome })
    .where(and(eq(deskDrafts.itemId, itemId)));
}
