/**
 * Rows in groups — the shape both the tasks table and the contracts table use.
 *
 * He asked for the tasks screen to read like Monday's, then for contracts to
 * match it. That is one pattern, so it lives in one file: the same colours, the
 * same ordering rules, the same bar across the top of a group.
 *
 * Kept apart from either screen's own vocabulary. What a group MEANS — a
 * status, an owner, who is being waited on — belongs to the screen; how groups
 * are built, coloured and ordered belongs here. Two copies of this would drift,
 * and then the two screens would quietly stop looking like one system.
 *
 * No database and no React: this is arithmetic, and it is tested as such.
 */

/**
 * The colours a group can take, named by meaning rather than by hue.
 *
 * So that a task status and a contract status that mean the same kind of thing
 * — this is finished, this needs you — look the same on a screen he scans
 * rather than reads.
 */
export type GroupTone = 'done' | 'working' | 'stuck' | 'waiting' | 'idle' | 'later';

export const GROUP_COLOR: Record<GroupTone, string> = {
  done: '#16a34a',
  working: '#f97316',
  stuck: '#dc2626',
  waiting: '#0ea5e9',
  idle: '#94a3b8',
  later: '#8b5cf6',
};

/** An empty bucket sorts last, whatever it is called. */
export const UNSET_SORT = '￿';

/** Where one row belongs, and where that group belongs among the others. */
export interface Bucket {
  key: string;
  label: string;
  tone: GroupTone;
  /** Compared as a string, so callers pad numbers themselves. */
  sort: string;
}

export interface Group<T> {
  key: string;
  label: string;
  tone: GroupTone;
  rows: T[];
  /** How the group divides up by its own progress column — the bar. */
  mix: { key: string; label: string; tone: GroupTone; count: number; share: number }[];
  /** The share of the group that is finished, for the figure beside the bar. */
  doneShare: number;
}

/**
 * The rows, in groups, in the order the groups should be read.
 *
 * Order is part of the answer rather than decoration: a wall that puts DONE
 * above OVERDUE is a wall he has to read instead of scan. Each screen says
 * what its order is by what it puts in `sort`.
 */
export function buildGroups<T>(
  rows: readonly T[],
  bucketOf: (row: T) => Bucket,
  mixOf: (rows: readonly T[]) => Group<T>['mix'],
  isDone: (row: T) => boolean,
): Group<T>[] {
  const buckets = new Map<string, { label: string; tone: GroupTone; sort: string; rows: T[] }>();

  for (const row of rows) {
    const b = bucketOf(row);
    const found = buckets.get(b.key) ?? { label: b.label, tone: b.tone, sort: b.sort, rows: [] };
    found.rows.push(row);
    buckets.set(b.key, found);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
    .map(([key, b]) => ({
      key,
      label: b.label,
      tone: b.tone,
      rows: b.rows,
      mix: mixOf(b.rows),
      doneShare: b.rows.length === 0 ? 0 : b.rows.filter(isDone).length / b.rows.length,
    }));
}

/**
 * How a group divides up — Monday's battery.
 *
 * The one device on that screen that answers a question without being read: a
 * group that is all green is finished, one with a red band has something stuck
 * in it, and he can tell which from across the room.
 *
 * Ordered by the caller's own workflow order rather than by size. By size the
 * bands would reshuffle every time something moved, and two groups could not
 * be compared.
 */
export function buildMix<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  meta: (key: string) => { label: string; tone: GroupTone; order: number },
): Group<T>['mix'] {
  if (rows.length === 0) return [];

  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => meta(a[0]).order - meta(b[0]).order)
    .map(([key, count]) => {
      const m = meta(key);
      return { key, label: m.label, tone: m.tone, count, share: count / rows.length };
    });
}
