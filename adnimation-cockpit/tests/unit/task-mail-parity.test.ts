import { describe, expect, it } from 'vitest';
import {
  digestsIn, looseCandidates, matchesFor, othersOn, scoreThread, spreadOf, sweepMatches,
  weightOf, words, type TaskSeed, type ThreadSeed,
} from '@/lib/tasks/mail-match';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/task-mail-match.mjs';

/**
 * The app and the job must agree about which mail belongs to which task.
 *
 * The sweep runs as plain ESM on the server and cannot import the TypeScript,
 * so the rules are generated from it. If the two drift, the job writes links
 * the screen would never have proposed — and the only place that shows up is
 * production.
 */

const TASKS: TaskSeed[] = [
  {
    id: 'a', title: 'Nexxen CTV endpoint reconnect', description: null, nextStep: null,
    tags: [], people: ['assaf@adnimation.com'], createdAt: '2026-09-10T08:00:00Z',
  },
  {
    id: 'b', title: 'לחבר את נקססן מחדש ל CTV', description: 'מחכים לתשובה', nextStep: 'לשלוח תזכורת',
    tags: ['ctv'], people: [], createdAt: '2026-09-01T08:00:00Z',
  },
  {
    id: 'c', title: 'Renew the Taboola agreement', description: null, nextStep: null,
    tags: ['contract'], people: ['ravit@adnimation.com'], createdAt: '2026-08-01T08:00:00Z',
  },
];

const THREADS: ThreadSeed[] = [
  {
    threadId: '1', subject: 'Nexxen CTV endpoint', snippet: 'reconnecting on our side',
    counterpartName: 'Dan', counterpartEmail: 'dan@nexxen.com',
    participants: ['dan@nexxen.com'], labels: [], lastMessageAt: '2026-09-11T08:00:00Z',
  },
  {
    threadId: '2', subject: 'Lunch tomorrow?', snippet: 'are you free',
    counterpartName: 'Assaf', counterpartEmail: 'assaf@adnimation.com',
    participants: ['assaf@adnimation.com'], labels: [], lastMessageAt: '2026-09-11T08:00:00Z',
  },
  {
    threadId: '3', subject: 'Taboola agreement — countersigned', snippet: 'attached',
    counterpartName: 'Legal', counterpartEmail: 'legal@taboola.com',
    participants: ['legal@taboola.com', 'ravit@adnimation.com'], labels: ['contract'],
    lastMessageAt: '2026-08-05T08:00:00Z',
  },
  {
    threadId: '4', subject: 'Your parking permit', snippet: 'renew by Sunday',
    counterpartName: null, counterpartEmail: 'parking@city.gov.il',
    participants: ['parking@city.gov.il'], labels: [], lastMessageAt: '2026-09-11T08:00:00Z',
  },
];

describe('task mail parity', () => {
  it('tokenises identically, in both languages', () => {
    for (const text of ['Re: Nexxen CTV endpoint', 'לחבר את נקססן מחדש', 'Adnimation update 2026']) {
      expect(js.words(text)).toEqual(words(text));
    }
  });

  it('scores every pair identically', () => {
    for (const task of TASKS) {
      for (const thread of THREADS) {
        expect(js.scoreThread(task, thread), `${task.id}/${thread.threadId}`)
          .toEqual(scoreThread(task, thread));
      }
    }
  });

  it('picks and ranks the same matches', () => {
    for (const task of TASKS) {
      expect(js.matchesFor(task, THREADS), task.id).toEqual(matchesFor(task, THREADS));
      expect(js.matchesFor(task, THREADS, 2), task.id).toEqual(matchesFor(task, THREADS, 2));
    }
  });

  it('builds the same shortlist for the model', () => {
    for (const task of TASKS) {
      expect(js.looseCandidates(task, THREADS), task.id).toEqual(looseCandidates(task, THREADS));
      expect(js.looseCandidates(task, THREADS, 2), task.id)
        .toEqual(looseCandidates(task, THREADS, 2));
    }
  });

  it('drops the same digests, and keeps the same links after', () => {
    expect(js.digestsIn(TASKS, THREADS)).toEqual(digestsIn(TASKS, THREADS));
    expect([...js.sweepMatches(TASKS, THREADS).entries()])
      .toEqual([...sweepMatches(TASKS, THREADS).entries()]);
  });

  it('weighs words by rarity identically', () => {
    const spread = spreadOf(THREADS);
    expect([...js.spreadOf(THREADS).entries()].sort()).toEqual([...spread.entries()].sort());
    for (const word of ['nexxen', 'taboola', 'agreement', 'parking']) {
      expect(js.weightOf(word, spread), word).toBe(weightOf(word, spread));
    }
  });

  it('drops the mailbox owner the same way', () => {
    expect(js.othersOn(['maor@adnimation.com', 'assaf@adnimation.com']))
      .toEqual(othersOn(['maor@adnimation.com', 'assaf@adnimation.com']));
    expect(js.othersOn(['a@x.com'], 'a@x.com')).toEqual(othersOn(['a@x.com'], 'a@x.com'));
  });

  it('exports the same threshold and noise list', () => {
    expect(js.MIN_SCORE).toBe(34);
    expect(js.MAX_TASKS_PER_THREAD).toBe(4);
    expect(js.NOISE.has('adnimation')).toBe(true);
    expect(js.NOISE.has('משימה')).toBe(true);
  });
});
