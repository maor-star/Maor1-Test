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

export interface TaskSeed {
  id: string;
  title: string;
  description: string | null;
  nextStep: string | null;
  tags: string[];
  /**
   * Everyone on it, by email — the lead and the rest, WITHOUT the owner of the
   * mailbox being read.
   *
   * His own address is in every thread in his own mailbox, so counting it as
   * "somebody on this task is in this conversation" gave fourteen points to
   * literally everything and turned a single common word into a match. The
   * callers strip it (see MAILBOX_OWNER below); it is stated here because a
   * caller that forgets makes the whole matcher wrong in a way that still
   * looks like it is working.
   */
  people: string[];
  /** ISO date. Used only to break ties between equally good threads. */
  createdAt: string;
}

export interface ThreadSeed {
  threadId: string;
  subject: string | null;
  snippet: string | null;
  counterpartName: string | null;
  counterpartEmail: string | null;
  participants: string[];
  labels: string[];
  /** ISO date. */
  lastMessageAt: string;
}

export interface MailMatch {
  threadId: string;
  score: number;
  reasons: string[];
}

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
  // Hebrew furniture, and the words that sit on half his tasks. The first
  // version of this list was four lines long and it was not close to enough:
  // "וסט משקולות" (a weight vest) matched a contract task on הזה / אני / אחד /
  // כדי, all of which are function words that carry nothing.
  'של', 'עם', 'על', 'את', 'אל', 'זה', 'זו', 'הזה', 'הזו', 'הוא', 'היא', 'הם', 'הן',
  'לא', 'כן', 'יש', 'אין', 'אני', 'אתה', 'אנחנו', 'אתם', 'שלי', 'שלו', 'שלה', 'שלנו',
  'שלהם', 'כדי', 'אחד', 'אחת', 'אחרי', 'לפני', 'למה', 'איך', 'מתי', 'איפה', 'מה',
  'כל', 'לכל', 'עוד', 'גם', 'רק', 'אבל', 'או', 'כי', 'אם', 'כמו', 'בין', 'תחת',
  'היה', 'היתה', 'להיות', 'עושה', 'לעשות', 'עשה', 'אמר', 'אומר', 'רוצה', 'יכול',
  'לראות', 'ראיתי', 'לשלוח', 'שלחתי', 'שלח', 'לקבל', 'קיבלתי', 'מחכה', 'מחכים',
  'משימה', 'משימות', 'פגישה', 'פגישות', 'שיחה', 'עדכון', 'עדכונים', 'לבדוק',
  'בדיקה', 'היום', 'מחר', 'אתמול', 'שבוע', 'חודש', 'שנה', 'דחוף', 'תודה', 'שלום',
  'היי', 'בבקשה', 'צריך', 'צריכה', 'צריכים', 'טוב', 'נראה', 'סתם', 'ממש', 'הרבה',
  'המון', 'אותה', 'אותו', 'אותם', 'שורה', 'דבר', 'משהו', 'מישהו', 'עכשיו', 'אז',
  /*
   * Everyday Hebrew business vocabulary.
   *
   * This is a list I said I did not want, and it earns its place on a
   * distinction: partner names change every quarter and a list of them would
   * rot, but "נתונים" and "הצעה" will mean the same thing in five years. It is
   * a dictionary, not a register of who we work with.
   *
   * Each of these matched a task to an unrelated thread on its own in the
   * fourth live run, because they are rare in a mailbox that is almost all
   * English and therefore looked as distinctive as a company's name.
   */
  'נתונים', 'מידע', 'מספרים', 'דוח', 'דוחות', 'הצעה', 'הצעות', 'מחיר', 'מחירים',
  'חשבונית', 'חשבוניות', 'תשלום', 'תשלומים', 'כספים', 'הכנסות', 'הוצאות', 'תקציב',
  'הסכם', 'הסכמים', 'חוזה', 'חוזים', 'סיכום', 'סיכומים', 'תכנית', 'תוכנית', 'עבודה',
  'פרויקט', 'לקוח', 'לקוחות', 'ספק', 'ספקים', 'חברה', 'חברות', 'צוות', 'מחלקה',
  'אתר', 'אתרי', 'אתרים', 'מערכת', 'מערכות', 'תהליך', 'שאלה', 'שאלות', 'תשובה',
  'מייל', 'מיילים', 'טלפון', 'קישור', 'קובץ', 'קבצים', 'מסמך', 'מסמכים',
]);

