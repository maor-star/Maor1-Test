import { departmentFor, departmentLabel } from '@/lib/revenue/departments';
import { ecpmCents, takeRate } from '@/lib/revenue/normalize';

/**
 * Clients, grouped by the department they actually earn in.
 *
 * Departments here are the ones the source itself uses — its demand categories
 * (see lib/revenue/departments.ts). A client belongs to every department its
 * money arrives through, which also means the list is ordered by what each
 * client is worth, not alphabetically.
 *
 * Sorted on net, never gross. A trading account can be the largest by gross and
 * mid-table by net, because most of its gross goes straight back out in fees.
 */

export interface ClientDeptLine {
  deptCode: string;
  label: string;
  netCents: number;
  grossCents: number;
  impressions: number;
  categories: string[];
}

export interface Client {
  name: string;
  isTrading: boolean;
  netCents: number;
  grossCents: number;
  impressions: number;
  ecpmCents: number | null;
  takeRate: number | null;
  /** Where this client's money comes from, largest first. */
  byDept: ClientDeptLine[];
  /** The department that carries most of its net. */
  primaryDept: string;
}

export interface DeptClients {
  deptCode: string;
  label: string;
  netCents: number;
  clientCount: number;
  clients: Client[];
}

interface Row {
  account: string;
  isTrading: boolean;
  category: string;
  grossCents: number;
  feeCents: number;
  impressions: number;
}

let cache: Row[] | null = null;
let windowCache: { from: string; to: string } | null = null;

async function load(): Promise<{ rows: Row[]; window: { from: string; to: string } }> {
  if (cache && windowCache) return { rows: cache, window: windowCache };
  const snap = (await import('@/fixtures/ars-accounts-30d.json')).default;
  cache = snap.rows.map((r) => ({
    account: r[0] as string,
    isTrading: r[1] === 1,
    category: r[2] as string,
    grossCents: r[3] as number,
    feeCents: r[4] as number,
    impressions: r[5] as number,
  }));
  windowCache = snap.window as { from: string; to: string };
  return { rows: cache, window: windowCache };
}

export async function loadClients(): Promise<{
  clients: Client[];
  byDept: DeptClients[];
  window: { from: string; to: string };
  totals: { netCents: number; grossCents: number; clientCount: number };
}> {
  const { rows, window } = await load();

  const byName = new Map<string, Client>();

  for (const r of rows) {
    const dept = departmentFor(r.category);
    const net = r.grossCents - r.feeCents;

    const client = byName.get(r.account) ?? {
      name: r.account,
      isTrading: r.isTrading,
      netCents: 0,
      grossCents: 0,
      impressions: 0,
      ecpmCents: null,
      takeRate: null,
      byDept: [],
      primaryDept: dept,
    };

    client.netCents += net;
    client.grossCents += r.grossCents;
    client.impressions += r.impressions;

    const line = client.byDept.find((d) => d.deptCode === dept);
    if (line) {
      line.netCents += net;
      line.grossCents += r.grossCents;
      line.impressions += r.impressions;
      if (!line.categories.includes(r.category)) line.categories.push(r.category);
    } else {
      client.byDept.push({
        deptCode: dept,
        label: departmentLabel(dept),
        netCents: net,
        grossCents: r.grossCents,
        impressions: r.impressions,
        categories: [r.category],
      });
    }

    byName.set(r.account, client);
  }

  const clients = [...byName.values()]
    .map((c) => {
      c.byDept.sort((a, b) => b.netCents - a.netCents);
      return {
        ...c,
        ecpmCents: ecpmCents(c.netCents, c.impressions),
        takeRate: takeRate(c.grossCents, c.netCents),
        primaryDept: c.byDept[0]?.deptCode ?? 'unknown',
      };
    })
    .sort((a, b) => b.netCents - a.netCents);

  // A client appears under every department it earns in, not just its largest:
  // the point of the department view is to see that department's whole book.
  const deptMap = new Map<string, DeptClients>();
  for (const c of clients) {
    for (const line of c.byDept) {
      const entry = deptMap.get(line.deptCode) ?? {
        deptCode: line.deptCode,
        label: line.label,
        netCents: 0,
        clientCount: 0,
        clients: [],
      };
      entry.netCents += line.netCents;
      entry.clientCount += 1;
      entry.clients.push(c);
      deptMap.set(line.deptCode, entry);
    }
  }

  const byDept = [...deptMap.values()]
    .map((d) => ({
      ...d,
      clients: d.clients.sort((a, b) => {
        const an = a.byDept.find((x) => x.deptCode === d.deptCode)?.netCents ?? 0;
        const bn = b.byDept.find((x) => x.deptCode === d.deptCode)?.netCents ?? 0;
        return bn - an;
      }),
    }))
    .sort((a, b) => b.netCents - a.netCents);

  return {
    clients,
    byDept,
    window,
    totals: {
      netCents: clients.reduce((a, c) => a + c.netCents, 0),
      grossCents: clients.reduce((a, c) => a + c.grossCents, 0),
      clientCount: clients.length,
    },
  };
}

/**
 * Concentration risk (spec 7.3) — how much of net comes from the top N.
 * The spec calls this an existential risk measure and asks for it always on.
 */
export function concentration(clients: Client[], topN = 5): number | null {
  const total = clients.reduce((a, c) => a + c.netCents, 0);
  if (total <= 0) return null;
  const top = clients.slice(0, topN).reduce((a, c) => a + c.netCents, 0);
  return top / total;
}
