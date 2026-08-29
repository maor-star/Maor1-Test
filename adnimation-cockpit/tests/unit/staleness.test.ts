import { describe, expect, it } from 'vitest';
import { INTEGRATION_STALE_HOURS, isStale } from '@/lib/integrations/staleness';

const NOW = new Date('2026-08-29T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe('isStale', () => {
  it('treats a never-successful integration as stale', () => {
    expect(isStale(null, NOW)).toBe(true);
  });

  it('accepts a recent sync', () => {
    expect(isStale(hoursAgo(0.5), NOW)).toBe(false);
  });

  it('accepts a sync exactly at the threshold', () => {
    expect(isStale(hoursAgo(INTEGRATION_STALE_HOURS), NOW)).toBe(false);
  });

  it('flags a sync past the threshold', () => {
    expect(isStale(hoursAgo(INTEGRATION_STALE_HOURS + 0.1), NOW)).toBe(true);
    expect(isStale(hoursAgo(48), NOW)).toBe(true);
  });

  it('uses the two-hour threshold the engineering rules specify', () => {
    expect(INTEGRATION_STALE_HOURS).toBe(2);
  });
});
