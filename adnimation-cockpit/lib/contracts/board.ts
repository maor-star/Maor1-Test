import { CATEGORY_FOLDER, type ContractCategory, type FilingTarget } from './drive';
import {
  OPEN_STATUSES, type ContractRecord, type ContractStatus, type EscalationStep, type RenewalState,
} from './status';

/**
 * The contracts module — spec §9.
 *
 * The question the screen answers is "what is waiting, and on whom". Every
 * contract is therefore placed in exactly one of three lanes — on me, on them,
 * on us — and carries the Drive folder it belongs in, so filing is visible
 * before a document is ever moved.
 */

export interface ContractView extends ContractRecord {
  partnerName: string | null;
  deptName: string | null;
  docTypeLabel: string;
  /** Where this contract's documents belong in Drive, computed, never guessed. */
  filing: FilingTarget;
  escalation: EscalationStep;
  renewal: RenewalState;
  daysInStatus: number;
}

/** The three lanes. Which lane a contract is in is the whole point of the page. */
export type Lane = 'on_me' | 'on_them' | 'on_us';

export const LANE_LABEL: Record<Lane, string> = {
  on_me: 'WAITING ON ME',
  on_them: 'WAITING ON THEM',
  on_us: 'OUR MOVE',
};

export const LANE_NOTE: Record<Lane, string> = {
  on_me: 'Signed by them. Nothing happens until I sign.',
  on_them: 'Sent out. The chase ladder runs at 7, 14 and 21 days.',
  on_us: 'Drafting or negotiating — the next move is ours to make.',
};

export function laneFor(status: ContractStatus): Lane | null {
  if (status === 'awaiting_my_signature') return 'on_me';
  if (status === 'out_for_signature') return 'on_them';
  if (status === 'draft' || status === 'negotiation') return 'on_us';
  return null;
}

export interface ContractBoard {
  lanes: { lane: Lane; items: ContractView[] }[];
  /** Signed contracts inside a renewal notice window — spec 9.4. */
  renewals: ContractView[];
  signedCount: number;
  /** Contracts whose Drive category has never been confirmed by a person. */
  unconfirmed: ContractView[];
  totals: { open: number; openValueCents: number; oldestDays: number };
}

/** Everything the contracts screen needs, arranged in one pass. */
export function buildBoard(all: ContractView[]): ContractBoard {
  const open = all.filter((c) => OPEN_STATUSES.includes(c.status));

  const lanes: ContractBoard['lanes'] = (['on_me', 'on_them', 'on_us'] as Lane[]).map((lane) => ({
    lane,
    items: open
      .filter((c) => laneFor(c.status) === lane)
      // Longest wait first: the contract that has been silent for three weeks
      // is the one that needs a decision, not the one sent this morning.
      .sort((a, b) => b.daysInStatus - a.daysInStatus),
  }));

  const renewals = all
    .filter((c) => c.status === 'signed' && c.renewal.noticeWindow !== null)
    .sort((a, b) => (a.renewal.daysToExpiry ?? 0) - (b.renewal.daysToExpiry ?? 0));

  return {
    lanes,
    renewals,
    signedCount: all.filter((c) => c.status === 'signed').length,
    unconfirmed: all.filter((c) => c.needsReview && c.status !== 'cancelled'),
    totals: {
      open: open.length,
      openValueCents: open.reduce((a, c) => a + (c.valueCents ?? 0), 0),
      oldestDays: open.reduce((a, c) => Math.max(a, c.daysInStatus), 0),
    },
  };
}


/**
 * How the Drive tree looks for the contracts we hold — spec 9.5. Rendered
 * beside the lanes so the CEO can see filing without opening Drive.
 */
export interface FilingNode {
  category: ContractCategory | null;
  label: string;
  counterparties: { name: string; path: string; count: number; confirmed: boolean }[];
}

export function filingTree(items: ContractView[]): FilingNode[] {
  const byCategory = new Map<string, FilingNode>();

  for (const c of items) {
    const key = c.category ?? '_unclassified';
    const node = byCategory.get(key) ?? {
      category: c.category,
      label: c.category ? CATEGORY_FOLDER[c.category] : '_Unclassified',
      counterparties: [],
    };
    const existing = node.counterparties.find((x) => x.name === c.counterparty);
    if (existing) {
      existing.count += 1;
      existing.confirmed = existing.confirmed && !c.needsReview;
    } else {
      node.counterparties.push({
        name: c.counterparty,
        path: c.filing.path,
        count: 1,
        confirmed: !c.needsReview,
      });
    }
    byCategory.set(key, node);
  }

  for (const node of byCategory.values()) {
    node.counterparties.sort((a, b) => a.name.localeCompare(b.name));
  }

  const order = ['demand', 'supply', 'general', '_unclassified'];
  return [...byCategory.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([, node]) => node);
}

