import { describe, expect, it } from 'vitest';
import {
  buildCadence, splitCadence, type CadenceInputs, type DelegationInput, type RevenueAnomalyInput,
  type TaskInput,
} from '@/lib/cadence/engine';
import type { ContractRecord } from '@/lib/contracts/status';

const NOW = new Date('2026-08-29T09:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const task = (over: Partial<TaskInput> = {}): TaskInput => ({
  id: 't1',
  title: 'Do the thing',
  priority: 'P2',
  dueDate: '2026-09-30',
  moneyImpactCents: null,
  blockedPeopleCount: 0,
  ownerIsMe: false,
  deptCode: 'CORE',
  isMine: true,
  status: 'open',
  ...over,
});

const contract = (over: Partial<ContractRecord> = {}): ContractRecord => ({
  id: 'c1',
  counterparty: 'PubMatic',
  category: 'demand',
  docType: 'IO',
  status: 'out_for_signature',
  statusChangedAt: daysAgo(1),
  endDate: null,
  noticePeriodDays: null,
  valueCents: 500_000,
  owner: null,
  deptCode: 'DISP',
  driveFolderPath: null,
  needsReview: false,
  sourceUrl: null,
  ...over,
});

const empty: CadenceInputs = { tasks: [], contracts: [], delegations: [], anomalies: [] };

