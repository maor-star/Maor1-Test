import Link from 'next/link';
import {
  CLIENT_PERIODS, concentration, isClientPeriod, loadClients, type Client, type ClientPeriod,
} from '@/lib/clients/service';
import { PERIOD_LABEL, PERIOD_TAB, type Period } from '@/lib/revenue/periods';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { DeltaPct } from '@/components/revenue/delta';

export const dynamic = 'force-dynamic';

/**
 * Clients — every account that pays us, in the window you pick.
 *
 * Profit is Adnimation's own money on the account, computed with the source's
 * own formula, so this page reconciles with the revenue page rather than
 * telling a second story.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const period: ClientPeriod = isClientPeriod(sp.period) ? sp.period : '30D';
  const book = await loadClients(period);

  const top5 = concentration(book.clients, 5);
  const top10 = concentration(book.clients, 10);
  const falling = book.clients.filter((c) => c.trendPct !== null && c.trendPct < -0.3);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="CLIENTS / 06"
        title="Clients"
        action={
          <nav className="flex flex-wrap border border-divider">
            {CLIENT_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/clients?period=${p}`}
                className={`px-[9px] py-1 font-semi text-[11px] tracking-[0.12em] ${
                  p === period ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
                }`}
              >
                {PERIOD_TAB[p as Period]}
              </Link>
            ))}
          </nav>
        }
      />

      <HudCard>
        <HudCardHeader
          title={`The book · ${PERIOD_LABEL[period as Period]}`}
          index="S01"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{book.windowDays}</Num> DAYS TO <Num>{book.lastCompleteDay}</Num>
            </span>
          }
        />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:gap-x-10">
          <Figure label="PROFIT" value={fmtMoney(book.totals.profitCents)} big />
          <Figure label="GROSS" value={fmtMoney(book.totals.grossCents)} />
          <Figure label="CLIENTS" value={fmtNumber(book.totals.clientCount)} />
          <Figure
            label="TOP 5 SHARE"
            value={top5 === null ? '—' : `${(top5 * 100).toFixed(1)}%`}
            tone={top5 !== null && top5 > 0.5 ? 'warning' : undefined}
          />
          <Figure label="TOP 10 SHARE" value={top10 === null ? '—' : `${(top10 * 100).toFixed(1)}%`} />
          {period !== '30D' ? (
            <Figure label="FALLING HARD" value={String(falling.length)} tone={falling.length > 0 ? 'warning' : undefined} />
          ) : null}
        </div>

        <p className="font-semi text-[11px] leading-relaxed text-neutral-500">
          Profit is what Adnimation keeps on the account — after the source fee and the
          publisher&rsquo;s rev share. Sorted on profit, never gross: a trading account can lead on
          gross and sit mid-table on profit, because most of its gross goes straight back out.
          {period !== '30D'
            ? ' The trend column compares this window’s daily profit against the client’s own 30-day run rate.'
            : ' Pick a shorter window to see which clients are moving against their own run rate.'}
        </p>
      </HudCard>

      {falling.length > 0 ? (
        <HudCard className="gap-0 p-0">
          <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title="Falling against their own run rate"
              index="S02"
              action={<Tag tone="warning"><Num>{falling.length}</Num></Tag>}
            />
          </div>
          <ClientRows clients={falling.slice(0, 10)} period={period} />
        </HudCard>
      ) : null}

      <HudCard className="gap-0 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
          <HudCardHeader
            title="Every client, by profit"
            index="S03"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{book.clients.length}</Num> ACCOUNTS ·{' '}
                <Num>{book.totals.tradingCount}</Num> TRADING
              </span>
            }
          />
        </div>
        <ClientRows clients={book.clients} period={period} cumulative />
      </HudCard>

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        SOURCE: AD OPS ARCHITECT (LOVABLE) · READ-ONLY · PULLED <Num>{book.pulledAt}</Num>
      </p>
    </div>
  );
}

function ClientRows({
  clients,
  period,
  cumulative = false,
}: {
  clients: Client[];
  period: ClientPeriod;
  cumulative?: boolean;
}) {
  const total = clients.reduce((a, c) => a + c.profitCents, 0);
  let running = 0;

  return (
    <>
      {/* Phone: a card per client. */}
      <ul className="lg:hidden">
        {clients.map((c) => (
          <li key={`m:${c.name}`} className="border-t border-divider px-[18px] py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-cond text-[16px] text-neutral-900">{c.name}</p>
                <p className="hud-label mt-0.5 text-[9px]">
                  {c.isTrading ? 'TRADING DESK' : 'MANAGED PUBLISHER'}
                </p>
              </div>
              {c.trendPct !== null ? <DeltaPct delta={{ pct: c.trendPct, absCents: null }} /> : null}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Cell label="PROFIT" value={fmtMoney(c.profitCents)} />
              <Cell label="GROSS" value={fmtMoney(c.grossCents)} />
              <Cell label="TAKE" value={c.takeRate === null ? '—' : `${(c.takeRate * 100).toFixed(0)}%`} />
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: the full table. */}
      <div className="hidden min-w-0 overflow-x-auto lg:block">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="w-[24%]">Client</th>
              <th>Profit</th>
              <th>Profit / day</th>
              <th>Gross</th>
              <th>Take</th>
              <th>eCPM</th>
              <th>Impressions</th>
              {period !== '30D' ? <th className="text-end">vs 30-day rate</th> : null}
              {cumulative ? <th className="text-end">Cumulative</th> : null}
            </tr>
          </thead>
          <tbody>
            {clients.map((c, i) => {
              running += c.profitCents;
              return (
                <tr key={c.name}>
                  <td className="text-neutral-500"><Num>{i + 1}</Num></td>
                  <td className="whitespace-normal">
                    <span className="font-cond text-[15px] text-neutral-900">{c.name}</span>
                    {c.isTrading ? <Tag tone="outline" className="ms-2">TRADING</Tag> : null}
                  </td>
                  <td className="font-cond text-[16px] text-neutral-900">
                    <Num>{fmtMoney(c.profitCents)}</Num>
                  </td>
                  <td className="text-neutral-500"><Num>{fmtMoney(c.profitPerDayCents)}</Num></td>
                  <td className="text-neutral-500"><Num>{fmtMoney(c.grossCents)}</Num></td>
                  <td className="text-neutral-500">
                    <Num>{c.takeRate === null ? '—' : `${(c.takeRate * 100).toFixed(0)}%`}</Num>
                  </td>
                  <td className="text-neutral-500"><Num>{fmtMoney(c.ecpmCents)}</Num></td>
                  <td className="text-neutral-500"><Num>{fmtNumber(c.impressions)}</Num></td>
                  {period !== '30D' ? (
                    <td className="text-end">
                      {c.trendPct === null ? (
                        <span className="text-neutral-500">—</span>
                      ) : (
                        <DeltaPct delta={{ pct: c.trendPct, absCents: null }} />
                      )}
                    </td>
                  ) : null}
                  {cumulative ? (
                    <td className="text-end text-neutral-500">
                      <Num>{total > 0 ? `${((running / total) * 100).toFixed(1)}%` : '—'}</Num>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Figure({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'warning';
}) {
  return (
    <div className="min-w-0">
      <p className="hud-label text-[9px]">{label}</p>
      <p
        className={`${
          big
            ? 'hud-numeral mt-1 text-[32px] sm:text-[38px]'
            : 'mt-1 font-cond text-[20px] font-medium leading-none sm:text-[22px]'
        } ${tone === 'warning' ? 'text-sev-warning' : 'text-neutral-800'}`}
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="hud-label text-[9px]">{label}</span>
      <p className="font-cond text-[16px] leading-none text-neutral-900">
        <Num>{value}</Num>
      </p>
    </div>
  );
}
