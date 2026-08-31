import { describe, expect, it } from 'vitest';
import {
  buildBoard, filingTree, laneFor, type ContractView,
} from '@/lib/contracts/board';
import { filingFolder } from '@/lib/contracts/drive';
import {
  daysSince, escalationFor, renewalState, type ContractStatus,
} from '@/lib/contracts/status';

const NOW = new Date('2026-08-29T09:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function view(over: Partial<ContractView> = {}): ContractView {
  const status = over.status ?? 'out_for_signature';
  const statusChangedAt = over.statusChangedAt ?? daysAgo(1);
  const category = over.category ?? 'demand';
  const counterparty = over.counterparty ?? 'PubMatic';
  const stage = status === 'signed' || status === 'expired' ? 'signed' : 'in_review';

  return {
    id: 'c1',
    counterparty,
    category,
    docType: 'IO',
    docTypeLabel: 'IO',
    status,
    statusChangedAt,
    endDate: null,
    noticePeriodDays: null,
    valueCents: 500_000,
    owner: null,
    deptCode: 'DISP',
    driveFolderPath: null,
    needsReview: false,
    sourceUrl: null,
    partnerName: null,
    deptName: null,
    filing: filingFolder(counterparty, category, stage),
    escalation: escalationFor(status, statusChangedAt, NOW),
    renewal: renewalState(over.endDate ?? null, over.noticePeriodDays ?? null, NOW),
    daysInStatus: daysSince(statusChangedAt, NOW),
    ...over,
  };
}

describe('laneFor', () => {
  it('separates what is on me from what is on them', () => {
    expect(laneFor('awaiting_my_signature')).toBe('on_me');
    expect(laneFor('out_for_signature')).toBe('on_them');
    expect(laneFor('draft')).toBe('on_us');
    expect(laneFor('negotiation')).toBe('on_us');
  });

  it('gives a settled contract no lane — it is not waiting on anyone', () => {
    for (const s of ['signed', 'expired', 'cancelled'] as ContractStatus[]) {
      expect(laneFor(s)).toBeNull();
    }
  });
});

