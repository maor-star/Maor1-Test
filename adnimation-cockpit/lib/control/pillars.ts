import { ACTIVITY_LINES, LINE_LABEL, type ActivityLine } from './lines';

/**
 * The pillars, as the browser needs them.
 *
 * Apart from the rest of the tagging module because a client component that
 * imports the picker must not drag the database in behind it: one import of
 * `lib/db` from a component marked 'use client' and the whole build fails on
 * `Can't resolve 'net'`. Nothing here touches a connection.
 */

export const TAGGABLE = ['task', 'deal', 'contract'] as const;
export type Taggable = (typeof TAGGABLE)[number];

/** Only the seven, whatever a form sends. */
export function cleanLines(values: readonly string[]): ActivityLine[] {
  const known = new Set<string>(ACTIVITY_LINES);
  const out: ActivityLine[] = [];
  for (const value of values) {
    const line = value.trim();
    if (known.has(line) && !out.includes(line as ActivityLine)) out.push(line as ActivityLine);
  }
  // Returned in the order the pillars are listed, so a card's tags always read
  // in the same order however he ticked them.
  return ACTIVITY_LINES.filter((l) => out.includes(l));
}

/** The pillars, for a picker: the key and the words he calls it by. */
export const PILLAR_OPTIONS: { line: ActivityLine; label: string }[] = ACTIVITY_LINES.map((line) => ({
  line,
  label: LINE_LABEL[line],
}));
