import { describe, expect, it } from 'vitest';
import { DEFAULT_KEEP, DEFAULT_SKIP_PAIR, keepList, shouldMirror, skipPair } from '@/lib/sync/mirror-skip';

/**
 * Whose ClickUp tasks reach his list.
 *
 * The first version of this rule skipped anything assigned only to Mor, and it
 * was wrong: most of what sits under her name is work he wrote and delegated,
 * which is exactly what he wants to watch. Every case below is one where a
 * looser rule would hide work that is his.
 */
const MOR = 'mor@adnimation.com';
const TOMER = 'treves@adnimation.com';
const MAOR = 'maor@adnimation.com';
const PAIR = [MOR, TOMER];

describe('whose ClickUp tasks are mirrored', () => {
  it('keeps a task assigned to one of them alone — that is usually his work, handed over', () => {
    expect(shouldMirror([MOR], PAIR)).toBe(true);
    expect(shouldMirror([TOMER], PAIR)).toBe(true);
  });

  it('skips the ones they run between them', () => {
    expect(shouldMirror([MOR, TOMER], PAIR)).toBe(false);
    expect(shouldMirror([TOMER, MOR], PAIR)).toBe(false);
  });

  it('keeps a task he is on, whoever else is tagged', () => {
    expect(shouldMirror([MOR, TOMER, MAOR], PAIR)).toBe(true);
    expect(shouldMirror([MAOR, MOR, TOMER], PAIR)).toBe(true);
  });

  it('keeps his own, and anyone else on the team', () => {
    expect(shouldMirror([MAOR], PAIR)).toBe(true);
    expect(shouldMirror(['amir@adnimation.com'], PAIR)).toBe(true);
    expect(shouldMirror(['mohd@adnimation.com', MOR], PAIR)).toBe(true);
  });

  it('keeps one assigned to nobody', () => {
    expect(shouldMirror([], PAIR)).toBe(true);
  });

  it('ignores case and stray spacing on both sides', () => {
    expect(shouldMirror([' MOR@Adnimation.com ', 'TREVES@adnimation.com'], PAIR)).toBe(false);
    expect(shouldMirror([MOR, TOMER], [' Mor@ADNIMATION.com ', ' Treves@adnimation.COM '])).toBe(false);
  });

  it('refuses to act on a pair of one — that is the mistake this replaced', () => {
    // A single name would skip everything that person touches.
    expect(shouldMirror([MOR], [MOR])).toBe(true);
    expect(shouldMirror([MOR, TOMER], [MOR])).toBe(true);
  });

  it('reads both lists from the environment, and falls back to the people he named', () => {
    expect(skipPair(undefined)).toEqual(DEFAULT_SKIP_PAIR);
    expect(keepList(undefined)).toEqual(DEFAULT_KEEP);
    expect(skipPair('A@x.com, b@X.com ,')).toEqual(['a@x.com', 'b@x.com']);
    expect(keepList('')).toEqual([]);
  });

  it('mirrors everything when the pair is cleared', () => {
    expect(shouldMirror([MOR, TOMER], [])).toBe(true);
  });
});
