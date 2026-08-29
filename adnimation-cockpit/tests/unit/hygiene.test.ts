import { describe, expect, it } from 'vitest';
import { evaluateHygiene, type HygieneSnapshot } from '@/lib/tasks/hygiene';

const NOW = new Date('2026-08-29T09:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const task = (over: Partial<HygieneSnapshot> = {}): HygieneSnapshot => ({
  id: '11111111-1111-1111-1111-111111111111',
  title: 'בדיקה',
  priority: 'P2',
  status: 'open',
  dueDate: '2026-09-30',
  ownerPersonId: '22222222-2222-2222-2222-222222222222',
  ownerIsCeo: false,
  snoozeCount: 0,
  createdAt: hoursAgo(1),
  updatedAt: hoursAgo(1),
  ...over,
});

const codes = (t: HygieneSnapshot) => evaluateHygiene(t, NOW).map((v) => v.code);

describe('evaluateHygiene', () => {
  it('finds nothing wrong with a healthy task', () => {
    expect(codes(task())).toEqual([]);
  });

  it('ignores completed tasks entirely', () => {
    const done = task({ status: 'done', ownerPersonId: null, priority: 'P0', snoozeCount: 9, createdAt: daysAgo(60) });
    expect(codes(done)).toEqual([]);
  });

  it('flags an ownerless task only after the 24-hour grace period', () => {
    expect(codes(task({ ownerPersonId: null, createdAt: hoursAgo(23) }))).not.toContain('NO_OWNER');
    expect(codes(task({ ownerPersonId: null, createdAt: hoursAgo(25) }))).toContain('NO_OWNER');
  });

  it('flags a P0 or P1 with no due date', () => {
    expect(codes(task({ priority: 'P0', dueDate: null }))).toContain('NO_DUE_DATE_HIGH_PRIORITY');
    expect(codes(task({ priority: 'P1', dueDate: null }))).toContain('NO_DUE_DATE_HIGH_PRIORITY');
  });

  it('does not demand a due date from P2 or P3', () => {
    expect(codes(task({ priority: 'P2', dueDate: null }))).not.toContain('NO_DUE_DATE_HIGH_PRIORITY');
    expect(codes(task({ priority: 'P3', dueDate: null }))).not.toContain('NO_DUE_DATE_HIGH_PRIORITY');
  });

  it('escalates a P0 that has not moved for three days', () => {
    expect(codes(task({ priority: 'P0', updatedAt: daysAgo(2) }))).not.toContain('P0_NOT_MOVING');
    expect(codes(task({ priority: 'P0', updatedAt: daysAgo(3) }))).toContain('P0_NOT_MOVING');
  });

  it('raises P0 stalls as critical', () => {
    const [violation] = evaluateHygiene(task({ priority: 'P0', updatedAt: daysAgo(5) }), NOW)
      .filter((v) => v.code === 'P0_NOT_MOVING');
    expect(violation?.severity).toBe('critical');
  });

  it('does not escalate a stalled P1 under the same rule', () => {
    expect(codes(task({ priority: 'P1', updatedAt: daysAgo(10) }))).not.toContain('P0_NOT_MOVING');
  });

  it('marks a task snoozed three times as a Zombie', () => {
    expect(codes(task({ snoozeCount: 2 }))).not.toContain('ZOMBIE');
    expect(codes(task({ snoozeCount: 3 }))).toContain('ZOMBIE');
  });

  it('suggests handing over a task the CEO has held for over 21 days', () => {
    expect(codes(task({ ownerIsCeo: true, createdAt: daysAgo(21) }))).not.toContain('CEO_HOLDING_TOO_LONG');
    expect(codes(task({ ownerIsCeo: true, createdAt: daysAgo(22) }))).toContain('CEO_HOLDING_TOO_LONG');
  });

  it('reports every violation a single task trips at once', () => {
    const bad = task({
      priority: 'P0',
      dueDate: null,
      ownerPersonId: null,
      snoozeCount: 4,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(9),
    });
    expect(codes(bad).sort()).toEqual(
      ['NO_DUE_DATE_HIGH_PRIORITY', 'NO_OWNER', 'P0_NOT_MOVING', 'ZOMBIE'].sort(),
    );
  });

  it('gives every violation a recommended action, never a bare complaint', () => {
    const violations = evaluateHygiene(
      task({ priority: 'P0', dueDate: null, ownerPersonId: null, snoozeCount: 5, createdAt: daysAgo(40), updatedAt: daysAgo(9) }),
      NOW,
    );
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.recommendedAction.trim().length).toBeGreaterThan(0);
      expect(v.whatHappened.trim().length).toBeGreaterThan(0);
    }
  });
});
