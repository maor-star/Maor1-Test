import { ACTIVITY_LINES, LINE_LABEL, type ActivityLine } from './lines';

/**
 * The pillars, as the browser needs them.
 *
 * Apart from the rest of the tagging module because a client component that
 * imports the picker must not drag the database in behind it: one import of
 * `lib/db` from a component marked 'use client' and the whole build fails on
 * `Can't resolve 'net'`. Nothing here touches a connection.
 *
 * The list itself now lives in the `pillars` table, because he asked to be able
 * to add to it and rename what is in it. What is left here is the shape a
 * screen passes around, and the seven the table is seeded with — which stay as
 * the fallback for anything that has to answer before a row has been read.
 */

export const TAGGABLE = ['task', 'deal', 'contract'] as const;
export type Taggable = (typeof TAGGABLE)[number];

/** One pillar, as a chip or a tag needs it. */
export interface PillarOption {
  line: string;
  label: string;
}

/** The seven the app ships with, in their order. The table is seeded from these. */
export const PILLAR_OPTIONS: { line: ActivityLine; label: string }[] = ACTIVITY_LINES.map((line) => ({
  line,
  label: LINE_LABEL[line],
}));

/**
 * Only pillars that exist, whatever a form sends.
 *
 * `known` is the live list — every pillar in the table, hidden ones included,
 * because hiding a pillar must not quietly strip it off the work already
 * tagged with it. Callers that have not read the table fall back to the seven.
 *
 * The result comes back in the list's own order, so a card's tags always read
 * in the same order however he ticked them.
 */
export function cleanLines(
  values: readonly string[],
  known: readonly string[] = ACTIVITY_LINES,
): string[] {
  const allowed = new Set<string>(known);
  const out = new Set<string>();
  for (const value of values) {
    const line = value.trim();
    if (allowed.has(line)) out.add(line);
  }
  return known.filter((l) => out.has(l));
}

/**
 * A name turned into a key.
 *
 * The key is what every tag row and every target already stores, so it has to
 * be stable and it has to be ASCII — he names a pillar in whatever language he
 * likes, and a name that yields nothing usable falls back to a stamped key
 * rather than to an empty one.
 */
export function lineKeyFor(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return key || `pillar_${Date.now().toString(36)}`;
}
