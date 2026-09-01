import { describe, expect, it } from 'vitest';
import { keepList, shouldMirror, skipPair } from '@/lib/sync/mirror-skip';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/mirror-skip.mjs';

/**
 * The screen and the timer must agree about whose tasks these are.
 *
 * They write the same table, so a disagreement means the job re-adds on its
 * next poll exactly what the app dropped, or drops what the app kept — the
 * list flickering between two truths every five minutes.
 */
const CASES: string[][] = [
  [],
  ['maor@adnimation.com'],
  ['mor@adnimation.com'],
  ['treves@adnimation.com'],
  ['mor@adnimation.com', 'treves@adnimation.com'],
  ['mor@adnimation.com', 'treves@adnimation.com', 'maor@adnimation.com'],
  ['MOR@Adnimation.com', 'TREVES@adnimation.com'],
  ['amir@adnimation.com', 'treves@adnimation.com'],
];

describe('mirror skip parity', () => {
  it('agrees on every case, under every setting', () => {
    for (const raw of [undefined, 'mor@adnimation.com,treves@adnimation.com', '']) {
      expect(js.skipPair(raw)).toEqual(skipPair(raw));
      expect(js.keepList(raw)).toEqual(keepList(raw));

      for (const assignees of CASES) {
        expect(js.shouldMirror(assignees, js.skipPair(raw)), assignees.join('+')).toBe(
          shouldMirror(assignees, skipPair(raw)),
        );
      }
    }
  });
});
