import { describe, expect, it } from 'vitest';
import {
  CATEGORY_FOLDER, CONTRACT_CATEGORIES, STAGE_FOLDER, filingFolder, safeFolderName,
  stageForStatus, versionedFileName,
} from '@/lib/contracts/drive';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/contract-folders.mjs';
import { BOARD_STATUSES } from '@/lib/contracts/status';

/**
 * The app and the jobs must file a contract in exactly the same place.
 *
 * They did not. The backfill job carried its own copy of the category map,
 * which still held only demand, supply and general — so the first contract
 * classified as "mutual" produced an undefined folder name, a path with an
 * empty segment, and a crash mid-run. The app was right and the job was a year
 * behind it, and nothing said so.
 */
describe('the app and the jobs file contracts identically', () => {
  it('agrees on every category and stage combination', () => {
    for (const category of [...CONTRACT_CATEGORIES, null] as const) {
      for (const status of BOARD_STATUSES) {
        const stage = stageForStatus(status);
        expect(js.filingFolder('Bright Mountain Media', category, stage)).toEqual(
          filingFolder('Bright Mountain Media', category, stage),
        );
      }
    }
  });

  it('has a folder name for every category, in both', () => {
    for (const category of CONTRACT_CATEGORIES) {
      expect(js.CATEGORY_FOLDER[category], `job has no folder for ${category}`).toBeTruthy();
      expect(js.CATEGORY_FOLDER[category]).toBe(CATEGORY_FOLDER[category]);
    }
  });

  it('has a folder name for every stage, in both', () => {
    for (const status of BOARD_STATUSES) {
      const stage = stageForStatus(status);
      expect(js.STAGE_FOLDER[stage]).toBe(STAGE_FOLDER[stage]);
    }
  });

  it('never produces a path with an empty segment', () => {
    // That is what an unknown category looked like: "/Adnimation Contracts//Foo".
    for (const category of [...CONTRACT_CATEGORIES, null] as const) {
      const target = js.filingFolder('Foo', category, 'in_review');
      expect(target.path).not.toContain('//');
      expect(target.segments.every((s: string) => s.length > 0)).toBe(true);
    }
  });

  it('agrees on names, including the awkward ones', () => {
    for (const name of ['Acme/Corp', '  spaced  out  ', 'חברה בע"מ', 'x'.repeat(200)]) {
      expect(js.safeFolderName(name)).toBe(safeFolderName(name));
    }
    expect(
      js.versionedFileName({
        counterparty: 'Taboola', docType: 'Renewal', version: 2, date: '2026-08-31',
      }),
    ).toBe(
      versionedFileName({
        counterparty: 'Taboola', docType: 'Renewal', version: 2, date: '2026-08-31',
      }),
    );
  });
});
