/**
 * GENERATED FROM lib/tasks/mail-match.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/task-mail-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
/**
 * Which emails belong to which task.
 *
 * He asked for the tasks to fish the relevant mail out of the mailbox and keep
 * fishing. The mailbox is already mirrored into `mail_threads` (see
 * deploy/mail-sync.mjs); this decides which of those threads is about a given
 * task, and it is deliberately the strict half of the feature.
 *
 * The failure mode to design against is not missing a thread — it is hanging
 * three wrong conversations off every task, because a task that shows three
 * wrong emails is a task he stops reading the emails on, and then the feature
 * is worse than nothing. So:
 *
 *  - A person alone is never a match. He mails Assaf about fifty things a
 *    week; "Assaf is on this task and Assaf is in this thread" says nothing.
 *  - Recency alone is never a match either. It only breaks ties.
 *  - A match needs a real overlap of words that mean something — after the
 *    words that mean nothing here are thrown away. "Adnimation", "meeting",
 *    "update" and "re" are in half the mailbox.
 *
 * Every match carries its reasons, and the screen shows them, so a wrong one
 * is an explained wrong one he can dismiss rather than a mystery.
 */

/**
 * Words that carry no information in this mailbox.
 *
 * Mail furniture, the company's own name and the words that appear on every
 * second task. Without this list "Adnimation" alone matches a task to four
 * hundred threads.
 */
export const NOISE = new Set([
  're', 'fw', 'fwd', 'reply', 'read', 'sent', 'mail', 'email', 'message', 'thread',
  'hi', 'hello', 'hey', 'thanks', 'thank', 'regards', 'best', 'dear', 'please', 'kindly',
  'adnimation', 'com', 'net', 'org', 'www', 'http', 'https', 'the', 'and', 'for', 'with',
  'from', 'that', 'this', 'you', 'your', 'our', 'are', 'was', 'were', 'has', 'have', 'had',
  'will', 'would', 'can', 'could', 'should', 'about', 'into', 'over', 'out', 'not',
  'task', 'tasks', 'meeting', 'meet', 'call', 'update', 'updates', 'status', 'check',
  'new', 'old', 'next', 'week', 'month', 'day', 'today', 'tomorrow', 'asap', 'urgent',
  'invite', 'invitation', 'accepted', 'declined', 'calendar', 'zoom', 'google',
  // Hebrew furniture, and the words that sit on half his tasks.
  'של', 'עם', 'על', 'את', 'אל', 'זה', 'זו', 'הוא', 'היא', 'לא', 'כן', 'יש', 'אין',
  'משימה', 'משימות', 'פגישה', 'שיחה', 'עדכון', 'עדכונים', 'לבדוק', 'בדיקה', 'היום',
  'מחר', 'שבוע', 'חודש', 'דחוף', 'תודה', 'שלום', 'היי', 'בבקשה', 'צריך', 'צריכה',
]);

/** Threshold a match has to clear before it is written down at all. */
export const MIN_SCORE = 34;

/** Letters and digits in any script, so a Hebrew title tokenises like an English one. */
export function words(text) {
  if (!text) return [];
  const out = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    // Two-letter words carry nothing on their own in either language.
    if (raw.length < 3) continue;
    if (NOISE.has(raw)) continue;
    if (/^\d+$/.test(raw) && raw.length < 5) continue;
    out.push(raw);
  }
  return out;
}

/** The part after the @, which is the company rather than the person. */
export function domainOf(address) {
  const at = address.indexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase().trim();
}

const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com',
  'icloud.com', 'walla.co.il', 'walla.com', 'protonmail.com',
]);

const dedupe = (list) => [...new Set(list)];

/** Whole days between two ISO dates, either way round. */
function daysApart(a, b) {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isNaN(ms) ? 999 : Math.floor(ms / 86400000);
}

/**
 * How well one thread fits one task.
 *
 * Returns null when it does not fit, which is the common answer.
 */
export function scoreThread(task, thread) {
  const signals = signalsFor(task, thread);
  if (!signals.strong) return null;
  if (signals.score < MIN_SCORE) return null;
  return { threadId: thread.threadId, score: signals.score, reasons: signals.reasons };
}

