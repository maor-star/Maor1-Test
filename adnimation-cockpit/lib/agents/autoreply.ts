import { z } from 'zod';
import { ask } from '@/lib/integrations/claude';

/**
 * Answering the easy mail, and — much more importantly — not answering the rest.
 *
 * Every other detector here decides where something goes. This one puts words
 * in his mouth to people outside the company, so the whole design is about the
 * cases it must refuse. A reply he would not have sent is not a small error:
 * it commits him, in writing, to someone who will hold him to it.
 *
 * Two gates, and both must pass:
 *
 *   1. Rules, here, that no model can talk its way past. Anything about money,
 *      contracts, legal, staff, or anyone senior is out — whatever it looks
 *      like, whatever it says.
 *   2. The model's own judgement, which may only ever narrow what the rules
 *      already allowed.
 *
 * A refusal needs no justification. An answer needs both gates.
 */

export interface ReplyCandidate {
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  fromName: string | null;
  /** The whole thread, oldest first, so a question already answered is seen. */
  messages: { fromMe: boolean; text: string }[];
  knownCompany: string | null;
}

/**
 * Subjects that are never answered automatically, however simple they read.
 *
 * Each of these is something where a wrong or premature answer costs money, a
 * relationship, or a legal position — and where "I'll come back to you" from a
 * machine is worse than silence.
 */
const NEVER: [RegExp, string][] = [
  [/\b(contract|agreement|msa|nda|addendum|amendment|terms|sign|signature|legal|lawyer|counsel)\b/i, 'contractual or legal'],
  [/\b(invoice|payment|refund|credit|billing|price|pricing|rate|discount|quote|budget|cost|fee|commission|rev.?share)\b/i, 'about money'],
  [/\b(salary|raise|bonus|hire|hiring|fired|resign|notice period|hr|employment|candidate)\b/i, 'about people or pay'],
  [/\b(complaint|dispute|escalat|breach|violation|sue|claim|urgent|asap|immediately)\b/i, 'a complaint or urgent'],
  [/\b(acquisition|merger|investment|term sheet|due diligence|valuation|equity|shares)\b/i, 'corporate'],
  [/\b(gdpr|dpa|privacy|security incident|data breach|audit)\b/i, 'compliance'],
  [/\b(partnership|exclusive|commit|guarantee|sla|deadline)\b/i, 'a commitment'],
  [/(חוזה|הסכם|משפטי|עורך דין|חשבונית|תשלום|מחיר|הנחה|שכר|פיטור|תלונה|דחוף|בלעדי|התחייבות)/, 'sensitive in Hebrew'],
];

/** Only these kinds of message are even considered. */
const SIMPLE: [RegExp, string][] = [
  [/\b(thank you|thanks|much appreciated|received|got it|noted)\b/i, 'an acknowledgement'],
  [/\b(are you available|does .{0,20}work for you|schedule|reschedule|calendar|meeting time|call time)\b/i, 'about scheduling'],
  [/\b(could you (send|share)|can you (send|share)|please send|looking for the) (the )?(deck|link|logo|details|docs?|documentation)\b/i, 'asking for something we can point at'],
  [/\b(who (should i|do i) (contact|speak to|talk to)|right person|introduce me to)\b/i, 'asking who to talk to'],
  [/\b(confirming|just to confirm|checking in|following up)\b/i, 'a check-in'],
  [/(תודה|קיבלתי|מתי נוח|לתאם|פגישה|מי אחראי)/, 'simple in Hebrew'],
];

export interface Triage {
  answerable: boolean;
  reason: string;
  matched: string[];
}

/**
 * The rule gate. Nothing reaches the model without passing this first.
 */
export function triage(candidate: ReplyCandidate): Triage {
  const text = `${candidate.subject ?? ''}\n${candidate.snippet ?? ''}`;
  if (text.trim() === '') return { answerable: false, reason: 'nothing to read', matched: [] };

  const blocked = NEVER.filter(([pattern]) => pattern.test(text)).map(([, why]) => why);
  if (blocked.length > 0) {
    return { answerable: false, reason: `it is ${blocked[0]}`, matched: blocked };
  }

  // A long thread is a negotiation, not a question. Length is a decent proxy
  // for "there is history here I do not have".
  if (candidate.messages.length > 4) {
    return { answerable: false, reason: 'a long conversation with history', matched: [] };
  }

  const last = candidate.messages[candidate.messages.length - 1];
  if (!last || last.fromMe) {
    return { answerable: false, reason: 'the last word is already yours', matched: [] };
  }
  if (last.text.length > 1500) {
    return { answerable: false, reason: 'too long to be a simple question', matched: [] };
  }

  const simple = SIMPLE.filter(([pattern]) => pattern.test(text)).map(([, why]) => why);
  if (simple.length === 0) {
    return { answerable: false, reason: 'not obviously simple', matched: [] };
  }

  return { answerable: true, reason: `it is ${simple[0]}`, matched: simple };
}

/**
 * The final word on whether a draft may be sent.
 *
 * Separate from drafting on purpose: the thing that decides to send must be
 * readable on its own, and must not be the thing that wanted to send.
 */
const OWNER_NAME = process.env.OWNER_NAME ?? 'Maor Davidovich';

/** His name is in it, in either alphabet. Mirrors lib/meetings/rules.ts. */
function signedByHim(text: string): boolean {
  const first = (OWNER_NAME ?? '').trim().split(/\s+/)[0] ?? '';
  if (first === '') return true;
  const hebrew = first.toLowerCase() === 'maor' ? 'מאור' : first;
  return (text ?? '').toLowerCase().includes(first.toLowerCase()) || (text ?? '').includes(hebrew);
}

