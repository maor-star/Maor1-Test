import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIP, shouldMirror, skipList } from '@/lib/sync/mirror-skip';

/**
 * Whose tasks reach his list.
 *
 * The failure that matters here is the quiet one: a rule that hides a task he
 * is on. Everything below is a case where a simpler rule — "skip if the first
 * assignee is on the list" — would have dropped work he needs to see.
 */
const SKIP = ['mor@adnimation.com', 'treves@adnimation.com'];

describe('whose ClickUp tasks are mirrored', () => {
  it('keeps his own', () => {
    expect(shouldMirror(['maor@adnimation.com'], SKIP)).toBe(true);
  });

  it('drops one that is only theirs', () => {
    expect(shouldMirror(['mor@adnimation.com'], SKIP)).toBe(false);
    expect(shouldMirror(['treves@adnimation.com'], SKIP)).toBe(false);
    expect(shouldMirror(['mor@adnimation.com', 'treves@adnimation.com'], SKIP)).toBe(false);
  });

  it('keeps one he shares with them, whoever ClickUp lists first', () => {
    expect(shouldMirror(['mor@adnimation.com', 'maor@adnimation.com'], SKIP)).toBe(true);
    expect(shouldMirror(['maor@adnimation.com', 'mor@adnimation.com'], SKIP)).toBe(true);
  });

  it('keeps one assigned to nobody — it belongs to no one, so it is not theirs', () => {
    expect(shouldMirror([], SKIP)).toBe(true);
  });

  it('keeps anyone else on the team', () => {
    expect(shouldMirror(['amir@adnimation.com'], SKIP)).toBe(true);
    expect(shouldMirror(['mohd@adnimation.com'], SKIP)).toBe(true);
  });

  it('does not care about case or stray spacing', () => {
    expect(shouldMirror([' MOR@Adnimation.com '], SKIP)).toBe(false);
    expect(shouldMirror(['mor@adnimation.com'], [' Mor@ADNIMATION.com '])).toBe(false);
  });

  it('mirrors everything when the list is empty', () => {
    expect(shouldMirror(['mor@adnimation.com'], [])).toBe(true);
  });

  it('reads the list from the environment, and falls back to the two he named', () => {
    expect(skipList(undefined)).toEqual(DEFAULT_SKIP);
    expect(skipList('a@x.com, B@X.com ,')).toEqual(['a@x.com', 'b@x.com']);
    // An explicitly empty setting means "mirror everyone", not "use the default".
    expect(skipList('')).toEqual([]);
  });
});
