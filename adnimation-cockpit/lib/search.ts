/**
 * Finding a row by typing part of it.
 *
 * One matcher for every screen, so "taboola" finds the same thing in contracts
 * as in the pipeline. Three decisions worth stating:
 *
 * · Every word must match, in any field and any order. "google demand" finds
 *   the Google demand contract without him remembering which field held which
 *   word, and without "google" alone dragging in forty rows.
 * · Case and accents are folded, so GOOGLE, Google and google are one thing.
 *   Hebrew has no case, but it does have niqqud, which the normalisation
 *   flattens.
 * · A field that is not a string is not skipped — a number, a date or a
 *   status is often exactly what he is typing.
 */

const fold = (s: string) =>
  s
    .normalize('NFKD')
    // Combining marks: accents in Latin, niqqud and cantillation in Hebrew.
    .replace(/[\u0300-\u036f\u0591-\u05c7]/g, '')
    .toLowerCase();

export type Searchable = string | number | Date | null | undefined;

/** The words in a query, folded. Empty when he has not typed anything. */
export function queryTerms(q: string | null | undefined): string[] {
  return fold((q ?? '').trim())
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * One row's searchable text, folded, for the browser to match against.
 *
 * The list narrows as he types by hiding rows whose `data-search` is missing a
 * word — see components/hud/instant-filter.tsx. That only agrees with the
 * server if both fold the same way, so both fold here.
 */
export function foldForSearch(...fields: Searchable[]): string {
  return fold(
    fields
      .map((f) => (f instanceof Date ? f.toISOString() : f == null ? '' : String(f)))
      .join('   '),
  );
}

/**
 * Does this row match? With no query, everything does — a search box he has
 * not used must never hide a row.
 */
export function matchesQuery(q: string | null | undefined, ...fields: Searchable[]): boolean {
  const terms = queryTerms(q);
  if (terms.length === 0) return true;

  const hay = foldForSearch(...fields);
  return terms.every((term) => hay.includes(term));
}

/** The same, for rows whose searchable text is assembled by the caller. */
export function filterByQuery<T>(
  rows: T[],
  q: string | null | undefined,
  fieldsOf: (row: T) => Searchable[],
): T[] {
  if (queryTerms(q).length === 0) return rows;
  return rows.filter((row) => matchesQuery(q, ...fieldsOf(row)));
}