function signalsFor(task, thread) {
  const taskWords = new Set(words([task.title, task.description, task.nextStep, task.tags.join(' ')].filter(Boolean).join(' ')));
  const threadWords = new Set(words([thread.subject, thread.snippet].filter(Boolean).join(' ')));

  const shared = [...taskWords].filter((w) => threadWords.has(w));

  const addresses = dedupe(
    [...thread.participants, thread.counterpartEmail]
      .filter(Boolean)
      .map((a) => String(a).toLowerCase().trim()),
  );
  const taskPeople = dedupe(task.people.filter(Boolean).map((a) => a.toLowerCase().trim()));
  const onBoth = taskPeople.filter((a) => addresses.includes(a));

  /*
   * A company named in the task, met in the thread.
   *
   * The task says "Taboola integration"; the thread is with somebody at
   * taboola.com. That is the match a word overlap misses, because the word
   * only appears in the address. Free mail domains are excluded — everybody
   * has a gmail.com in the thread.
   */
  const domains = dedupe(addresses.map(domainOf).filter((d) => d && !PUBLIC_DOMAINS.has(d)));
  const domainHit = domains.find((d) => {
    const stem = d.split('.')[0] ?? '';
    return stem.length >= 4 && taskWords.has(stem);
  });

  /** A label he applied by hand that the task also carries as a tag. */
  const tagSet = new Set(task.tags.map((t) => t.toLowerCase().trim()).filter(Boolean));
  const labelHit = thread.labels
    .map((l) => l.toLowerCase().trim())
    .find((l) => tagSet.has(l));

  const reasons = [];
  let score = 0;

  if (shared.length > 0) {
    // Capped: a thread quoting the whole task body is not five times as
    // relevant as one naming the two words that matter.
    score += Math.min(shared.length, 5) * 11;
    reasons.push(`says ${shared.slice(0, 4).join(', ')}`);
  }
  if (onBoth.length > 0) {
    score += 18;
    const name = thread.counterpartName && onBoth.includes(String(thread.counterpartEmail).toLowerCase())
      ? thread.counterpartName
      : onBoth[0];
    reasons.push(`with ${name}`);
  }
  if (domainHit) {
    score += 22;
    reasons.push(`with ${domainHit}`);
  }
  if (labelHit) {
    score += 12;
    reasons.push(`labelled ${labelHit}`);
  }

  /*
   * Recency breaks ties and nothing else. A thread from the week the task was
   * written is likelier to be the one — but "same week" is true of a thousand
   * threads, so it never makes a match on its own.
   */
  const gap = daysApart(thread.lastMessageAt, task.createdAt);
  if (gap <= 14) score += 6;
  else if (gap <= 45) score += 2;

  /*
   * What makes it a match rather than a coincidence. At least one of these
   * has to hold — none of them is recency, and none of them is a person on
   * their own.
   */
  const strong =
    shared.length >= 3 ||
    (onBoth.length > 0 && shared.length >= 1) ||
    (domainHit && shared.length >= 1) ||
    (labelHit && shared.length >= 1) ||
    Boolean(domainHit && onBoth.length > 0);

  return { score, reasons, strong: Boolean(strong) };
}

/** Per task, the best threads — most convincing first. */
export function matchesFor(task, threads, limit = 5) {
  const found = [];
  for (const thread of threads) {
    const hit = scoreThread(task, thread);
    if (hit) found.push(hit);
  }
  found.sort((a, b) => b.score - a.score || a.threadId.localeCompare(b.threadId));
  return found.slice(0, limit);
}

/**
 * The threads worth a second opinion, whether or not the rules are convinced.
 *
 * The rules above match on words, and his tasks are written in Hebrew while
 * most of the mail about them is in English. "לחבר את נקססן מחדש ל CTV" and
 * "Nexxen CTV reconnect" are the same thing and share one token, which is not
 * enough to be sure and is far too much to throw away. So the strict pass
 * keeps what it is certain of, and this one hands everything plausible to the
 * model, which can read both languages and answer the question the words alone
 * cannot.
 *
 * Deliberately loose: anything with a single signal at all, ranked. It is a
 * shortlist for a reader, not an answer.
 */
export function looseCandidates(task, threads, limit = 10) {
  const found = [];
  for (const thread of threads) {
    const s = signalsFor(task, thread);
    // Recency alone scores 6 and means nothing; something must have matched.
    if (s.reasons.length === 0) continue;
    found.push({ threadId: thread.threadId, score: s.score, reasons: s.reasons });
  }
  found.sort((a, b) => b.score - a.score || a.threadId.localeCompare(b.threadId));
  return found.slice(0, limit);
}
