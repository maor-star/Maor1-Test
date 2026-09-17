import { describe, expect, it } from 'vitest';
import {
  domainOf, looseCandidates, matchesFor, MAX_TASKS_PER_THREAD, MIN_SCORE, othersOn,
  scoreThread, spreadOf, sweepMatches, weightOf, words, type TaskSeed, type ThreadSeed,
} from '@/lib/tasks/mail-match';

/**
 * Which emails belong to which task.
 *
 * The thing to protect here is precision, not recall. A task showing three
 * wrong conversations is a task he stops reading the conversations on, and the
 * feature is then worse than not having it — so most of these cases are about
 * what must NOT match.
 */

const task = (over: Partial<TaskSeed> = {}): TaskSeed => ({
  id: 't1',
  title: 'Nexxen CTV endpoint reconnect',
  description: null,
  nextStep: null,
  tags: [],
  people: ['assaf@adnimation.com'],
  createdAt: '2026-09-10T08:00:00Z',
  ...over,
});

const thread = (over: Partial<ThreadSeed> = {}): ThreadSeed => ({
  threadId: 'th1',
  subject: 'Nexxen CTV endpoint',
  snippet: 'the endpoint needs reconnecting on our side',
  counterpartName: 'Dan Levi',
  counterpartEmail: 'dan@nexxen.com',
  participants: ['dan@nexxen.com', 'maor@adnimation.com'],
  labels: [],
  lastMessageAt: '2026-09-11T08:00:00Z',
  ...over,
});

describe('tokenising', () => {
  it('reads Hebrew and English the same way', () => {
    expect(words('Reconnect the CTV endpoint')).toContain('reconnect');
    expect(words('לחבר מחדש את הנקודה')).toContain('לחבר');
  });

  it('throws away the words that are in half the mailbox', () => {
    const out = words('Re: FW: Adnimation meeting update — thanks');
    expect(out).not.toContain('re');
    expect(out).not.toContain('adnimation');
    expect(out).not.toContain('meeting');
    expect(out).not.toContain('update');
  });

  it('throws away words too short to mean anything', () => {
    expect(words('a to be so')).toEqual([]);
  });

  it('reads the company out of an address', () => {
    expect(domainOf('dan@nexxen.com')).toBe('nexxen.com');
    expect(domainOf('not-an-address')).toBe('');
  });
});

