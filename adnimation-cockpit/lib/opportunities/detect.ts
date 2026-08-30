/**
 * Spotting an opportunity in mail he has already received.
 *
 * The bar here is deliberately high. A suggestion queue that is mostly wrong
 * gets ignored within a week, and then the whole mechanism is worse than not
 * having it — he stops looking, and the real ones sit in it unread. So this
 * proposes rather than files, needs more than one reason before it says
 * anything, and stays quiet about anything that looks automated.
 *
 * It reads the subject and the snippet the mail mirror already holds. It does
 * not fetch message bodies: the cockpit holds a readonly Gmail scope for
 * metadata, and guessing at intent from a marketing footer is how a queue
 * fills with noise.
 */

export interface DetectionInput {
  subject: string | null;
  snippet: string | null;
  counterpartEmail: string | null;
  counterpartName: string | null;
  knownContact: boolean;
  knownCompany: string | null;
  lastFromMe: boolean;
}

export interface Detection {
  isOpportunity: boolean;
  score: number;
  /** Why it was flagged, shown on the suggestion so he can judge it fast. */
  reasons: string[];
  kind: 'supply' | 'demand' | 'partnership' | 'upsell' | 'other';
}

/**
 * Phrases that mean somebody is proposing something, in the two languages his
 * mail actually arrives in. Weighted: some are on their own worth acting on,
 * most are only worth acting on together.
 */
const STRONG: [RegExp, string][] = [
  [/\b(partnership|partner with us|work together|collaborat)/i, 'proposes working together'],
  [/\b(proposal|rfp|request for proposal)\b/i, 'a proposal'],
  [/\b(interested in (working|partnering|your))/i, 'says they are interested'],
  [/\b(would like to (work|partner|discuss|explore))/i, 'wants to explore something'],
  [/\b(intro(duce|duction)? (you )?to)\b/i, 'an introduction'],
  [/(שיתוף פעולה|שת"פ|שת״פ)/, 'שיתוף פעולה'],
  [/(הצעה עסקית|הצעת מחיר)/, 'הצעה'],
  [/(מעוניינ(ים|ת|י)\s+ב)/, 'מעוניינים'],
];

const WEAK: [RegExp, string][] = [
  [/\b(opportunity|opportunities)\b/i, 'mentions an opportunity'],
  [/\b(budget|spend|volume)\b/i, 'mentions budget or volume'],
  [/\b(integrat(e|ion)|onboard(ing)?)\b/i, 'mentions integrating'],
  [/\b(pricing|rates|cpm|revenue share|rev ?share)\b/i, 'mentions commercial terms'],
  [/\b(demo|call|meeting|catch up)\b/i, 'asks for time'],
  [/\b(inventory|traffic|impressions|publishers?|advertisers?)\b/i, 'about inventory or demand'],
  [/(הזדמנות|תקציב|פגישה|שיחה)/, 'הזדמנות או פגישה'],
];

/**
 * The things that look like opportunities and never are. Any one of these is
 * enough to stay silent — a false negative costs him one manual capture, a
 * false positive costs him trust in the whole queue.
 */
const NOISE: RegExp[] = [
  /\b(unsubscribe|view (this )?(email )?in browser|manage (your )?preferences)\b/i,
  /\b(no-?reply|do-?not-?reply|notifications?@|mailer@|bounce)/i,
  /\b(newsletter|webinar|whitepaper|ebook|case study|blog post)\b/i,
  /\b(invoice|receipt|statement|payment (due|received)|past due)\b/i,
  /\b(password|verification code|otp|sign-?in|security alert|2fa)\b/i,
  /\b(out of office|automatic reply|delivery status|undeliverable)\b/i,
  /\b(conference|summit|expo|awards?)\b.*\b(register|tickets?|early bird)\b/i,
  /\b(job alert|applied|application|resume|cv)\b/i,
];

/** Cheap sender-shape checks that catch most bulk mail before the phrases do. */
const NOISE_SENDER =
  /^(no-?reply|do-?not-?reply|newsletter|news|info|marketing|notifications?|updates?|support|billing|team|hello|hi)@/i;

function classifyKind(text: string): Detection['kind'] {
  if (/\b(publisher|inventory|traffic|site|monetiz|supply)\b/i.test(text)) return 'supply';
  if (/\b(advertiser|dsp|demand|campaign|buy(ing)? side|budget)\b/i.test(text)) return 'demand';
  if (/\b(partnership|collaborat|reseller|integration)\b/i.test(text)) return 'partnership';
  return 'other';
}

export function detectOpportunity(input: DetectionInput): Detection {
  const none: Detection = { isOpportunity: false, score: 0, reasons: [], kind: 'other' };

  // The last word was his, so whatever it was, he has already engaged with it.
  if (input.lastFromMe) return none;

  const text = `${input.subject ?? ''}\n${input.snippet ?? ''}`;
  if (text.trim() === '') return none;

  if (NOISE.some((r) => r.test(text))) return none;
  if (input.counterpartEmail && NOISE_SENDER.test(input.counterpartEmail)) return none;

  const reasons: string[] = [];
  let score = 0;

  for (const [pattern, reason] of STRONG) {
    if (pattern.test(text)) { score += 2; reasons.push(reason); }
  }
  for (const [pattern, reason] of WEAK) {
    if (pattern.test(text)) { score += 1; reasons.push(reason); }
  }

  // Somebody the company already deals with is a better bet than a stranger,
  // but it is a tie-breaker, not a reason on its own.
  if (input.knownContact) {
    score += 1;
    reasons.push(input.knownCompany ? `known: ${input.knownCompany}` : 'a known contact');
  }

  // Three points means either one strong phrase plus any corroboration, or
  // three independent weak ones. One weak phrase and a known sender is not
  // enough — that describes most of his ordinary mail.
  const isOpportunity = score >= 3 && reasons.length >= 2;

  return {
    isOpportunity,
    score,
    reasons: reasons.slice(0, 4),
    kind: isOpportunity ? classifyKind(text) : 'other',
  };
}
