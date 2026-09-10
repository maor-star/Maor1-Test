import { CONTRACT_CATEGORIES, type ContractCategory } from '@/lib/contracts/drive';
import { CONTRACT_STATUSES, ESCALATION_DAYS, STATUS_LABEL, type ContractStatus } from '@/lib/contracts/status';
import {
  buildGroups, buildMix, GROUP_COLOR, UNSET_SORT, type Bucket, type Group, type GroupTone,
} from '@/lib/hud/grouping';

export { GROUP_COLOR, type GroupTone };
export type ContractGroup<T> = Group<T>;

/**
 * Contracts in groups, the same way the tasks table reads.
 *
 * He liked the tasks screen and asked for this one to match, so the shape and
 * the colours are shared. What is not shared is which columns can carry the
 * groups, because a contract is not a task: the question this screen exists to
 * answer is "what is waiting, and on whom", and there is a chase ladder behind
 * it that a task does not have.
 */

export const CONTRACT_GROUP_BYS = ['waiting', 'status', 'category', 'counterparty', 'age'] as const;
export type ContractGroupBy = (typeof CONTRACT_GROUP_BYS)[number];

export const CONTRACT_GROUP_BY_LABEL: Record<ContractGroupBy, string> = {
  waiting: 'WAITING ON',
  status: 'STATUS',
  category: 'FILING',
  counterparty: 'COUNTERPARTY',
  age: 'HOW LONG',
};

export const isContractGroupBy = (v: unknown): v is ContractGroupBy =>
  typeof v === 'string' && (CONTRACT_GROUP_BYS as readonly string[]).includes(v);

/**
 * What a status means for colour.
 *
 * Signed is finished. Anything waiting on him is the one that needs a hand —
 * it is the only lane he can clear on his own, so it reads as the urgent one
 * rather than as merely "in progress".
 */
const STATUS_TONE: Record<ContractStatus, GroupTone> = {
  unclassified: 'idle',
  draft: 'idle',
  in_review: 'working',
  negotiation: 'working',
  out_for_signature: 'waiting',
  awaiting_my_signature: 'stuck',
  signed: 'done',
  expired: 'later',
  cancelled: 'later',
};

export const toneForContractStatus = (status: string): GroupTone =>
  STATUS_TONE[status as ContractStatus] ?? 'idle';

const statusOrder = (key: string) => {
  const i = (CONTRACT_STATUSES as readonly string[]).indexOf(key);
  return i === -1 ? 99 : i;
};

/** The least a row has to carry to be grouped. */
export interface GroupableContract {
  id: string;
  status: string;
  waitingOn: 'you' | 'them' | 'nobody';
  category: ContractCategory | null;
  counterpartyName: string;
  daysInStatus: number;
}

const WAITING_META: Record<string, { label: string; tone: GroupTone; order: number }> = {
  you: { label: 'WAITING ON YOU', tone: 'stuck', order: 0 },
  them: { label: 'WAITING ON THEM', tone: 'waiting', order: 1 },
  nobody: { label: 'NOBODY — DONE OR PARKED', tone: 'done', order: 2 },
};

const CATEGORY_LABEL: Record<ContractCategory, string> = {
  demand: 'DEMAND',
  supply: 'SUPPLY',
  mutual: 'MUTUAL NDA',
  quote: 'QUOTE',
  consulting: 'CONSULTING',
  general: 'GENERAL',
};

/**
 * How long it has sat, against the chase ladder.
 *
 * The buckets are the ladder from the spec — 7, 14 and 21 days — rather than
 * round numbers, so a group heading and the chase it implies are the same
 * thing. A contract in the 21+ group is one the ladder says to escalate.
 */
export function ageBucket(days: number): 'fresh' | 'week' | 'fortnight' | 'stale' {
  if (days >= ESCALATION_DAYS[2]) return 'stale';
  if (days >= ESCALATION_DAYS[1]) return 'fortnight';
  if (days >= ESCALATION_DAYS[0]) return 'week';
  return 'fresh';
}

const AGE_META: Record<string, { label: string; tone: GroupTone; order: number }> = {
  stale: { label: `${ESCALATION_DAYS[2]}+ DAYS — ESCALATE`, tone: 'stuck', order: 0 },
  fortnight: { label: `${ESCALATION_DAYS[1]}–${ESCALATION_DAYS[2] - 1} DAYS`, tone: 'working', order: 1 },
  week: { label: `${ESCALATION_DAYS[0]}–${ESCALATION_DAYS[1] - 1} DAYS`, tone: 'waiting', order: 2 },
  fresh: { label: `UNDER ${ESCALATION_DAYS[0]} DAYS`, tone: 'idle', order: 3 },
};

function bucketOf<T extends GroupableContract>(row: T, by: ContractGroupBy): Bucket {
  switch (by) {
    case 'waiting': {
      const meta = WAITING_META[row.waitingOn] ?? WAITING_META.nobody!;
      return { key: row.waitingOn, label: meta.label, tone: meta.tone, sort: String(meta.order) };
    }
    case 'status':
      return {
        key: row.status,
        label: STATUS_LABEL[row.status as ContractStatus] ?? row.status.toUpperCase(),
        tone: toneForContractStatus(row.status),
        sort: String(statusOrder(row.status)).padStart(2, '0'),
      };
    case 'category': {
      const c = row.category;
      if (!c) return { key: 'unclassified', label: 'NEEDS CLASSIFYING', tone: 'idle', sort: UNSET_SORT };
      return {
        key: c,
        label: CATEGORY_LABEL[c] ?? c.toUpperCase(),
        tone: 'later',
        sort: String(CONTRACT_CATEGORIES.indexOf(c)).padStart(2, '0'),
      };
    }
    case 'counterparty': {
      const name = row.counterpartyName?.trim();
      return {
        key: name || 'unknown',
        label: name || 'UNKNOWN',
        tone: name ? 'waiting' : 'idle',
        sort: name ? name.toLowerCase() : UNSET_SORT,
      };
    }
    case 'age': {
      const b = ageBucket(row.daysInStatus);
      const meta = AGE_META[b]!;
      return { key: b, label: meta.label, tone: meta.tone, sort: String(meta.order) };
    }
  }
}

const statusMeta = (key: string) => ({
  label: STATUS_LABEL[key as ContractStatus] ?? key.toUpperCase(),
  tone: toneForContractStatus(key),
  order: statusOrder(key),
});

/** How a group's statuses divide up — the bar across its heading. */
export function contractStatusMix<T extends GroupableContract>(rows: readonly T[]) {
  return buildMix(rows, (r) => r.status, statusMeta);
}

export function groupContracts<T extends GroupableContract>(
  rows: readonly T[],
  by: ContractGroupBy,
): ContractGroup<T>[] {
  return buildGroups(
    rows,
    (row) => bucketOf(row, by),
    contractStatusMix,
    // Signed is the only finished state. Expired and cancelled are over, not
    // done, and counting them as progress would flatter every group they land
    // in.
    (row) => row.status === 'signed',
  );
}