/**
 * How many tasks one thread may belong to before it belongs to none.
 *
 * The cockpit mails him a Daily Summary that lists his own tasks, so the first
 * run matched that one thread to twenty-seven of them — a perfect word overlap
 * and a completely useless answer. Meeting-notes mails and weekly invitations
 * do the same thing more quietly.
 *
 * A digest is recognisable without a list of subjects to maintain: it is the
 * thread that is about everything. Four is generous for a real conversation
 * and far below what a digest scores.
 */
export const MAX_TASKS_PER_THREAD = 4;

/** Hebrew function words are short; three Latin letters can still be CTV. */
const isHebrew = (word: string) => /[\u0590-\u05FF]/.test(word);

/** Threshold a match has to clear before it is written down at all. */
export const MIN_SCORE = 34;

/**
 * How common a word may be across the mailbox and still mean something.
 *
 * This replaces an argument I was about to lose. The first live run matched
 * "Bio ads" to a thread about app-ads.txt on the word "ads", and I started
 * adding words to the noise list — but "ads" is noise in this mailbox while
 * "pangle" is the whole answer, and no hand-written list knows the difference
 * for a company whose partners change every quarter.
 *
 * So rarity is measured instead of guessed: a word in three subjects out of
 * three thousand is the name of something, and a word in two hundred is
 * furniture. The counting is done by the sweep, which is the only pass that
 * sees every thread.
 */
export const RARE = 6;
const COMMON = 24;
const EVERYWHERE = 80;

/**
 * Rare enough that one of them is a match on its own.
 *
 * Not the same question as "is this word worth points". The third live run
 * matched tasks to mail on a single shared word that WAS rare — "possible",
 * "direct", "across", "ספטמבר" — and rare is not the same as meaningful:
 * "pangle" is the name of a company and "ספטמבר" is a month, and a corpus of
 * three thousand subjects contains few of either.
 *
 * So one word carries a match only when it is all but unique to the pair,
 * which is what a partner's name looks like and what an ordinary word never
 * does. Everything else needs a second word, or a person, or a domain.
 */
const NAMES_SOMETHING = 2;

/** Word → how many thread subjects it appears in. */
export type WordSpread = Map<string, number>;

/** What one shared word is worth, given how common it is. */
export function weightOf(word: string, spread: WordSpread): number {
  const seen = spread.get(word) ?? 0;
  // No corpus to judge by: treat it as distinctive, which is what a caller
  // scoring one pair in a test means.
  if (seen === 0) return 1;
  if (seen <= RARE) return 1;
  if (seen <= COMMON) return 0.55;
  if (seen <= EVERYWHERE) return 0.2;
  return 0.05;
}

/** How often each word shows up in a subject, across the whole mailbox. */
export function spreadOf(threads: ThreadSeed[]): WordSpread {
  const spread: WordSpread = new Map();
  for (const thread of threads) {
    for (const word of new Set(words(thread.subject ?? ''))) {
      spread.set(word, (spread.get(word) ?? 0) + 1);
    }
  }
  return spread;
}

/** Letters and digits in any script, so a Hebrew title tokenises like an English one. */
export function words(text: string): string[] {
  if (!text) return [];
  const out = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    // Two-letter words carry nothing on their own in either language.
    if (raw.length < 3) continue;
    // Almost every three-letter Hebrew word is a function word; almost every
    // three-letter Latin one that survives the noise list is an acronym that
    // means something here — CTV, IBV, SSP.
    if (isHebrew(raw) && raw.length < 4) continue;
    if (NOISE.has(raw)) continue;
    if (/^\d+$/.test(raw) && raw.length < 5) continue;
    out.push(raw);
  }
  return out;
}

/** The part after the @, which is the company rather than the person. */
export function domainOf(address: string): string {
  const at = address.indexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase().trim();
}

/**
 * Whose mailbox this is.
 *
 * Every thread in it has him in it, so he is never evidence that a thread is
 * about a particular task. Callers drop this address from a task's people
 * before scoring.
 */
export const MAILBOX_OWNER = 'maor@adnimation.com';

/** Everyone on a task except whoever's mailbox is being read. */
export function othersOn(people: readonly string[], owner = MAILBOX_OWNER): string[] {
  const mine = owner.toLowerCase().trim();
  return people.filter((p) => p && p.toLowerCase().trim() !== mine);
}

/**
 * His own domain, which is in every internal thread and therefore names
 * nothing. Without this, a task that says "Adnimation" anywhere matches the
 * whole mailbox on the company's own address.
 */
const OURS = new Set(['adnimation.com']);

const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com',
  'icloud.com', 'walla.co.il', 'walla.com', 'protonmail.com',
]);

const dedupe = (list: string[]): string[] => [...new Set(list)];

/** Whole days between two ISO dates, either way round. */
function daysApart(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isNaN(ms) ? 999 : Math.floor(ms / 86400000);
}

