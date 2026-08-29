import { and, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import { db, delegations, integrationHealth, tasks } from '@/lib/db';
import { headline } from '@/lib/revenue/company';
import { fmtMoney, fmtTime, todayInTz } from '@/lib/utils';
import { isStale } from '@/lib/integrations/staleness';
import { Num } from '@/components/num';

/**
 * The full-width telemetry band: six equal cells of live operating figures.
 *
 * These read from the same reconciled company model the revenue page uses, so
 * the ticker and the page can never disagree — the previous version derived its
 * own "net" from a second data path and showed a figure that appeared nowhere
 * else in the app.
 */
export async function TelemetryStrip() {
  const today = todayInTz();

  const [money, counts, health] = await Promise.all([
    headline().catch(() => null),
    loadCounts(today),
    db.select().from(integrationHealth).then((rows) => rows),
  ]);

  const clickup = health.find((h) => h.system === 'clickup');
  const lastSync = clickup?.lastSuccessAt ?? null;

  const cells: { label: string; value: string; muted?: boolean }[] = [
    {
      label: money ? `PROFIT / ${money.day}` : 'PROFIT / LAST FULL DAY',
      value: money ? fmtMoney(money.profitCents) : '—',
    },
    {
      label: 'GROSS',
      value: money ? fmtMoney(money.grossCents) : '—',
    },
    {
      label: 'MARGIN',
      value: money?.marginPct != null ? `${(money.marginPct * 100).toFixed(1)}%` : '—',
    },
    {
      label: 'PROFIT MTD',
      value: money ? fmtMoney(money.mtdProfitCents) : '—',
    },
    {
      label: 'OPEN TASKS',
      value: String(counts.open),
      muted: counts.overdue > 0,
    },
    {
      label: 'LAST SYNC',
      value: lastSync ? fmtTime(lastSync) : 'NEVER',
      muted: isStale(lastSync),
    },
  ];

  return (
    <div
      className="grid grid-cols-2 border-b border-divider text-paper sm:grid-cols-3 lg:grid-cols-6"
      style={{ background: 'var(--strip-bg)' }}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex min-w-0 flex-col gap-1 border-b border-e border-ground/[0.14] px-3 py-2 last:border-e-0 sm:border-b-0 sm:px-4 sm:py-[11px]"
        >
          <span className="truncate font-semi text-[9px] font-medium tracking-[0.14em] text-accent-300">
            {c.label}
          </span>
          <span
            className={`truncate font-cond text-[17px] font-medium leading-none tracking-[0.01em] sm:text-[20px] ${
              c.muted ? 'text-sev-warning' : ''
            }`}
          >
            <Num>{c.value}</Num>
          </span>
        </div>
      ))}
    </div>
  );
}

async function loadCounts(today: string) {
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done')));

  const [overdue] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done'), lte(tasks.dueDate, today)));

  const [stuck] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(delegations)
    .where(eq(delegations.status, 'stale'));

  return { open: open?.n ?? 0, overdue: overdue?.n ?? 0, stuckDelegations: stuck?.n ?? 0 };
}