describe('buildBoard', () => {
  it('is empty, not broken, when there are no contracts', () => {
    const board = buildBoard([]);
    expect(board.lanes.map((l) => l.lane)).toEqual(['on_me', 'on_them', 'on_us']);
    expect(board.lanes.every((l) => l.items.length === 0)).toBe(true);
    expect(board.totals).toEqual({ open: 0, openValueCents: 0, oldestDays: 0 });
  });

  it('places each open contract in exactly one lane', () => {
    const board = buildBoard([
      view({ id: 'a', status: 'awaiting_my_signature' }),
      view({ id: 'b', status: 'out_for_signature' }),
      view({ id: 'c', status: 'negotiation' }),
      view({ id: 'd', status: 'signed' }),
    ]);
    const placed = board.lanes.flatMap((l) => l.items.map((i) => i.id));
    expect(placed.sort()).toEqual(['a', 'b', 'c']);
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('puts the longest wait at the top of its lane', () => {
    const board = buildBoard([
      view({ id: 'fresh', statusChangedAt: daysAgo(1), daysInStatus: 1 }),
      view({ id: 'stale', statusChangedAt: daysAgo(19), daysInStatus: 19 }),
      view({ id: 'middling', statusChangedAt: daysAgo(8), daysInStatus: 8 }),
    ]);
    const them = board.lanes.find((l) => l.lane === 'on_them');
    expect(them?.items.map((i) => i.id)).toEqual(['stale', 'middling', 'fresh']);
  });

  it('counts open value and the oldest wait, ignoring settled contracts', () => {
    const board = buildBoard([
      view({ id: 'a', valueCents: 100_000, statusChangedAt: daysAgo(4), daysInStatus: 4 }),
      view({ id: 'b', valueCents: 250_000, statusChangedAt: daysAgo(12), daysInStatus: 12 }),
      view({ id: 'c', status: 'signed', valueCents: 900_000, daysInStatus: 300 }),
    ]);
    expect(board.totals).toEqual({ open: 2, openValueCents: 350_000, oldestDays: 12 });
    expect(board.signedCount).toBe(1);
  });

  it('treats a missing contract value as zero rather than dropping the row', () => {
    const board = buildBoard([view({ valueCents: null })]);
    expect(board.totals.open).toBe(1);
    expect(board.totals.openValueCents).toBe(0);
  });

  it('raises signed contracts that have entered a renewal notice window, soonest first', () => {
    const board = buildBoard([
      view({ id: 'far', status: 'signed', endDate: '2026-11-20', noticePeriodDays: 30 }),
      view({ id: 'soon', status: 'signed', endDate: '2026-09-20', noticePeriodDays: 30 }),
      view({ id: 'distant', status: 'signed', endDate: '2027-06-01', noticePeriodDays: 30 }),
    ]);
    expect(board.renewals.map((r) => r.id)).toEqual(['soon', 'far']);
  });

  it('lists every contract whose filing category no person has confirmed', () => {
    const board = buildBoard([
      view({ id: 'guessed', needsReview: true }),
      view({ id: 'confirmed', needsReview: false }),
      view({ id: 'dropped', needsReview: true, status: 'cancelled' }),
    ]);
    expect(board.unconfirmed.map((c) => c.id)).toEqual(['guessed']);
  });
});

describe('filingTree', () => {
  it('groups counterparties under their Drive category, demand before supply', () => {
    const tree = filingTree([
      view({ id: '1', counterparty: 'Sports 5', category: 'supply' }),
      view({ id: '2', counterparty: 'PubMatic', category: 'demand' }),
      view({ id: '3', counterparty: 'Landlord', category: 'general' }),
    ]);
    expect(tree.map((n) => n.label)).toEqual(['Demand', 'Supply', 'General']);
    expect(tree[0]?.counterparties[0]?.path).toContain('/Demand/PubMatic/');
  });

  it('folds several contracts with one counterparty into a single folder', () => {
    const tree = filingTree([
      view({ id: '1', counterparty: 'PubMatic', docType: 'IO' }),
      view({ id: '2', counterparty: 'PubMatic', docType: 'MSA' }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.counterparties).toHaveLength(1);
    expect(tree[0]?.counterparties[0]?.count).toBe(2);
  });

  it('marks a counterparty unconfirmed if any of its contracts is', () => {
    const tree = filingTree([
      view({ id: '1', counterparty: 'PubMatic', needsReview: false }),
      view({ id: '2', counterparty: 'PubMatic', needsReview: true }),
    ]);
    expect(tree[0]?.counterparties[0]?.confirmed).toBe(false);
  });

  it('sorts counterparties by name inside a category', () => {
    const tree = filingTree([
      view({ id: '1', counterparty: 'Zeta' }),
      view({ id: '2', counterparty: 'Alpha' }),
    ]);
    expect(tree[0]?.counterparties.map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('the chase ladder as the page uses it', () => {
  const at = (days: number) => escalationFor('out_for_signature', daysAgo(days), NOW);

  it('stays quiet for the first week, then climbs at 7, 14 and 21 days', () => {
    expect(at(6).level).toBe(0);
    expect(at(7).level).toBe(1);
    expect(at(14).level).toBe(2);
    expect(at(21).level).toBe(3);
    expect(at(60).level).toBe(3);
  });

  it('does not chase a contract that is nobody else’s to move', () => {
    expect(escalationFor('draft', daysAgo(90), NOW).level).toBe(0);
    expect(escalationFor('negotiation', daysAgo(90), NOW).level).toBe(0);
    expect(escalationFor('signed', daysAgo(90), NOW).level).toBe(0);
  });

  it('names the action at every rung, so a row is never just a colour', () => {
    for (const days of [0, 7, 14, 21]) {
      expect(at(days).action.trim().length).toBeGreaterThan(0);
      expect(at(days).label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('renewalState', () => {
  it('says nothing about a contract with no end date', () => {
    expect(renewalState(null, 30, NOW)).toEqual({
      daysToExpiry: null, noticeWindow: null, expired: false, noticeDeadlinePassed: false,
    });
  });

  it('crosses the notice windows at 90, 60, 30, 14 and 7 days', () => {
    const on = (endDate: string) => renewalState(endDate, null, NOW).noticeWindow;
    expect(on('2027-01-01')).toBeNull();
    expect(on('2026-11-20')).toBe(90);
    expect(on('2026-09-20')).toBe(30);
    expect(on('2026-09-04')).toBe(7);
  });

  it('flags the expensive case: the cancellation window has closed', () => {
    // 30-day notice, 12 days left — cancelling is no longer possible, so this
    // renews itself unless someone decides now.
    const r = renewalState('2026-09-10', 30, NOW);
    expect(r.noticeDeadlinePassed).toBe(true);
    expect(r.expired).toBe(false);
  });

  it('does not flag a contract that still has room to cancel', () => {
    expect(renewalState('2026-12-01', 30, NOW).noticeDeadlinePassed).toBe(false);
  });

  it('reports an expired contract as expired, not as urgent', () => {
    const r = renewalState('2026-01-01', 30, NOW);
    expect(r.expired).toBe(true);
    expect(r.noticeDeadlinePassed).toBe(false);
  });
});
