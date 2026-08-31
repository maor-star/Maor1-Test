import { describe, expect, it } from 'vitest';
import { filterByQuery, matchesQuery, queryTerms } from '@/lib/search';

/**
 * The search box exists so he can stop scrolling. Every case here is one where
 * a plausible implementation would have hidden the row he was looking for.
 */
describe('search', () => {
  it('shows everything when nothing has been typed', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery(null, 'anything')).toBe(true);
    expect(matchesQuery('   ', 'anything')).toBe(true);
  });

  it('ignores case', () => {
    expect(matchesQuery('GOOGLE', 'Google Ireland')).toBe(true);
    expect(matchesQuery('google', 'GOOGLE IRELAND')).toBe(true);
  });

  it('needs every word, but not in one field and not in order', () => {
    expect(matchesQuery('google demand', 'Google Ireland', 'demand')).toBe(true);
    expect(matchesQuery('demand google', 'Google Ireland', 'demand')).toBe(true);
    expect(matchesQuery('google supply', 'Google Ireland', 'demand')).toBe(false);
  });

  it('matches part of a word, which is how anyone types a search', () => {
    expect(matchesQuery('tabo', 'Taboola')).toBe(true);
  });

  it('searches Hebrew, and does not care about niqqud', () => {
    expect(matchesQuery('\u05d7\u05d5\u05d6\u05d4', '\u05d7\u05d5\u05d6\u05d4 \u05de\u05d5\u05dc \u05d8\u05d0\u05d1\u05d5\u05dc\u05d4')).toBe(true);
    expect(matchesQuery('\u05e9\u05dc\u05d5\u05dd', '\u05e9\u05b8\u05c1\u05dc\u05d5\u05b9\u05dd')).toBe(true);
  });

  it('searches numbers, dates and statuses, not only text', () => {
    expect(matchesQuery('4471', 'Invoice', 4471)).toBe(true);
    expect(matchesQuery('signed', 'MSA', null, 'signed')).toBe(true);
    expect(matchesQuery('2026-08', 'MSA', new Date('2026-08-31T00:00:00Z'))).toBe(true);
  });

  it('never matches across a field boundary', () => {
    // "lata" would otherwise match "Taboola" and "Taboola" run together.
    expect(matchesQuery('lata', 'Taboola', 'Taboola')).toBe(false);
  });

  it('survives empty and missing fields', () => {
    expect(matchesQuery('x', null, undefined, '')).toBe(false);
    expect(matchesQuery('x', null, 'X')).toBe(true);
  });

  it('filters a list, and returns it untouched when nothing is typed', () => {
    const rows = [{ name: 'Google' }, { name: 'Taboola' }];
    expect(filterByQuery(rows, 'tab', (r) => [r.name])).toEqual([{ name: 'Taboola' }]);
    expect(filterByQuery(rows, '', (r) => [r.name])).toBe(rows);
  });

  it('splits a query into words', () => {
    expect(queryTerms('  Google   Demand ')).toEqual(['google', 'demand']);
    expect(queryTerms('')).toEqual([]);
  });
});
