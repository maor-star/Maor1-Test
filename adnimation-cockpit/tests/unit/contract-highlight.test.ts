import { describe, expect, it } from 'vitest';
import { findMarks, splitByMarks } from '@/lib/contracts/highlight';

/**
 * Marking the problem passages inside their draft.
 *
 * A highlight in the wrong place is worse than no highlight: he reads the
 * passage beside it as the one being changed, and signs on that basis. So
 * every case here is either "find it despite the mangling a PDF does to text"
 * or "find nothing rather than the wrong thing".
 */
const DOC = [
  '1. Term. This Agreement shall commence on 1 January 2026 and continue for twelve (12) months.',
  '',
  '2. Payment. Adnimation shall be paid within ninety (90) days of the end of each calendar month.',
  '',
  '3. Liability. Neither party limits its liability under this Agreement.',
].join('\n');

describe('finding a quoted clause in the document', () => {
  it('finds a quote that matches exactly', () => {
    const marks = findMarks(DOC, ['paid within ninety (90) days of the end of each calendar month']);
    expect(marks).toHaveLength(1);
    expect(DOC.slice(marks[0]!.start, marks[0]!.end)).toContain('ninety (90) days');
  });

  it('finds it despite the line breaks a PDF puts mid-sentence', () => {
    const wrapped = DOC.replace('within ninety (90) days', 'within ninety\n(90)   days');
    const marks = findMarks(wrapped, ['paid within ninety (90) days of the end of each calendar month']);
    expect(marks).toHaveLength(1);
    expect(wrapped.slice(marks[0]!.start, marks[0]!.end)).toContain('(90)');
  });

  it('ignores curly quotes and dashes, which never survive a round trip', () => {
    const fancy = 'The Term is twelve (12) months — renewing automatically.';
    const marks = findMarks(fancy, ['twelve (12) months - renewing automatically']);
    expect(marks).toHaveLength(1);
  });

  it('places a quote the model copied only the start of', () => {
    const marks = findMarks(DOC, [
      'Neither party limits its liability under this Agreement, and each indemnifies the other without cap',
    ]);
    expect(marks).toHaveLength(1);
    expect(DOC.slice(marks[0]!.start, marks[0]!.end)).toContain('Neither party limits');
  });

  it('marks nothing rather than guessing when the quote is not there', () => {
    expect(findMarks(DOC, ['governed by the laws of Delaware'])).toEqual([]);
  });

  it('ignores a quote too short to mean anything', () => {
    // "Term" appears three times; marking one at random is worse than none.
    expect(findMarks(DOC, ['Term'])).toEqual([]);
  });

  it('keeps the marks in order and never overlapping', () => {
    const marks = findMarks(DOC, [
      'continue for twelve (12) months',
      'Neither party limits its liability',
      'paid within ninety (90) days',
    ]);
    expect(marks).toHaveLength(3);
    for (let i = 1; i < marks.length; i += 1) {
      expect(marks[i]!.start).toBeGreaterThanOrEqual(marks[i - 1]!.end);
    }
  });

  it('splits the document into runs that put it back together exactly', () => {
    const marks = findMarks(DOC, ['paid within ninety (90) days']);
    const runs = splitByMarks(DOC, marks);
    expect(runs.map((r) => r.text).join('')).toBe(DOC);
    expect(runs.some((r) => r.index === 0)).toBe(true);
  });

  it('survives an empty document and an empty quote list', () => {
    expect(findMarks('', ['anything'])).toEqual([]);
    expect(findMarks(DOC, [])).toEqual([]);
    expect(splitByMarks(DOC, [])).toEqual([{ text: DOC, index: null }]);
  });
});
