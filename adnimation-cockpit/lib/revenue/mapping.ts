import type { DeptCode } from '@/lib/tasks/types';
import type { BusinessLine } from './types';

/**
 * Department assignment.
 *
 * The source has two dimensions — business line (trading desk vs. managed
 * publisher) and demand category — while the spec organises the company into
 * eight units (§3). Nothing in the data states which unit owns which
 * combination, and that is a business fact, not something to infer from
 * revenue shapes: guessing it would put confident wrong numbers against a
 * named department on the CEO's morning screen.
 *
 * So the mapping is data, not code. The table below is a starting point, every
 * entry marked unconfirmed until the CEO signs it off. The UI shows an
 * unconfirmed badge, and revenue no rule matches lands in an explicit
 * "unassigned" bucket rather than being silently folded into a department.
 */

export interface DeptRule {
  businessLine: BusinessLine;
  category: string;
  deptCode: DeptCode;
  /** True once a human has confirmed this assignment. */
  confirmed: boolean;
  why: string;
}

export type DeptMapping = DeptRule[];

/**
 * Proposed defaults, derived only from what the source itself distinguishes:
 * `is_trading_account` separates the RTB/trading business from managed
 * publishers, and `category` names the demand type.
 *
 * Deliberately unmapped, because the data gives no signal for them:
 * SEAT (Seat Lease), APP (RTB In-App), DISP (RTB Display), CTV, ASIA.
 */
export const DEFAULT_DEPT_MAPPING: DeptMapping = [
  {
    businessLine: 'publisher', category: 'google', deptCode: 'CORE', confirmed: false,
    why: 'GAM revenue on managed publisher accounts.',
  },
  {
    businessLine: 'publisher', category: 'header_bidding', deptCode: 'CORE', confirmed: false,
    why: 'Header bidding on managed publisher accounts.',
  },
  {
    businessLine: 'publisher', category: 'content_recommendations', deptCode: 'CORE', confirmed: false,
    why: 'Content recommendation widgets on managed publisher sites.',
  },
  {
    businessLine: 'publisher', category: 'ebda', deptCode: 'CORE', confirmed: false,
    why: 'Exchange Bidding on managed publisher accounts.',
  },
  {
    businessLine: 'publisher', category: 'video', deptCode: 'VID', confirmed: false,
    why: 'Video demand on managed publisher accounts.',
  },
  {
    businessLine: 'trading', category: 'video', deptCode: 'VID', confirmed: false,
    why: 'Video demand bought through the trading desk.',
  },
  {
    businessLine: 'trading', category: 'header_bidding', deptCode: 'BID', confirmed: false,
    why: 'Header bidding through the trading desk — the bidder business.',
  },
];

/** Departments the current mapping never assigns, so the UI can say so. */
export const UNMAPPED_DEPTS: DeptCode[] = ['SEAT', 'APP', 'DISP', 'CTV', 'ASIA'];

export interface DeptAssignment {
  deptCode: DeptCode | null;
  confirmed: boolean;
  why: string;
}

export function resolveDept(
  businessLine: BusinessLine,
  category: string,
  mapping: DeptMapping = DEFAULT_DEPT_MAPPING,
): DeptAssignment {
  const rule = mapping.find((r) => r.businessLine === businessLine && r.category === category);
  if (!rule) {
    return {
      deptCode: null,
      confirmed: false,
      why: `No mapping rule for ${businessLine}/${category}`,
    };
  }
  return { deptCode: rule.deptCode, confirmed: rule.confirmed, why: rule.why };
}

/** True while any assignment still rests on an unconfirmed default. */
export function mappingNeedsReview(mapping: DeptMapping = DEFAULT_DEPT_MAPPING): boolean {
  return mapping.some((r) => !r.confirmed);
}
