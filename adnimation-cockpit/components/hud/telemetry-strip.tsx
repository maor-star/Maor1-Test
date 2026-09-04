import { and, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import { db, delegations, integrationHealth, tasks } from '@/lib/db';
import { headline } from '@/lib/revenue/company';
import { fmtMoney, fmtTime, todayInTz } from '@/lib/utils';
import { isStale } from '@/lib/integrations/staleness';
import { Num } from '@/components/num';

/**
 * The Adnimation Total strip: six equal cells of live operating figures.
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
      label: money ? `Profit / ${money.day}` : 'Profit / last full day',
      value: money ? fmtMoney(money.profitCents) : '—',
    },
    {
      label: 'Gross',
      value: money ? fmtMoney(money.grossCents) : '—',
    },
    {
      label: 'Margin',
      value: money?.marginPct != null ? `${(money.marginPct * 100).toFixed(1)}%` : '—',
    },
    {
      label: 'Profit MTD',
      value: money ? fmtMoney(money.mtdProfitCents) : '—',
    },
    {
      label: 'Open tasks',
      value: String(counts.open),
      muted: counts.overdue > 0,
    },
    {
      label: 'Last sync',
      value: lastSync ? fmtTime(lastSync) : 'Never',
      muted: isStale(lastSync),
    },
  ];

  return (
    <div className="hud-card grid grid-cols-2 divide-x divide-y divide-line overflow-hidden p-0 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
      {cells.map((c) => (
        <div key={c.label} className="flex min-w-0 flex-col gap-[10px] px-[18px] py-[17px]">
          <span className="hud-label truncate text-[11.5px]">{c.label}</span>
          <span
            className={`truncate font-mono text-[19px] font-semibold leading-none tracking-[-0.03em] sm:text-[22px] ${
              c.muted ? 'text-warn' : 'text-ink'
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
