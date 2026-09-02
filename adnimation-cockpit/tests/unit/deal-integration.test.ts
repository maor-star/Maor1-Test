import { describe, expect, it } from 'vitest';
import {
  DEMAND_STEPS, SUPPLY_STEPS, looksDone, progressFor, readState, setStep, stepsFor,
} from '@/lib/pipeline/integration';

/**
 * How far into going live a deal is.
 *
 * The rules worth holding: the steps differ by which side of the business the
 * partner is on, a mutual partner carries both lists without carrying anything
 * twice, and the date a step was ticked survives a re-tick — because that date
 * is how long the step took, and a step ticked twice did not take from the
 * second tick.
 */

describe('the steps a deal goes through', () => {
  it('gives a demand partner its own list and a publisher another', () => {
    expect(stepsFor('demand').map((s) => s.key)).toContain('endpoint');
    expect(stepsFor('supply').map((s) => s.key)).toContain('adstxt');
    expect(stepsFor('demand').map((s) => s.key)).not.toContain('adstxt');
  });

  it('gives a mutual partner both lists, with nothing counted twice', () => {
    const keys = stepsFor('mutual').map((s) => s.key);
    expect(keys).toContain('endpoint');
    expect(keys).toContain('adstxt');
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThan(DEMAND_STEPS.length + SUPPLY_STEPS.length);
  });

  it('ends every list at revenue, because revenue is the proof', () => {
    for (const type of ['demand', 'supply', 'mutual', 'vendor'] as const) {
      expect(stepsFor(type).at(-1)?.key).toBe('revenue');
    }
  });

  it('says what each step means, so two people cannot tick it differently', () => {
    for (const s of stepsFor('demand')) expect(s.meaning.length).toBeGreaterThan(10);
  });
});

describe('reading what was stored', () => {
  it('ignores junk rather than trusting it', () => {
    expect(readState(null)).toEqual({});
    expect(readState('nonsense')).toEqual({});
    expect(readState([1, 2])).toEqual({});
    expect(readState({ contract: 'yes' })).toEqual({});
  });

  it('treats anything but true as not done', () => {
    expect(readState({ contract: { done: 'yes' } }).contract?.done).toBe(false);
    expect(readState({ contract: { done: true } }).contract?.done).toBe(true);
  });
});

describe('progress on one deal', () => {
  it('counts what is ticked and names the first thing that is not', () => {
    const p = progressFor('demand', { contract: { done: true }, kickoff: { done: true } });
    expect(p.done).toBe(2);
    expect(p.total).toBe(DEMAND_STEPS.length);
    expect(p.waitingOn?.key).toBe('seat');
    expect(p.complete).toBe(false);
  });

  it('is complete only when every step is ticked', () => {
    const all = Object.fromEntries(DEMAND_STEPS.map((s) => [s.key, { done: true }]));
    const p = progressFor('demand', all);
    expect(p.complete).toBe(true);
    expect(p.waitingOn).toBeNull();
    expect(p.ratio).toBe(1);
  });

  it('starts at nothing for a deal nobody has touched', () => {
    const p = progressFor('supply', {});
    expect(p.done).toBe(0);
    expect(p.ratio).toBe(0);
    expect(p.waitingOn?.key).toBe('contract');
  });
});

describe('ticking a step', () => {
  it('stamps the date it was ticked and leaves the others alone', () => {
    const now = new Date('2026-09-02T10:00:00Z');
    const state = setStep({ kickoff: { done: true, at: '2026-08-01T00:00:00Z' } }, 'contract', { done: true }, now);
    expect(state.contract?.at).toBe(now.toISOString());
    expect(state.kickoff?.at).toBe('2026-08-01T00:00:00Z');
  });

  it('keeps the first date when a done step is ticked again', () => {
    const first = setStep({}, 'contract', { done: true }, new Date('2026-08-01T00:00:00Z'));
    const again = setStep(first, 'contract', { note: 'countersigned' }, new Date('2026-09-02T00:00:00Z'));
    expect(again.contract?.at).toBe('2026-08-01T00:00:00.000Z');
    expect(again.contract?.note).toBe('countersigned');
  });

  it('clears the date when a step is unticked', () => {
    const done = setStep({}, 'contract', { done: true });
    expect(setStep(done, 'contract', { done: false }).contract?.at).toBeNull();
  });

  it('records who it is waiting on without ticking anything', () => {
    const state = setStep({}, 'adstxt', { blockedOn: 'their webmaster' });
    expect(state.adstxt?.done).toBe(false);
    expect(state.adstxt?.blockedOn).toBe('their webmaster');
  });
});

describe('whether a deal looks finished', () => {
  const none = progressFor('demand', {});
  const all = progressFor('demand', Object.fromEntries(DEMAND_STEPS.map((s) => [s.key, { done: true }])));

  it('says a lost deal is finished', () => {
    expect(looksDone('lost', none).done).toBe(true);
  });

  it('says a live deal with every step ticked is finished', () => {
    expect(looksDone('live', all).done).toBe(true);
  });

  it('does not call a live deal finished while steps are open, and says how many', () => {
    const verdict = looksDone('live', none);
    expect(verdict.done).toBe(false);
    expect(verdict.why).toContain(`${DEMAND_STEPS.length}`);
  });

  it('says nothing about a deal that is still being worked', () => {
    expect(looksDone('negotiation', none)).toEqual({ done: false, why: '' });
  });
});
