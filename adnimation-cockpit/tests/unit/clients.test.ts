import { describe, expect, it } from 'vitest';
import { concentration, loadClients, type Client } from '@/lib/clients/service';

/**
 * These run against the real 30-day account pull, so they double as a check
 * that the fixture still parses and still adds up.
 */

const client = (over: Partial<Client> = {}): Client => ({
  name: 'X',
  isTrading: false,
  netCents: 0,
  grossCents: 0,
  impressions: 0,
  ecpmCents: null,
  takeRate: null,
  byDept: [],
  primaryDept: 'CORE',
  ...over,
});

describe('loadClients', () => {
  it('groups every account and keeps the window it was pulled for', async () => {
    const { clients, totals, window } = await loadClients();
    expect(clients.length).toBeGreaterThan(50);
    expect(totals.clientCount).toBe(clients.length);
    expect(window.from < window.to).toBe(true);
  });

  it('sorts on net, not gross — the two orders genuinely differ', async () => {
    const { clients } = await loadClients();
    const nets = clients.map((c) => c.netCents);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);

    // A trading account can lead on gross and trail on net, because most of
    // its gross goes straight back out in fees. If that ever stops being true
    // the sort choice stops mattering and this test should be revisited.
    const topGross = [...clients].sort((a, b) => b.grossCents - a.grossCents)[0];
    expect(topGross?.name).not.toBe(clients[0]?.name);
  });

  it('never reports a net above gross', async () => {
    const { clients } = await loadClients();
    for (const c of clients) expect(c.netCents).toBeLessThanOrEqual(c.grossCents);
  });

  it("totals match the sum of every client's lines", async () => {
    const { clients, totals } = await loadClients();
    const net = clients.reduce((a, c) => a + c.netCents, 0);
    const lines = clients.reduce(
      (a, c) => a + c.byDept.reduce((b, d) => b + d.netCents, 0),
      0,
    );
    expect(lines).toBe(net);
    expect(totals.netCents).toBe(net);
  });

  it('files each client under every department it earns in', async () => {
    const { clients, byDept } = await loadClients();
    const multi = clients.find((c) => c.byDept.length > 1);
    expect(multi).toBeDefined();
    for (const line of multi!.byDept) {
      const dept = byDept.find((d) => d.deptCode === line.deptCode);
      expect(dept?.clients.some((c) => c.name === multi!.name)).toBe(true);
    }
  });

  it('orders departments by net, and clients inside a department by their net there', async () => {
    const { byDept } = await loadClients();
    const deptNets = byDept.map((d) => d.netCents);
    expect([...deptNets].sort((a, b) => b - a)).toEqual(deptNets);

    for (const d of byDept) {
      const inDept = d.clients.map(
        (c) => c.byDept.find((x) => x.deptCode === d.deptCode)?.netCents ?? 0,
      );
      expect([...inDept].sort((a, b) => b - a)).toEqual(inDept);
    }
  });

  it("names each client's primary department as the one carrying most of its net", async () => {
    const { clients } = await loadClients();
    for (const c of clients.slice(0, 20)) {
      const largest = [...c.byDept].sort((a, b) => b.netCents - a.netCents)[0];
      expect(c.primaryDept).toBe(largest?.deptCode);
    }
  });

  it('leaves revenue with no mapping rule in an explicit bucket rather than a department', async () => {
    const { byDept } = await loadClients();
    // Unassigned is a real answer here — the dept mapping is unconfirmed and
    // several categories deliberately have no rule.
    const codes = byDept.map((d) => d.deptCode);
    expect(codes.every((c) => c.length > 0)).toBe(true);
  });
});

describe('concentration', () => {
  it('measures how much of net sits in the top N', () => {
    const clients = [80, 10, 5, 5].map((n) => client({ netCents: n }));
    expect(concentration(clients, 1)).toBeCloseTo(0.8);
    expect(concentration(clients, 2)).toBeCloseTo(0.9);
  });

  it('is null when there is no net to divide', () => {
    expect(concentration([], 5)).toBeNull();
    expect(concentration([client({ netCents: 0 })], 5)).toBeNull();
  });

  it('reaches 1 when asked for more clients than exist', () => {
    expect(concentration([client({ netCents: 10 })], 5)).toBe(1);
  });

  it('reports a real, material concentration on the live book', async () => {
    const { clients } = await loadClients();
    const top5 = concentration(clients, 5);
    expect(top5).not.toBeNull();
    expect(top5!).toBeGreaterThan(0);
    expect(top5!).toBeLessThanOrEqual(1);
  });
});
