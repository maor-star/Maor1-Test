import { eq } from 'drizzle-orm';
import { and, isNull, ne, sql } from 'drizzle-orm';
import { db, delegations, integrationHealth, tasks } from '@/lib/db';
import { loadRevenueView } from '@/lib/revenue/service';
import { fmtMoney, fmtTime, todayInTz } from '@/lib/utils';
import { isStale } from '@/lib/integrations/staleness';
import { Num } from '@/components/num';

/**
 * The full-width telemetry band from the design handoff: six equal cells of
 * live operating figures. Every value here is real — a HUD that shows invented
 * numbers is worse than one that shows none.
 */
export async function TelemetryStrip() {
  const today = todayInTz();

  const [revenue, counts, health] = await Promise.all([
    loadRevenueView(today, 'net').catch(() => null),
    loadCounts(),
    db.select().from(integrationHealth).then((rows) => rows),
  ]);

  const summary = revenue?.summary ?? null;
  const clickup = health.find((h) => h.system === 'clickup');
  const lastSync = clickup?.lastSuccessAt ?? null;

  const cells: { label: string; value: string; ltr?: boolean; muted?: boolean }[] = [
    {
      label: 'NET / LAST FULL DAY',
      value: summary ? fmtMoney(summary.totalNetCents) : '—',
    },
    {
      label: 'TAKE RATE',
      value: summary?.takeRate != null ? `${(summary.takeRate * 100).toFixed(1)}%` : '—',
    },
    {
      label: 'ECPM',
      value: summary?.ecpmCents != null ? fmtMoney(summary.ecpmCents) : '—',
    },
    {
      label: 'OPEN SIGNALS',
      value: String(summary?.anomalies.length ?? 0),
    },
    {
      label: 'BURNING TASKS',
      value: String(counts.burning),
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
          className="flex min-w-0 flex-col gap-1 border-e border-ground/[0.14] px-4 py-[11px] last:border-e-0"
        >
          <span className="truncate font-semi text-[9px] font-medium tracking-[0.14em] text-accent-300">
            {c.label}
          </span>
          <span
            className={`truncate font-cond text-[20px] font-medium leading-none tracking-[0.01em] ${
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

async function loadCounts() {
  const [burning] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done'), eq(tasks.priority, 'P0')));

  const [stuck] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(delegations)
    .where(eq(delegations.status, 'stale'));

  return { burning: burning?.n ?? 0, stuckDelegations: stuck?.n ?? 0 };
}