describe('what matches', () => {
  it('matches a thread that names what the task names', () => {
    const hit = scoreThread(task(), thread());
    expect(hit).not.toBeNull();
    expect(hit!.score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(hit!.reasons.join(' ')).toMatch(/nexxen|ctv|endpoint/);
  });

  it('says why, in words that appear on the row', () => {
    const hit = scoreThread(task(), thread());
    expect(hit!.reasons.length).toBeGreaterThan(0);
    expect(hit!.reasons.join(' ')).not.toBe('');
  });

  it('matches on the counterpart’s company when the task names it', () => {
    const hit = scoreThread(
      task({ title: 'Nexxen integration paperwork' }),
      thread({ subject: 'Integration paperwork', snippet: 'signed and returned' }),
    );
    expect(hit).not.toBeNull();
    expect(hit!.reasons.join(' ')).toContain('nexxen.com');
  });
});

describe('what must not match', () => {
  it('will not match on a person alone', () => {
    // He mails Assaf about fifty things a week. "Assaf is on this task and
    // Assaf is in this thread" says nothing at all.
    const hit = scoreThread(
      task(),
      thread({
        subject: 'Lunch tomorrow?',
        snippet: 'are you free at one',
        counterpartName: 'Assaf Kalderon',
        counterpartEmail: 'assaf@adnimation.com',
        participants: ['assaf@adnimation.com'],
      }),
    );
    expect(hit).toBeNull();
  });

  it('will not match on being recent', () => {
    const hit = scoreThread(
      task(),
      thread({
        subject: 'Invoice 4412',
        snippet: 'attached, due in 30 days',
        counterpartName: 'Billing',
        counterpartEmail: 'billing@acme.io',
        participants: ['billing@acme.io'],
        lastMessageAt: '2026-09-10T09:00:00Z',
      }),
    );
    expect(hit).toBeNull();
  });

  it('will not match on a free-mail domain everybody is in', () => {
    const hit = scoreThread(
      task({ title: 'Gmail migration plan' }),
      thread({
        subject: 'Hello',
        snippet: 'hi there',
        counterpartEmail: 'someone@gmail.com',
        participants: ['someone@gmail.com'],
      }),
    );
    expect(hit).toBeNull();
  });

  it('will not match on one word that half the mailbox uses', () => {
    // With a corpus to judge by, "endpoint" is furniture. Without one every
    // word looks rare, which is the documented default and is why the sweep
    // always passes the corpus.
    const everyday: ThreadSeed[] = Array.from({ length: 120 }, (_, i) =>
      thread({ threadId: `e${i}`, subject: `Endpoint monitoring ${i}` }),
    );
    const hit = scoreThread(
      task({ title: 'Reconnect the CTV endpoint', people: [] }),
      thread({
        subject: 'Endpoint monitoring is live',
        snippet: 'dashboards are up',
        counterpartEmail: 'ops@vendor.io',
        participants: ['ops@vendor.io'],
      }),
      spreadOf(everyday),
    );
    expect(hit).toBeNull();
  });
});

describe('how many and in what order', () => {
  it('puts the most convincing first and stops at the limit', () => {
    const many: ThreadSeed[] = Array.from({ length: 8 }, (_, i) =>
      thread({ threadId: `t${i}`, subject: `Nexxen CTV endpoint ${i}` }),
    );
    const found = matchesFor(task(), many, 3);
    expect(found).toHaveLength(3);
    expect(found[0]!.score).toBeGreaterThanOrEqual(found[1]!.score);
  });

  it('answers nothing when there is nothing', () => {
    expect(matchesFor(task(), [])).toEqual([]);
  });
});

describe('the shortlist the model reads', () => {
  /*
   * His tasks are Hebrew, the mail is English, and they share one token. The
   * strict rules are right to refuse that and the model is the thing that can
   * answer it, so what matters here is that the candidate reaches the model.
   */
  const hebrew = task({
    title: 'לחבר את נקססן מחדש ל CTV',
    nextStep: 'מחכים לתשובה מהם',
    people: ['assaf@adnimation.com'],
  });

  it('hands over what the rules refused but a reader would ask about', () => {
    /*
     * The only word these two share is "ctv", and in his real mailbox "ctv" is
     * in hundreds of subjects — so the rules are right to refuse it and wrong
     * to be the last word. "לחבר את נקססן מחדש ל CTV" and "Nexxen CTV
     * reconnect" are the same piece of work; only a reader of both languages
     * can say so.
     */
    const mailbox: ThreadSeed[] = Array.from({ length: 150 }, (_, i) =>
      thread({ threadId: `m${i}`, subject: `CTV numbers ${i}` }),
    );
    const english = thread({ subject: 'Nexxen CTV reconnect' });
    const spread = spreadOf([...mailbox, english]);

    expect(scoreThread(hebrew, english, spread)).toBeNull();
    expect(looseCandidates(hebrew, [english], 10, spread).map((c) => c.threadId))
      .toEqual(['th1']);
  });

  it('still leaves out a thread with no signal at all', () => {
    const unrelated = thread({
      threadId: 'junk',
      subject: 'Your parking permit',
      snippet: 'renew by Sunday',
      counterpartEmail: 'parking@city.gov.il',
      participants: ['parking@city.gov.il'],
    });
    expect(looseCandidates(hebrew, [unrelated])).toEqual([]);
  });

  it('is a shortlist, not the whole mailbox', () => {
    const many: ThreadSeed[] = Array.from({ length: 40 }, (_, i) =>
      thread({ threadId: `t${i}`, subject: `CTV note ${i}` }),
    );
    expect(looseCandidates(hebrew, many, 10)).toHaveLength(10);
  });
});

describe('the digest that is about everything', () => {
  /*
   * The first live run matched the cockpit's own "Daily Summary | Adnimation"
   * — which lists his open tasks — to twenty-seven of them. Each match was a
   * perfect word overlap and every one of them was useless. A digest is only
   * visible from a pass that can see the whole board.
   */
  const board: TaskSeed[] = [
    'Nexxen CTV endpoint reconnect',
    'Taboola agreement renewal',
    'Magnite display integration',
    'Sovrn payment reconciliation',
    'Vidazoo bidder throughput',
    'Criteo seat onboarding',
  ].map((title, i) => task({ id: `t${i}`, title, people: [] }));

  // The real one quotes the task titles. That is exactly why it matches.
  const digest = thread({
    threadId: 'digest',
    subject:
      'Daily Summary — Nexxen CTV endpoint reconnect, Taboola agreement renewal, ' +
      'Magnite display integration, Sovrn payment reconciliation, ' +
      'Vidazoo bidder throughput, Criteo seat onboarding',
    snippet: 'everything open today',
    counterpartEmail: 'reports@cockpit.example',
    participants: ['reports@cockpit.example'],
  });

  it('matches every task one at a time, which is the trap', () => {
    const hits = board.filter((t) => scoreThread(t, digest) !== null);
    expect(hits.length).toBeGreaterThan(MAX_TASKS_PER_THREAD);
  });

  it('and is dropped from all of them by the sweep', () => {
    const out = sweepMatches(board, [digest]);
    for (const [, found] of out) {
      expect(found.map((f) => f.threadId)).not.toContain('digest');
    }
  });

  it('leaves a thread that is about one or two tasks alone', () => {
    const real = thread({ threadId: 'real', subject: 'Nexxen CTV endpoint' });
    const out = sweepMatches(board, [real, digest]);
    expect(out.get('t0')?.map((f) => f.threadId)).toEqual(['real']);
  });
});

describe('his own company is not a signal', () => {
  it('will not match on the domain everybody internal shares', () => {
    const hit = scoreThread(
      task({ title: 'Adnimation brand refresh', people: [] }),
      thread({
        subject: 'Hello',
        snippet: 'nothing to do with it',
        counterpartEmail: 'someone@adnimation.com',
        participants: ['someone@adnimation.com'],
      }),
    );
    expect(hit).toBeNull();
  });
});

describe('the body cannot decide on its own', () => {
  it('will not match two notes that share only function words', () => {
    // A contract task matched a mail about a weight vest on הזה / אני / אחד /
    // כדי. The title against the subject is the signal; bodies corroborate.
    const hit = scoreThread(
      task({
        title: 'חוזה של אביטל',
        description: 'אני צריך את זה כדי לסגור את זה, אחד הדברים הכי דחופים',
        people: [],
      }),
      thread({
        subject: 'וסט משקולות',
        snippet: 'אני חושב שזה הדבר הזה שאחד מהחברה המליץ עליו כדי להתאמן',
        counterpartEmail: 'shop@sport.co.il',
        participants: ['shop@sport.co.il'],
      }),
    );
    expect(hit).toBeNull();
  });

  it('still lets the body strengthen a subject that already matched', () => {
    // "throughput" is in the notes and in the subject, and in neither title —
    // exactly the corroboration the body is allowed to give.
    const withBody = scoreThread(
      task({ title: 'Nexxen CTV endpoint reconnect', description: 'throughput has halved since Sunday' }),
      thread({ subject: 'Nexxen CTV endpoint throughput', snippet: 'looking at it' }),
    );
    const without = scoreThread(
      task({ title: 'Nexxen CTV endpoint reconnect', description: null }),
      thread({ subject: 'Nexxen CTV endpoint throughput', snippet: 'looking at it' }),
    );
    expect(withBody!.score).toBeGreaterThan(without!.score);
  });
});

describe('a word is worth what it narrows down', () => {
  /*
   * The alternative was a hand-written list of words to ignore, and I started
   * writing one before noticing it could not work: "ads" is furniture in this
   * mailbox and "pangle" is the whole answer, and which is which changes every
   * time the company signs a new partner.
   */
  const corpus: ThreadSeed[] = [
    ...Array.from({ length: 200 }, (_, i) =>
      thread({ threadId: `c${i}`, subject: `Weekly ads report ${i}` }),
    ),
    thread({ threadId: 'p1', subject: 'Pangle integration' }),
    thread({ threadId: 'p2', subject: 'Pangle contract' }),
  ];

  it('counts how common each word is across the mailbox', () => {
    const spread = spreadOf(corpus);
    expect(spread.get('ads')).toBe(200);
    expect(spread.get('pangle')).toBe(2);
  });

  it('pays full price for a rare word and almost nothing for a everywhere one', () => {
    const spread = spreadOf(corpus);
    expect(weightOf('pangle', spread)).toBe(1);
    expect(weightOf('ads', spread)).toBeLessThan(0.1);
  });

  it('matches on one rare word and refuses one common one', () => {
    const spread = spreadOf(corpus);
    const bio = task({ title: 'Bio ads', people: [] });
    const pangle = task({ title: 'Pangle — Yahoo', people: [] });

    expect(scoreThread(bio, thread({ subject: 'schain and app-ads.txt declaration' }), spread))
      .toBeNull();
    expect(scoreThread(pangle, thread({ subject: 'Re: Pangle' }), spread)).not.toBeNull();
  });

  it('treats every word as rare when there is no corpus, so one pair still scores', () => {
    expect(weightOf('anything', new Map())).toBe(1);
  });
});

describe('whose mailbox it is', () => {
  /*
   * His own address is in every thread in his own mailbox. Counting it as
   * "somebody on this task is in this conversation" handed fourteen points to
   * the entire mailbox and turned a single common word into a match — which is
   * exactly what the first live run did.
   */
  it('is not one of the people a thread can match on', () => {
    expect(othersOn(['maor@adnimation.com', 'assaf@adnimation.com']))
      .toEqual(['assaf@adnimation.com']);
    expect(othersOn(['MAOR@Adnimation.com'])).toEqual([]);
  });

  it('takes whichever mailbox is actually being read', () => {
    expect(othersOn(['a@x.com', 'b@x.com'], 'b@x.com')).toEqual(['a@x.com']);
  });

  it('leaves everyone else alone', () => {
    expect(othersOn(['assaf@adnimation.com', 'ravit@adnimation.com']))
      .toEqual(['assaf@adnimation.com', 'ravit@adnimation.com']);
  });
});
