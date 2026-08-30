import { describe, expect, it } from 'vitest';
import {
  DELEGATION_VIEWS, classify, inView, newDelegationSchema, type DelegationRow,
} from '@/lib/delegation/rules';
import { DELEGATION_STALE_DAYS } from '@/lib/tasks/types';

/**
 * The tracker's judgement calls.
 *
 * "Waiting", "stuck" and "not delivered" are the three states the screen is
 * built around, and each one is a claim about reality that has to be right: a
 * delegation Slack never accepted must never sit quietly in the same list as
 * one somebody is simply slow to answer.
 */

const NOW = new Date('2026-08-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const row = (over: Partial<DelegationRow> = {}): DelegationRow => ({
  id: crypto.randomUUID(),
  title: 'Chase the renewal',
  note: null,
  status: 'sent',
  priority: 'P2',
  dueDate: null,
  delegatedAt: daysAgo(1),
  lastMovementAt: daysAgo(1),
  daysQuiet: 1,
  personId: crypto.randomUUID(),
  personName: 'Mor Azagury',
  personEmail: 'mor@adnimation.com',
  personSlackId: 'U123',
  slackMessageUrl: 'https://slack.com/archives/D1/p1700000000000100',
  slackChannelId: 'D1',
  slackThreadTs: '1700000000.000100',
  clickupTaskId: null,
  replyChannel: null,
  replyAt: null,
  replyAuthor: null,
  replyExcerpt: null,
  replyUrl: null,
  repliesCheckedAt: null,
  nudgeCount: 0,
  lastNudgeAt: null,
  closedAt: null,
  closedNote: null,
  waiting: true,
  stuck: false,
  undelivered: false,
  ...over,
});

describe('classify', () => {
  it('counts the days since the last movement', () => {
    expect(classify(row({ lastMovementAt: daysAgo(5) }), NOW).daysQuiet).toBe(5);
  });

  it('is waiting while nothing has come back', () => {
    expect(classify(row(), NOW).waiting).toBe(true);
  });

  it('stops waiting once there is an answer', () => {
    expect(classify(row({ replyAt: daysAgo(1) }), NOW).waiting).toBe(false);
  });

  it('is never waiting once it is done, however long it sat', () => {
    const done = row({ status: 'done', lastMovementAt: daysAgo(40) });
    expect(classify(done, NOW).waiting).toBe(false);
    expect(classify(done, NOW).stuck).toBe(false);
  });

  it('becomes stuck exactly at the threshold, not before', () => {
    expect(classify(row({ lastMovementAt: daysAgo(DELEGATION_STALE_DAYS - 1) }), NOW).stuck).toBe(
      false,
    );
    expect(classify(row({ lastMovementAt: daysAgo(DELEGATION_STALE_DAYS) }), NOW).stuck).toBe(true);
  });

  it('is not stuck if it was answered, however old the answer', () => {
    const answered = row({ lastMovementAt: daysAgo(30), replyAt: daysAgo(30) });
    expect(classify(answered, NOW).stuck).toBe(false);
  });

  it('flags one Slack never accepted, which is not the same as unanswered', () => {
    const lost = classify(row({ slackMessageUrl: null }), NOW);
    expect(lost.undelivered).toBe(true);
    expect(classify(row(), NOW).undelivered).toBe(false);
  });
});

describe('views', () => {
  it('covers every view the screen offers', () => {
    expect([...DELEGATION_VIEWS]).toEqual(['open', 'waiting', 'answered', 'stuck', 'done']);
  });

  it('open holds everything unfinished, answered or not', () => {
    expect(inView(row(), 'open')).toBe(true);
    expect(inView(row({ replyAt: daysAgo(1), waiting: false }), 'open')).toBe(true);
    expect(inView(row({ status: 'done' }), 'open')).toBe(false);
  });

  it('answered excludes the ones already closed', () => {
    expect(inView(row({ replyAt: daysAgo(1) }), 'answered')).toBe(true);
    expect(inView(row({ replyAt: daysAgo(1), status: 'done' }), 'answered')).toBe(false);
  });

  it('done holds only the closed ones', () => {
    expect(inView(row({ status: 'done' }), 'done')).toBe(true);
    expect(inView(row(), 'done')).toBe(false);
  });
});

describe('handing something over', () => {
  it('needs somebody to hand it to', () => {
    const result = newDelegationSchema.safeParse({ title: 'Do the thing' });
    expect(result.success).toBe(false);
  });

  it('needs to say what is being handed over', () => {
    const result = newDelegationSchema.safeParse({
      delegatedTo: crypto.randomUUID(),
      title: '   ',
    });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0]?.message;
    expect(message).toBe('Say what you are handing over');
  });

  it('takes just a person and a title', () => {
    const parsed = newDelegationSchema.parse({
      delegatedTo: crypto.randomUUID(),
      title: 'Chase the renewal',
    });
    expect(parsed.priority).toBe('P2');
    expect(parsed.alsoClickUp).toBe(true);
  });

  it('treats blank optional fields as unset rather than as values', () => {
    const parsed = newDelegationSchema.parse({
      delegatedTo: crypto.randomUUID(),
      title: 'Chase the renewal',
      note: '',
      dueDate: '',
    });
    expect(parsed.note).toBeNull();
    expect(parsed.dueDate).toBeNull();
  });

  it('rejects a date that is not a date', () => {
    const result = newDelegationSchema.safeParse({
      delegatedTo: crypto.randomUUID(),
      title: 'Chase the renewal',
      dueDate: 'next tuesday',
    });
    expect(result.success).toBe(false);
  });
});
