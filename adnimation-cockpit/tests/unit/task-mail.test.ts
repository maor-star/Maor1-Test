import { describe, expect, it } from 'vitest';
import {
  domainOf, looseCandidates, matchesFor, MIN_SCORE, scoreThread, words,
  type TaskSeed, type ThreadSeed,
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

  it('will not match on one weak word in common', () => {
    const hit = scoreThread(
      task({ title: 'Reconnect the CTV endpoint', people: [] }),
      thread({
        subject: 'Endpoint monitoring is live',
        snippet: 'dashboards are up',
        counterpartEmail: 'ops@vendor.io',
        participants: ['ops@vendor.io'],
      }),
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
    const english = thread({ subject: 'Nexxen CTV reconnect' });
    expect(scoreThread(hebrew, english)).toBeNull();
    expect(looseCandidates(hebrew, [english]).map((c) => c.threadId)).toEqual(['th1']);
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
