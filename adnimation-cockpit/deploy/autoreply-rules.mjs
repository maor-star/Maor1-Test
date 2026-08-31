/**
 * GENERATED FROM lib/agents/autoreply.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/autoreply-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */

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

/**
 * Subjects that are never answered automatically, however simple they read.
 *
 * Each of these is something where a wrong or premature answer costs money, a
 * relationship, or a legal position — and where "I'll come back to you" from a
 * machine is worse than silence.
 */
const NEVER = [
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
const SIMPLE = [
  [/\b(thank you|thanks|much appreciated|received|got it|noted)\b/i, 'an acknowledgement'],
  [/\b(are you available|does .{0,20}work for you|schedule|reschedule|calendar|meeting time|call time)\b/i, 'about scheduling'],
  [/\b(could you (send|share)|can you (send|share)|please send|looking for the) (the )?(deck|link|logo|details|docs?|documentation)\b/i, 'asking for something we can point at'],
  [/\b(who (should i|do i) (contact|speak to|talk to)|right person|introduce me to)\b/i, 'asking who to talk to'],
  [/\b(confirming|just to confirm|checking in|following up)\b/i, 'a check-in'],
  [/(תודה|קיבלתי|מתי נוח|לתאם|פגישה|מי אחראי)/, 'simple in Hebrew'],
];

/**
 * The rule gate. Nothing reaches the model without passing this first.
 */
export function triage(candidate) {
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