export function maySend(triaged: Triage, draft: Draft): { send: boolean; why: string } {
  if (!triaged.answerable) return { send: false, why: triaged.reason };
  if (!draft.shouldReply) return { send: false, why: draft.reasoning };
  if (draft.confidence !== 'high') {
    return { send: false, why: `only ${draft.confidence} confidence — ${draft.reasoning}` };
  }
  if (draft.reply.trim().length < 10) return { send: false, why: 'the draft is empty' };
  if (draft.reply.length > 1200) return { send: false, why: 'the draft is too long to be simple' };
  /*
   * His name, on anything sent over his address.
   *
   * A reply that arrives from him and is signed by nobody reads as sent by a
   * machine — which it was — and the person reading it should not have to work
   * that out. The model is told to sign as him; this is what happens when it
   * does not.
   */
  if (!signedByHim(draft.reply)) return { send: false, why: 'the draft is not signed with your name' };
  return { send: true, why: triaged.reason };
}

/**
 * The third outcome: nothing to answer, but worth seeing.
 *
 * Not every email is a question. A great deal of what arrives is information —
 * a report, a notice, an update — where a reply would be noise and leaving it
 * in the inbox is one more thing for him to open and close. Those get shown to
 * him in Slack, in one line, and filed.
 *
 * Filing is only ever considered for mail the rule gate has already cleared of
 * anything sensitive, and only where the reason it was not answered is that it
 * was not a simple question — never because the thread has history, never
 * because the last word is already his, and never because a NEVER rule fired.
 */
export function mayFile(triaged: Triage): { consider: boolean; why: string } {
  if (triaged.answerable) return { consider: false, why: 'it is being answered' };
  if (triaged.matched.length > 0) return { consider: false, why: `it is ${triaged.matched[0]}` };

  const fileable = ['not obviously simple', 'too long to be a simple question'];
  if (!fileable.includes(triaged.reason)) return { consider: false, why: triaged.reason };

  return { consider: true, why: 'nothing sensitive, and nothing being asked of you' };
}

export const draftSchema = z.object({
  /** The model's own veto. It may refuse what the rules allowed, never the reverse. */
  shouldReply: z.boolean(),
  /** Why, in one line, whichever way it went. */
  reasoning: z.string(),
  /** Empty when it declined. */
  reply: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  /** True when nothing is being asked and nothing needs doing — information only. */
  informational: z.boolean().optional(),
  /** One line saying what it says, for the Slack note when it is only filed. */
  summary: z.string().optional(),
});

export type Draft = z.infer<typeof draftSchema>;

const SYSTEM = `You are drafting a short reply on behalf of Maor Davidovich, CEO
of Adnimation, an Israeli ad-tech company.

You are answering only the mail that is genuinely trivial: an acknowledgement, a
scheduling question, a request for something we can simply point at, or a "who
should I speak to". Everything else you decline.

Decline — set shouldReply false — whenever any of these is true, and say which:
· it needs a fact you do not have
· it touches money, pricing, contracts, legal, staff, or a commitment of any kind
· it could reasonably be read as him agreeing to something
· the sender is upset, or the thread is a negotiation
· you would be guessing at what he thinks
· you are anything less than confident

Declining costs him one email to write himself. A wrong reply commits him, in
writing, to someone who will hold him to it. Those are not comparable, so when
in doubt, decline.

When you do reply: two or three sentences, plain, no pleasantries beyond a
greeting, no promises, no dates he has not given you, and never a figure. Write
in the language the sender wrote in. Sign off as Maor.

Separately, set "informational" true when the message is only telling him
something — a report, a notice, a status update, a newsletter — and nothing is
being asked of him and nothing needs doing. Set it false whenever there is a
question, a request, a decision, a deadline, an invitation, or anything he
would want to act on. In "summary", say in one line what it tells him; that
line is all he will read.`;

export async function draftReply(
  candidate: ReplyCandidate,
  extraInstructions?: string | null,
): Promise<{ ok: true; draft: Draft } | { ok: false; error: string; needsKey?: boolean }> {
  const thread = candidate.messages
    .map((m) => `${m.fromMe ? 'Maor' : (candidate.fromName ?? 'Them')}: ${m.text.slice(0, 4000)}`)
    .join('\n\n---\n\n');

  const prompt = [
    `From: ${candidate.fromName ?? ''} <${candidate.fromEmail ?? ''}>`,
    candidate.knownCompany ? `They are: ${candidate.knownCompany}` : 'They are not a known contact.',
    `Subject: ${candidate.subject ?? '(none)'}`,
    '',
    'The thread, oldest first:',
    thread,
    '',
    // His own instructions go last, where they carry the most weight, and are
    // framed as constraints rather than as the task — so they can narrow what
    // gets sent but never talk the model into sending something it refused.
    extraInstructions?.trim()
      ? `Additional standing instructions from Maor, which override the above where they are stricter:\n${extraInstructions.trim()}`
      : '',
    '',
    'Answer as JSON: {"shouldReply": boolean, "reasoning": "one line", "reply": "the text", ' +
      '"confidence": "high|medium|low", "informational": boolean, "summary": "one line saying what it says"}',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await ask<Draft>(prompt, {
    system: SYSTEM,
    schema: draftSchema,
    maxTokens: 1200,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, ...(result.needsKey ? { needsKey: true } : {}) };
  }
  if (!result.parsed) return { ok: false, error: 'Claude did not return a draft' };

  return { ok: true, draft: result.parsed };
}

