/**
 * GENERATED FROM lib/agents/mailbox.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/mailbox-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
/**
 * Tidying the mailbox: what to file away, and what to throw out.
 *
 * Both are destructive in the sense that matters — a mail moved out of the
 * inbox is a mail he will not see — so the rules are written to be wrong in
 * the safe direction. Promotional mail that stays in the inbox costs him a
 * glance; a client's message filed as promotion costs him the client.
 *
 * Nothing here is permanently deleted. Filing removes the INBOX label, and
 * throwing out means the trash, which Gmail keeps for thirty days.
 */

/*
 * Label names are English, always.
 *
 * Gmail search, filters and the API all take the name as a literal string, and
 * a right-to-left name in a left-to-right query is a class of bug nobody wants
 * to debug at the point where mail is disappearing from an inbox.
 */

/** Where sales and marketing mail is filed. */
export const PROMO_LABEL = process.env.PROMO_LABEL ?? 'Sales & Marketing';

/** Where a conversation the assistant answered is filed. */
export const ANSWERED_LABEL = process.env.ANSWERED_LABEL ?? 'Claude Answered';

/* -------------------------------------------------------------------------
 * Sales and marketing
 * ---------------------------------------------------------------------- */

const PROMO_SIGNALS = [
  [/\b(unsubscribe|opt[- ]out|manage (your )?preferences|email preferences)\b/i, 'has an unsubscribe'],
  [/\b(webinar|whitepaper|ebook|case study|free trial|demo request|book a demo)\b/i, 'markets something'],
  [/\b(newsletter|digest|round-?up|this week in|monthly update)\b/i, 'is a newsletter'],
  [/\b(\d{1,3}% off|limited time|early bird|last chance|special offer|save \$)\b/i, 'is an offer'],
  [/\b(exclusive|don'?t miss|act now|hurry|expires soon)\b/i, 'reads as marketing'],
  [/(הרשמה|מבצע|הנחה|לחצו כאן|הסרה מרשימת התפוצה|וובינר)/, 'שיווקי'],
];

const PROMO_SENDER =
  /^(no-?reply|do-?not-?reply|newsletter|news|marketing|hello|hi|team|updates?|info|promo|offers?|campaigns?)@/i;

/**
 * Mail that mentions marketing words and is not marketing.
 *
 * A real person writing about a webinar we are speaking at, a client asking
 * about our pricing — these carry the vocabulary and none of the intent.
 */
const NOT_PROMO = [
  /\b(invoice|contract|agreement|payment|urgent|asap)\b/i,
  /\b(re|fwd|fw):/i,
  /(חשבונית|חוזה|הסכם|דחוף)/,
];

export function looksPromotional(mail) {
  const text = `${mail.subject ?? ''}\n${mail.snippet ?? ''}`;
  if (text.trim() === '') return { isPromo: false, reasons: [] };

  /*
   * Three things veto it outright, and each one has cost somebody somewhere a
   * relationship:
   *  - somebody the company deals with,
   *  - somebody he has replied to before,
   *  - a reply or a forward, which is a conversation whatever it says.
   */
  if (mail.knownContact) return { isPromo: false, reasons: ['from someone we deal with'] };
  if (mail.everReplied) return { isPromo: false, reasons: ['you have replied to them before'] };
  if (NOT_PROMO.some((r) => r.test(text))) {
    return { isPromo: false, reasons: ['reads as a real conversation'] };
  }

  const reasons = [];
  for (const [pattern, reason] of PROMO_SIGNALS) if (pattern.test(text)) reasons.push(reason);
  if (mail.fromEmail && PROMO_SENDER.test(mail.fromEmail)) reasons.push('a bulk sender address');

  // Gmail's own guess counts for one, never on its own — it is wrong often
  // enough that acting on it alone would file real mail.
  if (mail.labels.includes('CATEGORY_PROMOTIONS')) reasons.push('Gmail calls it promotions');

  return { isPromo: reasons.length >= 2, reasons };
}

/* -------------------------------------------------------------------------
 * One-time codes
 * ---------------------------------------------------------------------- */

const CODE_SIGNALS = [
  /\b(verification|security|one-?time|login|sign-?in|access|confirmation) code\b/i,
  /\b(your code is|code:\s*\d{4,8}|otp|2fa|two-?factor|authenticator)\b/i,
  /\b(\d{6})\s+is your\b/i,
  /(קוד אימות|קוד חד ?פעמי|הקוד שלך)/,
];

/** Mail about accounts that is not a code and must never be thrown out. */
const NOT_A_CODE = [
  /\b(invoice|receipt|contract|payment|statement|password (has been )?changed)\b/i,
  /\b(unusual|suspicious|new sign-?in from|was accessed|breach)\b/i,
  /(חשבונית|קבלה|חוזה|שינוי סיסמה|כניסה חריגה)/,
];

/** An expired code is worthless, so an hour is generous. */
export const CODE_EXPIRY_HOURS = Number(process.env.AUTH_CODE_HOURS ?? 1);

export function isSpentAuthCode(mail, expiryHours = CODE_EXPIRY_HOURS) {
  const text = `${mail.subject ?? ''}\n${mail.snippet ?? ''}`;
  if (text.trim() === '') return { isExpiredCode: false, reasons: [] };

  /*
   * A security ALERT is not a code and is the last thing to throw away — it is
   * how someone finds out their account was taken. The vocabulary overlaps
   * almost completely, so this veto comes first.
   */
  if (NOT_A_CODE.some((r) => r.test(text))) {
    return { isExpiredCode: false, reasons: ['it is an alert or a record, not a code'] };
  }

  const reasons = [];
  for (const pattern of CODE_SIGNALS) if (pattern.test(text)) reasons.push('carries a one-time code');
  if (reasons.length === 0) return { isExpiredCode: false, reasons: [] };

  // Still valid: leave it alone. The whole justification for removing these is
  // that they no longer work.
  if (mail.ageHours < expiryHours) {
    return { isExpiredCode: false, reasons: [`only ${Math.round(mail.ageHours * 60)} minutes old`] };
  }

  reasons.push(`${Math.round(mail.ageHours)}h old, long expired`);
  return { isExpiredCode: true, reasons: [...new Set(reasons)] };
}
