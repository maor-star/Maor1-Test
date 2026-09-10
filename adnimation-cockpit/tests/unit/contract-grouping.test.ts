import { describe, expect, it } from 'vitest';
import {
  ageBucket, CONTRACT_GROUP_BYS, contractStatusMix, groupContracts, isContractGroupBy,
  toneForContractStatus, type GroupableContract,
} from '@/lib/contracts/grouping';
import { ESCALATION_DAYS } from '@/lib/contracts/status';
import { GROUP_COLOR } from '@/lib/hud/grouping';
import { GROUP_COLOR as TASK_GROUP_COLOR } from '@/lib/tasks/grouping';

/**
 * Contracts in groups, reading like the tasks table.
 *
 * He liked that screen and asked for this one to match. Matching is not a
 * matter of taste here — the two screens share the colours and the group
 * shape, and these pin the parts that would drift apart first.
 */

const contract = (over: Partial<GroupableContract> & { id: string }): GroupableContract => ({
  status: 'draft',
  waitingOn: 'nobody',
  category: null,
  counterpartyName: 'Someone',
  daysInStatus: 0,
  ...over,
});

describe('the two tables are one system', () => {
  it('shares a single colour table rather than keeping two', () => {
    // Two copies would drift, and then the same meaning would be two colours.
    expect(TASK_GROUP_COLOR).toBe(GROUP_COLOR);
  });
});

describe('which columns can carry the groups', () => {
  it('leads with the question this screen exists to answer', () => {
    expect(CONTRACT_GROUP_BYS[0]).toBe('waiting');
  });

  it('refuses anything else, so a hand-edited URL cannot break the screen', () => {
    expect(isContractGroupBy('waiting')).toBe(true);
    expect(isContractGroupBy('age')).toBe(true);
    expect(isContractGroupBy('owner')).toBe(false);
    expect(isContractGroupBy(undefined)).toBe(false);
  });
});

describe('grouping by who is being waited on', () => {
  const rows = [
    contract({ id: 'a', waitingOn: 'nobody', status: 'signed' }),
    contract({ id: 'b', waitingOn: 'them', status: 'out_for_signature' }),
    contract({ id: 'c', waitingOn: 'you', status: 'awaiting_my_signature' }),
  ];

  it('puts what he can clear himself at the top', () => {
    // The only lane he can move without anyone else, so it reads first.
    expect(groupContracts(rows, 'waiting').map((g) => g.key)).toEqual(['you', 'them', 'nobody']);
  });

  it('colours his own lane as the one that needs a hand', () => {
    expect(toneForContractStatus('awaiting_my_signature')).toBe('stuck');
    expect(toneForContractStatus('out_for_signature')).toBe('waiting');
    expect(toneForContractStatus('signed')).toBe('done');
  });
});

describe('grouping by how long it has sat', () => {
  it('uses the chase ladder, not round numbers', () => {
    // So a group heading and the chase it implies are the same thing.
    expect(ageBucket(0)).toBe('fresh');
    expect(ageBucket(ESCALATION_DAYS[0])).toBe('week');
    expect(ageBucket(ESCALATION_DAYS[1])).toBe('fortnight');
    expect(ageBucket(ESCALATION_DAYS[2])).toBe('stale');
    expect(ageBucket(60)).toBe('stale');
  });

  it('reads the ones to escalate first', () => {
    const rows = [
      contract({ id: 'new', daysInStatus: 1 }),
      contract({ id: 'old', daysInStatus: 40 }),
      contract({ id: 'mid', daysInStatus: 10 }),
    ];
    expect(groupContracts(rows, 'age').map((g) => g.key)).toEqual(['stale', 'week', 'fresh']);
  });
});

describe('grouping by filing', () => {
  it('sorts what still needs classifying last', () => {
    // It is a pile to work through, not a category — and putting it above the
    // real ones buries them.
    const rows = [
      contract({ id: '1', category: null }),
      contract({ id: '2', category: 'supply' }),
      contract({ id: '3', category: 'demand' }),
    ];
    expect(groupContracts(rows, 'category').map((g) => g.key)).toEqual([
      'demand', 'supply', 'unclassified',
    ]);
  });
});

describe('the bar across a group', () => {
  const rows = [
    contract({ id: '1', status: 'signed' }),
    contract({ id: '2', status: 'signed' }),
    contract({ id: '3', status: 'expired' }),
    contract({ id: '4', status: 'draft' }),
  ];

  it('counts only signed as finished', () => {
    // Expired and cancelled are over, not done. Counting them as progress
    // would flatter every group they land in.
    const [group] = groupContracts(rows, 'counterparty');
    expect(group!.doneShare).toBe(0.5);
  });

  it('divides the group up so the shares fill it exactly', () => {
    const mix = contractStatusMix(rows);
    expect(mix.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1);
    expect(mix.reduce((a, m) => a + m.count, 0)).toBe(4);
  });

  it('runs in workflow order so two groups can be compared', () => {
    expect(contractStatusMix(rows).map((m) => m.key)).toEqual(['draft', 'signed', 'expired']);
  });

  it('is empty for no rows rather than dividing by zero', () => {
    expect(contractStatusMix([])).toEqual([]);
  });
});

/**
 * Every filing category can actually be chosen.
 *
 * `confirmCategory` has always taken all six and the pickers have offered six
 * since `mutual` and `quote` were added, but the action's own schema still
 * named three — so picking one of the other three was refused after the click,
 * with a validation error about a field he had filled in correctly. The
 * grouped table makes filing a one-click cell, which is exactly where that
 * would have bitten.
 */
describe('the filing categories on offer', () => {
  it('is the same list everywhere it appears', async () => {
    const { CONTRACT_CATEGORIES } = await import('@/lib/contracts/drive');
    expect([...CONTRACT_CATEGORIES]).toEqual([
      'demand', 'supply', 'mutual', 'quote', 'consulting', 'general',
    ]);
  });

  it('groups a contract under any of them', () => {
    const rows = (['demand', 'supply', 'mutual', 'quote', 'consulting', 'general'] as const).map(
      (c, i) => contract({ id: `c${i}`, category: c }),
    );
    expect(groupContracts(rows, 'category')).toHaveLength(6);
  });
});
