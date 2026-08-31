import { listTasks } from '@/lib/tasks/queries';
import { listOpenDelegations } from '@/lib/delegation/service';
import { contractRecords } from '@/lib/contracts/service';
import { loadRevenueView } from '@/lib/revenue/service';
import { todayInTz } from '@/lib/utils';
import { buildCadence, splitCadence, type CadenceInputs, type CadenceItem } from './engine';

/**
 * Assembles the cadence from everything the cockpit already knows.
 *
 * Each source is loaded independently and a failing one is dropped rather than
 * blanking the queue: a ClickUp outage must not empty the CEO's morning list of
 * contracts and renewals (CLAUDE.md §10 — degrade, never blank).
 */

export interface CadenceView {
  items: CadenceItem[];
  now: CadenceItem[];
  next: CadenceItem[];
  laterCount: number;
  /** Which sources answered, so the page can say what it could not reach. */
  sources: { name: string; ok: boolean; count: number }[];
}

const settled = async <T>(name: string, load: () => Promise<T[]>) => {
  try {
    return { name, ok: true, rows: await load() };
  } catch {
    return { name, ok: false, rows: [] as T[] };
  }
};

export async function loadCadence(now = new Date()): Promise<CadenceView> {
  const today = todayInTz(now);

  const [tasks, contracts, delegations, anomalies] = await Promise.all([
    // The brief is triage, so it wants the hottest first whatever the task
    // screen is defaulting to today.
    settled('Tasks', () => listTasks({ includeDone: false, limit: 200, sort: 'heat' })),
    settled('Contracts', () => contractRecords(now)),
    settled('Delegations', () => listOpenDelegations()),
    settled('Revenue', async () => (await loadRevenueView(today)).summary?.anomalies ?? []),
  ]);

  const inputs: CadenceInputs = {
    tasks: tasks.rows.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      moneyImpactCents: t.moneyImpactCents,
      blockedPeopleCount: t.blockedPeople.length,
      // Nobody else picks up a task with no owner, so it stays the CEO's.
      ownerIsMe: t.layer === 'mine' && t.ownerName === null,
      deptCode: t.deptCode,
      isMine: t.layer === 'mine',
      status: t.status,
    })),
    contracts: contracts.rows,
    delegations: delegations.rows.map((d) => ({
      id: d.id,
      what: d.taskTitle ?? d.note ?? 'Delegated work',
      person: d.personName,
      lastMovementAt: d.lastMovementAt.toISOString(),
      status: d.status,
    })),
    anomalies: anomalies.rows.map((a) => ({
      id: `${a.scopeType}:${a.scopeId}:${a.date}`,
      label: a.scopeLabel,
      what: a.whatHappened,
      severity: a.severity,
      moneyImpactCents: a.moneyImpactCents,
      deptCode: a.scopeType === 'dept' ? a.scopeId : null,
    })),
  };

  const items = buildCadence(inputs, now);
  const split = splitCadence(items);

  return {
    items,
    ...split,
    sources: [
      { name: tasks.name, ok: tasks.ok, count: tasks.rows.length },
      { name: contracts.name, ok: contracts.ok, count: contracts.rows.length },
      { name: delegations.name, ok: delegations.ok, count: delegations.rows.length },
      { name: anomalies.name, ok: anomalies.ok, count: anomalies.rows.length },
    ],
  };
}
