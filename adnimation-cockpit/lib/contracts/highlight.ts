/**
 * Finding a quoted clause inside the document it came from.
 *
 * The review screen puts their draft on the left and our changes on the right,
 * and the left side is only useful if the problem passages are marked in it.
 * The model quotes each clause it wants changed; this locates that quote in
 * the text so it can be highlighted where it actually sits.
 *
 * Exact matching fails constantly on real documents: a PDF converted to text
 * carries line breaks mid-sentence, double spaces, non-breaking spaces and
 * curly quotes, none of which survive a round trip through a model. So the
 * match is made on a normalised copy while the offsets returned point into the
 * original — which is the whole difficulty, and the reason this is a module
 * with tests rather than three lines inside a component.
 */

export interface Mark {
  /** Index into the ORIGINAL text. */
  start: number;
  end: number;
  /** Which change this passage belongs to. */
  index: number;
}

const FOLD: [RegExp, string][] = [
  // Curly quotes, dashes and non-breaking spaces: cosmetic in a document,
  // fatal to an exact match.
  [/[‘’‛]/g, "'"],
  [/[“”‟]/g, '"'],
  [/[‐-―]/g, '-'],
  [/ /g, ' '],
];

/**
 * A normalised copy, plus a map back: `at[i]` is where character `i` of the
 * normalised text started in the original.
 */
function normalise(text: string): { flat: string; at: number[] } {
  let folded = text;
  for (const [pattern, to] of FOLD) folded = folded.replace(pattern, to);

  const flat: string[] = [];
  const at: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < folded.length; i += 1) {
    const ch = folded[i]!;
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      // Any run of whitespace — including the line breaks a PDF puts mid
      // sentence — counts as one space.
      if (lastWasSpace || flat.length === 0) continue;
      flat.push(' ');
      at.push(i);
      lastWasSpace = true;
      continue;
    }
    flat.push(ch.toLowerCase());
    at.push(i);
    lastWasSpace = false;
  }

  return { flat: flat.join(''), at };
}

/**
 * Where each quote sits in the text. Quotes that cannot be found are simply
 * absent from the result: a highlight in the wrong place is worse than none,
 * because he would read the passage beside it as the one being changed.
 */
export function findMarks(text: string, quotes: string[]): Mark[] {
  if (text.trim() === '') return [];
  const { flat, at } = normalise(text);

  const marks: Mark[] = [];
  quotes.forEach((quote, index) => {
    const needle = normalise(quote).flat.trim();
    // A very short quote matches everywhere and marks nothing useful.
    if (needle.length < 12) return;

    let from = flat.indexOf(needle);
    if (from === -1) {
      // A quote that runs past where the model stopped copying: try its first
      // sentence-worth, which is usually enough to place it.
      const head = needle.slice(0, Math.max(40, Math.floor(needle.length / 2)));
      if (head.length < 12) return;
      from = flat.indexOf(head);
      if (from === -1) return;
      marks.push({ start: at[from]!, end: (at[from + head.length - 1] ?? at[at.length - 1]!) + 1, index });
      return;
    }

    marks.push({
      start: at[from]!,
      end: (at[from + needle.length - 1] ?? at[at.length - 1]!) + 1,
      index,
    });
  });

  // Sorted and non-overlapping, so rendering can walk them in one pass.
  marks.sort((a, b) => a.start - b.start);
  const kept: Mark[] = [];
  for (const mark of marks) {
    const last = kept[kept.length - 1];
    if (last && mark.start < last.end) continue;
    kept.push(mark);
  }
  return kept;
}

/** The text split into runs, each either plain or belonging to a change. */
export function splitByMarks(
  text: string,
  marks: Mark[],
): { text: string; index: number | null }[] {
  const out: { text: string; index: number | null }[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start > at) out.push({ text: text.slice(at, mark.start), index: null });
    out.push({ text: text.slice(mark.start, mark.end), index: mark.index });
    at = mark.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), index: null });
  return out;
}