/**
 * How well one thread fits one task.
 *
 * Returns null when it does not fit, which is the common answer.
 */
export function scoreThread(
  task: TaskSeed,
  thread: ThreadSeed,
  spread: WordSpread = new Map(),
): MailMatch | null {
  const signals = signalsFor(task, thread, spread);
  if (!signals.strong) return null;
  if (signals.score < MIN_SCORE) return null;
  return { threadId: thread.threadId, score: signals.score, reasons: signals.reasons };
}

interface Signals {
  score: number;
  reasons: string[];
  strong: boolean;
}

function signalsFor(task: TaskSeed, thread: ThreadSeed, spread: WordSpread): Signals {
  /*
   * The title against the subject is the signal. Everything else is a bonus.
   *
   * The first version tokenised the task's notes and the thread's snippet into
   * one bag with the title and the subject, and it matched a contract task to
   * a mail about a weight vest because both bodies happened to contain the
   * same four Hebrew function words. A task IS its title; a thread IS its
   * subject. The bodies can corroborate and they can no longer decide.
   */
  const titleWords = new Set(words([task.title, task.nextStep, task.tags.join(' ')].filter(Boolean).join(' ')));
  const bodyWords = new Set(words(task.description ?? ''));
  const subjectWords = new Set(words(thread.subject ?? ''));
  const snippetWords = new Set(words(thread.snippet ?? ''));

  const shared = [...titleWords].filter((w) => subjectWords.has(w));
  const corroborating = [
    ...[...titleWords].filter((w) => !subjectWords.has(w) && snippetWords.has(w)),
    ...[...bodyWords].filter((w) => !titleWords.has(w) && subjectWords.has(w)),
  ];

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
   * has a gmail.com in the thread — and so is his own, which is in every
   * internal thread there is.
   */
  const domains = dedupe(addresses.map(domainOf).filter((d) => d && !PUBLIC_DOMAINS.has(d) && !OURS.has(d)));
  const domainHit = domains.find((d) => {
    const stem = d.split('.')[0] ?? '';
    return stem.length >= 4 && titleWords.has(stem);
  });

  /** A label he applied by hand that the task also carries as a tag. */
  const tagSet = new Set(task.tags.map((t) => t.toLowerCase().trim()).filter(Boolean));
  const labelHit = thread.labels
    .map((l) => l.toLowerCase().trim())
    .find((l) => tagSet.has(l));

  const reasons = [];
  let score = 0;

  /*
   * Ranked by how much each shared word actually narrows things down, so
   * "pangle" counts and "ads" barely does. Capped at four: a subject quoting
   * the whole title is not five times as relevant as one naming the two words
   * that matter.
   */
  const ranked = [...shared].sort((a, b) => weightOf(b, spread) - weightOf(a, spread));
  /*
   * The words that could carry the match by themselves. With no corpus to
   * judge by — one pair scored in isolation — every word counts, which is the
   * documented default and why the sweep always passes the corpus.
   */
  const telling = ranked.filter((w) => {
    const seen = spread.get(w) ?? 0;
    if (seen > NAMES_SOMETHING) return false;
    /*
     * Rarity cannot judge a Hebrew word here.
     *
     * His mailbox is overwhelmingly English, so EVERY Hebrew word is rare in
     * it — which made "עומד", "פגישת", "נתונים" and "לקראת" look as
     * distinctive as a partner's name, and each of them matched a task to a
     * thread on its own. The corpus has nothing to say about them.
     *
     * What it can go on instead is length. A transliterated company name is
     * long — אאוטבריין, סטרימלויאל, מרקיטו — and Hebrew's everyday words are
     * short. A short Hebrew word therefore needs the same corroboration any
     * ordinary word needs: a second word, a person, a domain.
     */
    if (isHebrew(w) && w.length < 6) return false;
    return true;
  });

  /*
   * How much of the two short strings the overlap actually covers.
   *
   * Counting words alone cannot tell "Re: ADnimation Account Transition"
   * against a task of the same name — two ordinary words, worth almost nothing
   * each — from a task that merely contains the word "account" somewhere. The
   * first is the same subject line; the second is a coincidence. Coverage is
   * what separates them.
   */
  const coverage = shared.length === 0
    ? 0
    : shared.length / Math.max(1, Math.min(titleWords.size, subjectWords.size));

  if (shared.length > 0) {
    /*
     * The first word carries most of it. One rare word — a partner's name, a
     * product — is the match; the ones after it corroborate. Weighting them
     * equally meant a subject naming "pangle" scored the same as one naming
     * "ads" twice.
     */
    score += Math.round(
      ranked
        .slice(0, 4)
        .reduce((sum, w, i) => sum + (i === 0 ? 30 : 12) * weightOf(w, spread), 0),
    );
    if (shared.length >= 2) score += Math.round(20 * coverage);
    reasons.push(`subject says ${ranked.slice(0, 4).join(', ')}`);
  }
  if (corroborating.length > 0) {
    score += Math.min(corroborating.length, 3) * 4;
  }
  if (onBoth.length > 0) {
    score += 14;
    const name = thread.counterpartName && onBoth.includes(String(thread.counterpartEmail).toLowerCase())
      ? thread.counterpartName
      : onBoth[0];
    reasons.push(`with ${name}`);
  }
  if (domainHit) {
    score += 24;
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
   * What makes it a match rather than a coincidence. Every one of these needs
   * the SUBJECT to have named something the task names — none of them is
   * recency, none is a person on their own, and none can be carried by two
   * bodies happening to share a word.
   */
  const strong =
    // One word that names something — a partner, a product, a person.
    telling.length >= 1 ||
    // A word plus the company it belongs to, or a label he applied himself.
    (shared.length >= 1 && (Boolean(domainHit) || Boolean(labelHit))) ||
    // Two ordinary words that are most of both lines: the same subject.
    (shared.length >= 2 && (coverage >= 0.6 || onBoth.length > 0)) ||
    // Or enough ordinary words that they cannot all be coincidence.
    shared.length >= 3 ||
    Boolean(domainHit && onBoth.length > 0);

  return { score, reasons, strong: Boolean(strong) };
}

/** Per task, the best threads — most convincing first. */
export function matchesFor(
  task: TaskSeed,
  threads: ThreadSeed[],
  limit = 5,
  spread: WordSpread = spreadOf(threads),
): MailMatch[] {
  const found = [];
  for (const thread of threads) {
    const hit = scoreThread(task, thread, spread);
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
export function looseCandidates(
  task: TaskSeed,
  threads: ThreadSeed[],
  limit = 10,
  spread: WordSpread = spreadOf(threads),
): MailMatch[] {
  const found = [];
  for (const thread of threads) {
    const s = signalsFor(task, thread, spread);
    // Recency alone scores 6 and means nothing; something must have matched.
    if (s.reasons.length === 0) continue;
    found.push({ threadId: thread.threadId, score: s.score, reasons: s.reasons });
  }
  found.sort((a, b) => b.score - a.score || a.threadId.localeCompare(b.threadId));
  return found.slice(0, limit);
}

/**
 * The whole board at once, with the digests thrown out.
 *
 * This is the only pass that can recognise a digest, because a digest is not
 * identifiable from one task: "Daily Summary | Adnimation" looks like a
 * perfect match to each of the twenty-seven tasks it lists. It is only
 * obviously wrong when you can see that it matched all of them.
 *
 * So the per-task rules run first and this drops any thread that came back for
 * more than MAX_TASKS_PER_THREAD of them — which catches the cockpit's own
 * daily mail, the meeting-notes mail that lists everything discussed, and the
 * recurring invitation, without a list of subjects for anyone to maintain.
 */
export function sweepMatches(
  tasks: TaskSeed[],
  threads: ThreadSeed[],
  limit = 5,
): Map<string, MailMatch[]> {
  const perTask = new Map<string, MailMatch[]>();
  const spread = new Map<string, number>();
  // How common each word is across the whole mailbox, counted once.
  const rarity = spreadOf(threads);

  for (const task of tasks) {
    const found = matchesFor(task, threads, limit, rarity);
    if (found.length === 0) continue;
    perTask.set(task.id, found);
    for (const hit of found) spread.set(hit.threadId, (spread.get(hit.threadId) ?? 0) + 1);
  }

  const tooBroad = new Set(
    [...spread.entries()].filter(([, n]) => n > MAX_TASKS_PER_THREAD).map(([id]) => id),
  );

  const out = new Map<string, MailMatch[]>();
  for (const [taskId, found] of perTask) {
    const kept = found.filter((hit) => !tooBroad.has(hit.threadId));
    if (kept.length > 0) out.set(taskId, kept);
  }
  return out;
}

/** The threads this sweep judged to be digests, for the job's log. */
export function digestsIn(tasks: TaskSeed[], threads: ThreadSeed[], limit = 5): string[] {
  const spread = new Map<string, number>();
  const rarity = spreadOf(threads);
  for (const task of tasks) {
    for (const hit of matchesFor(task, threads, limit, rarity)) {
      spread.set(hit.threadId, (spread.get(hit.threadId) ?? 0) + 1);
    }
  }
  return [...spread.entries()].filter(([, n]) => n > MAX_TASKS_PER_THREAD).map(([id]) => id);
}
