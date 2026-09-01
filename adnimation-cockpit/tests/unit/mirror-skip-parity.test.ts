import { describe, expect, it } from 'vitest';
import { shouldMirror, skipList } from '@/lib/sync/mirror-skip';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/mirror-skip.mjs';

/**
 * The screen and the timer must agree about whose tasks these are.
 *
 * They write the same table. A disagreement means the job re-adds on its next
 * poll exactly what the app just dropped, or drops what the app kept — either
 * way the list flickers between two truths every five minutes.
 */
const CASES: string[][] = [
  [],
  ['maor@adnimation.com'],
  ['mor@adnimation.com'],
  ['treves@adnimation.com'],
  ['mor@adnimation.com', 'maor@adnimation.com'],
  ['MOR@Adnimation.com'],
  ['amir@adnimation.com', 'treves@adnimation.com'],
];

describe('mirror skip parity', () => {
  it('agrees on every case, with the default list and with a custom one', () => {
    for (const raw of [undefined, 'mor@adnimation.com,treves@adnimation.com', 'amir@adnimation.com', '']) {
      const ts = skipList(raw);
      const mjs = js.skipList(raw);
      expect(mjs).toEqual(ts);

      for (const assignees of CASES) {
        expect(js.shouldMirror(assignees, mjs), assignees.join('+')).toBe(
          shouldMirror(assignees, ts),
        );
      }
    }
  });
});