describe('buildCadence', () => {
  it('is empty when nothing needs doing', () => {
    expect(buildCadence(empty, NOW)).toEqual([]);
  });

  it('gives every item a verb and a reason', () => {
    const items = buildCadence(
      {
        ...empty,
        tasks: [task({ priority: 'P0', dueDate: '2026-08-20' })],
        contracts: [contract({ status: 'awaiting_my_signature', statusChangedAt: daysAgo(2) })],
      },
      NOW,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.action).toBeTruthy();
      expect(i.title.trim().length).toBeGreaterThan(0);
      expect(i.because.trim().length).toBeGreaterThan(0);
      expect(i.href).toMatch(/^\//);
    }
  });

  it('drops completed tasks', () => {
    expect(buildCadence({ ...empty, tasks: [task({ status: 'done', priority: 'P0' })] }, NOW)).toEqual([]);
  });

  it('reads a task that names a conversation as a call', () => {
    const [item] = buildCadence({ ...empty, tasks: [task({ title: 'Call Ravit about the IO' })] }, NOW);
    expect(item?.action).toBe('CALL');
  });

  it('recognises the Hebrew phrasing for a call too', () => {
    const [item] = buildCadence({ ...empty, tasks: [task({ title: 'לתאם פגישה עם ליאור' })] }, NOW);
    expect(item?.action).toBe('CALL');
  });

  it('treats other tasks as work to close', () => {
    const [item] = buildCadence({ ...empty, tasks: [task({ title: 'Fix the app-ads.txt' })] }, NOW);
    expect(item?.action).toBe('CLOSE');
  });

  it('puts a contract waiting on me above ordinary work', () => {
    const items = buildCadence(
      {
        ...empty,
        tasks: [task({ priority: 'P1', dueDate: '2026-08-25' })],
        contracts: [contract({ status: 'awaiting_my_signature', statusChangedAt: daysAgo(3) })],
      },
      NOW,
    );
    expect(items[0]?.action).toBe('SIGN');
  });

  it('does not chase a contract that has only just gone out', () => {
    const items = buildCadence({ ...empty, contracts: [contract({ statusChangedAt: daysAgo(2) })] }, NOW);
    expect(items).toEqual([]);
  });

  it('chases at seven days and escalates to a decision at twenty-one', () => {
    const at = (d: number) =>
      buildCadence({ ...empty, contracts: [contract({ statusChangedAt: daysAgo(d) })] }, NOW)[0];
    expect(at(7)?.action).toBe('CHASE');
    expect(at(14)?.action).toBe('CHASE');
    expect(at(21)?.action).toBe('DECIDE');
    expect(at(21)!.urgency).toBeGreaterThan(at(7)!.urgency);
  });

  it('raises a renewal, and makes an auto-renew deadline a decision', () => {
    const ordinary = buildCadence(
      { ...empty, contracts: [contract({ status: 'signed', endDate: '2026-10-15', noticePeriodDays: 30 })] },
      NOW,
    )[0];
    expect(ordinary?.action).toBe('REVIEW');

    const closing = buildCadence(
      { ...empty, contracts: [contract({ status: 'signed', endDate: '2026-09-10', noticePeriodDays: 30 })] },
      NOW,
    )[0];
    expect(closing?.action).toBe('DECIDE');
    expect(closing?.because).toContain('renews automatically');
    expect(closing!.urgency).toBeGreaterThan(ordinary!.urgency);
  });

  it('ignores a renewal that is already expired or far off', () => {
    const past = buildCadence(
      { ...empty, contracts: [contract({ status: 'signed', endDate: '2026-01-01', noticePeriodDays: 30 })] },
      NOW,
    );
    expect(past).toEqual([]);

    const distant = buildCadence(
      { ...empty, contracts: [contract({ status: 'signed', endDate: '2027-06-01', noticePeriodDays: 30 })] },
      NOW,
    );
    expect(distant).toEqual([]);
  });

  it('asks for a review when a contract was filed by rule alone', () => {
    const [item] = buildCadence(
      { ...empty, contracts: [contract({ status: 'draft', needsReview: true })] },
      NOW,
    );
    expect(item?.action).toBe('REVIEW');
    expect(item?.because).toContain('not confirmed');
  });

  it('chases a delegation only once it has gone quiet for three days', () => {
    const d = (n: number): DelegationInput => ({
      id: 'd1', what: 'Send the list', person: 'Tomer', lastMovementAt: daysAgo(n), status: 'sent',
    });
    expect(buildCadence({ ...empty, delegations: [d(2)] }, NOW)).toEqual([]);
    const [item] = buildCadence({ ...empty, delegations: [d(5)] }, NOW);
    expect(item?.action).toBe('CHASE');
    expect(item?.title).toContain('Tomer');
  });

  it('turns a revenue anomaly into something to resolve, scaled by severity', () => {
    const a = (severity: RevenueAnomalyInput['severity']): RevenueAnomalyInput => ({
      id: 'a1', label: 'BIDDER', what: 'Down 22% against baseline.', severity,
      moneyImpactCents: 7_500, deptCode: 'BID',
    });
    const crit = buildCadence({ ...empty, anomalies: [a('critical')] }, NOW)[0];
    const watch = buildCadence({ ...empty, anomalies: [a('watch')] }, NOW)[0];
    expect(crit?.action).toBe('RESOLVE');
    expect(crit!.urgency).toBeGreaterThan(watch!.urgency);
  });

  it('orders by urgency, then by money at stake', () => {
    const items = buildCadence(
      {
        ...empty,
        tasks: [
          task({ id: 'cheap', title: 'A', priority: 'P0', dueDate: '2026-08-20', moneyImpactCents: 1_000 }),
          task({ id: 'rich', title: 'B', priority: 'P0', dueDate: '2026-08-20', moneyImpactCents: 5_000_000 }),
        ],
      },
      NOW,
    );
    expect(items[0]?.id).toBe('task:rich');
  });

  it('marks what can be handed off and what cannot', () => {
    const items = buildCadence(
      {
        ...empty,
        contracts: [contract({ status: 'awaiting_my_signature', statusChangedAt: daysAgo(2) })],
        delegations: [{ id: 'd', what: 'x', person: 'Mor', lastMovementAt: daysAgo(9), status: 'sent' }],
      },
      NOW,
    );
    // Signing is the CEO's alone; so is following up on something he delegated.
    expect(items.every((i) => !i.delegable)).toBe(true);
  });
});

describe('splitCadence', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    task({ id: `t${i}`, title: `Task ${i}`, priority: 'P1', dueDate: '2026-08-20' }),
  );

  it('keeps the immediate list short and finishable', () => {
    const split = splitCadence(buildCadence({ ...empty, tasks: many }, NOW));
    expect(split.now).toHaveLength(5);
    expect(split.next).toHaveLength(10);
    expect(split.laterCount).toBe(15);
  });

  it('does not invent items when there are few', () => {
    const split = splitCadence(buildCadence({ ...empty, tasks: many.slice(0, 3) }, NOW));
    expect(split.now).toHaveLength(3);
    expect(split.next).toHaveLength(0);
    expect(split.laterCount).toBe(0);
  });
});
