import { concentration, loadClients, type Client } from '@/lib/clients/service';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';

export const dynamic = 'force-dynamic';

/**
 * Sales — every client, grouped by the department its money arrives through.
 *
 * The grouping is derived from revenue rather than from a CRM field, because
 * there is no CRM field: what a client is worth to a department is what it paid
 * that department. Net, never gross — see lib/clients/service.ts.
 */
export default async function ClientsPage() {
  const { clients, byDept, totals, window } = await loadClients();
  const top5 = concentration(clients, 5);
  const top10 = concentration(clients, 10);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="SALES / 10"
        title="Clients"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            <Num>{window.from}</Num> — <Num>{window.to}</Num> · SOURCE: AD OPS ARCHITECT
            (READ-ONLY)
          </span>
        }
      />

      <HudCard>
        <HudCardHeader
          title="The book"
          index="S01"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              DEPARTMENTS AS THE SOURCE GROUPS THEM
            </span>
          }
        />
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Figure label="NET / 30 DAYS" value={fmtMoney(totals.netCents)} big />
          <Figure label="GROSS" value={fmtMoney(totals.grossCents)} />
          <Figure label="CLIENTS" value={fmtNumber(totals.clientCount)} />
          <Figure
            label="TOP 5 SHARE"
            value={top5 === null ? '—' : `${(top5 * 100).toFixed(1)}%`}
            tone={top5 !== null && top5 > 0.5 ? 'warning' : undefined}
          />
          <Figure label="TOP 10 SHARE" value={top10 === null ? '—' : `${(top10 * 100).toFixed(1)}%`} />
        </div>
        <p className="font-semi text-[11px] leading-relaxed text-neutral-500">
          Concentration is spec 7.3&rsquo;s standing risk measure: the share of net revenue sitting
          in the largest handful of clients. A client appears under every department it earns in, so
          the department totals sum to the book, not to a per-client split.
        </p>
      </HudCard>

      <div className="grid gap-5 xl:grid-cols-2">
        {byDept.map((d, i) => (
          <HudCard key={d.deptCode} className="gap-0 p-0">
            <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
              <HudCardHeader
                title={d.label}
                index={`S${String(i + 2).padStart(2, '0')}`}
                action={
                  <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                    <Num>{d.clientCount}</Num> CLIENTS ·{' '}
                    <Num>
                      {totals.netCents > 0
                        ? `${((d.netCents / totals.netCents) * 100).toFixed(0)}%`
                        : '—'}
                    </Num>{' '}
                    OF NET
                  </span>
                }
              />
            </div>

            <div className="border-t border-divider px-[18px] py-2">
              <span className="hud-label text-[9px]">NET / 30 DAYS</span>
              <p className="font-cond text-[26px] leading-none text-neutral-900">
                <Num>{fmtMoney(d.netCents)}</Num>
              </p>
            </div>

            <div className="min-w-0 overflow-x-auto">
              <table className="cockpit-table">
                <thead>
                  <tr>
                    <th className="w-[38%]">Client</th>
                    <th>Net</th>
                    <th>Gross</th>
                    <th>Take</th>
                    <th>eCPM</th>
                    <th className="text-end">Impressions</th>
                  </tr>
                </thead>
                <tbody>
                  {d.clients.map((c) => {
                    const line = c.byDept.find((x) => x.deptCode === d.deptCode);
                    return (
                      <tr key={`${d.deptCode}:${c.name}`}>
                        <td className="whitespace-normal">
                          <span className="font-cond text-[15px] text-neutral-900">{c.name}</span>
                          <p className="hud-label mt-0.5 text-[9px]">
                            {c.isTrading ? 'TRADING DESK' : 'MANAGED PUBLISHER'}
                          </p>
                        </td>
                        <td><Num>{fmtMoney(line?.netCents ?? 0)}</Num></td>
                        <td className="text-neutral-500"><Num>{fmtMoney(line?.grossCents ?? 0)}</Num></td>
                        <td className="text-neutral-500">
                          <Num>
                            {line && line.grossCents > 0
                              ? `${((line.netCents / line.grossCents) * 100).toFixed(0)}%`
                              : '—'}
                          </Num>
                        </td>
                        <td className="text-neutral-500">
                          <Num>
                            {line && line.impressions > 0
                              ? fmtMoney(Math.round((line.netCents / line.impressions) * 1000))
                              : '—'}
                          </Num>
                        </td>
                        <td className="text-end text-neutral-500">
                          <Num>{fmtNumber(line?.impressions ?? 0)}</Num>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HudCard>
        ))}
      </div>

      <TopClients clients={clients} totalNetCents={totals.netCents} />
    </div>
  );
}

/** The whole book on one axis — who pays us most, regardless of department. */
function TopClients({ clients, totalNetCents }: { clients: Client[]; totalNetCents: number }) {
  let running = 0;

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Every client, by net"
          index="S00"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{clients.length}</Num> ACCOUNTS
            </span>
          }
        />
      </div>

      <div className="min-w-0 overflow-x-auto">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="w-[30%]">Client</th>
              <th>Departments</th>
              <th>Net</th>
              <th>Gross</th>
              <th>Take</th>
              <th className="text-end">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c, i) => {
              running += c.netCents;
              const cumulative = totalNetCents > 0 ? running / totalNetCents : 0;
              return (
                <tr key={c.name}>
                  <td className="text-neutral-500"><Num>{i + 1}</Num></td>
                  <td className="whitespace-normal">
                    <span className="font-cond text-[15px] text-neutral-900">{c.name}</span>
                    {c.isTrading ? <Tag tone="outline" className="ms-2">TRADING</Tag> : null}
                  </td>
                  <td className="text-[11px] text-neutral-500">
                    {c.byDept.map((d) => d.label).join(' · ')}
                  </td>
                  <td><Num>{fmtMoney(c.netCents)}</Num></td>
                  <td className="text-neutral-500"><Num>{fmtMoney(c.grossCents)}</Num></td>
                  <td className="text-neutral-500">
                    <Num>{c.takeRate === null ? '—' : `${(c.takeRate * 100).toFixed(0)}%`}</Num>
                  </td>
                  <td className="text-end text-neutral-500">
                    <Num>{`${(cumulative * 100).toFixed(1)}%`}</Num>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </HudCard>
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
    <div>
      <span className="hud-label text-[9px]">{label}</span>
      <p
        className={`font-cond leading-none text-neutral-900 ${big ? 'text-[42px]' : 'text-[26px]'} ${
          tone === 'warning' ? 'text-sev-warning' : ''
        }`}
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}
