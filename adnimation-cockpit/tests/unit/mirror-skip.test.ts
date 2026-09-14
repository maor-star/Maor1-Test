import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEP, DEFAULT_SKIP_PAIR, DEFAULT_SKIP_SOLO,
  keepList, shouldMirror, skipPair, skipSolo,
} from '@/lib/sync/mirror-skip';

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
/** Nobody is skipped on their own unless this says so. */
const NO_SOLO: string[] = [];
const SOLO_TOMER = [TOMER];

describe('whose ClickUp tasks are mirrored', () => {
  it('keeps a task assigned to one of them alone — that is usually his work, handed over', () => {
    expect(shouldMirror([MOR], PAIR, DEFAULT_KEEP, NO_SOLO)).toBe(true);
    expect(shouldMirror([TOMER], PAIR, DEFAULT_KEEP, NO_SOLO)).toBe(true);
  });

  /*
   * Tomer's own work is his own. He asked for it off the board — the pair rule
   * could not do that, because a pair of one skips everything that person
   * touches including what he is on himself, so this is a second list.
   */
  it("drops a task that is only Tomer's", () => {
    expect(shouldMirror([TOMER], PAIR, DEFAULT_KEEP, SOLO_TOMER)).toBe(false);
    expect(shouldMirror([' TREVES@Adnimation.com '], PAIR, DEFAULT_KEEP, SOLO_TOMER)).toBe(false);
    // And by default, without anyone passing the lists in.
    expect(shouldMirror([TOMER])).toBe(false);
  });

  it('keeps a task of his that Tomer happens to be on', () => {
    expect(shouldMirror([TOMER, MAOR], PAIR, DEFAULT_KEEP, SOLO_TOMER)).toBe(true);
  });

  it('keeps one Tomer shares with somebody whose work he does follow', () => {
    expect(shouldMirror([TOMER, 'mohd@adnimation.com'], PAIR, DEFAULT_KEEP, SOLO_TOMER)).toBe(true);
  });

  it('leaves everyone else alone — the solo list is one name, not a habit', () => {
    expect(shouldMirror([MOR], PAIR, DEFAULT_KEEP, SOLO_TOMER)).toBe(true);
    expect(shouldMirror(['mohd@adnimation.com'], PAIR, DEFAULT_KEEP, SOLO_TOMER)).toBe(true);
    expect(shouldMirror([], PAIR, DEFAULT_KEEP, SOLO_TOMER)).toBe(true);
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
    // A single name in the PAIR list would skip everything that person
    // touches, his own tasks included. Taking somebody off the board is what
    // the solo list is for, and it still yields to the keep list.
    expect(shouldMirror([MOR], [MOR], DEFAULT_KEEP, NO_SOLO)).toBe(true);
    expect(shouldMirror([MOR, TOMER], [MOR], DEFAULT_KEEP, NO_SOLO)).toBe(true);
  });

  it('reads all three lists from the environment, and falls back to the people he named', () => {
    expect(skipPair(undefined)).toEqual(DEFAULT_SKIP_PAIR);
    expect(skipSolo(undefined)).toEqual(DEFAULT_SKIP_SOLO);
    expect(keepList(undefined)).toEqual(DEFAULT_KEEP);
    expect(skipPair('A@x.com, b@X.com ,')).toEqual(['a@x.com', 'b@x.com']);
    expect(skipSolo('Treves@X.com ')).toEqual(['treves@x.com']);
    expect(keepList('')).toEqual([]);
    // Cleared, and Tomer is back on the board — a setting, not a deploy.
    expect(shouldMirror([TOMER], PAIR, DEFAULT_KEEP, skipSolo(''))).toBe(true);
  });

  it('mirrors everything when the pair is cleared', () => {
    expect(shouldMirror([MOR, TOMER], [], DEFAULT_KEEP, NO_SOLO)).toBe(true);
  });
});
