import { describe, expect, it } from 'vitest';
import { cleanLines, PILLAR_OPTIONS, TAGGABLE } from '@/lib/control/pillars';
import { ACTIVITY_LINES, LINE_LABEL } from '@/lib/control/lines';

describe('the pillars a thing can be tagged to', () => {
  it('is exactly the seven the overview shows', () => {
    expect(PILLAR_OPTIONS.map((p) => p.line)).toEqual([...ACTIVITY_LINES]);
    expect(PILLAR_OPTIONS).toHaveLength(7);
  });

  it('calls them what he calls them', () => {
    const labels = PILLAR_OPTIONS.map((p) => p.label);
    expect(labels).toContain('CORE PUBLISHERS');
    expect(labels).toContain('EXCHANGE APP');
    expect(labels).toContain('EXCHANGE CTV');
    expect(labels).toContain('EXCHANGE DISPLAY');
    expect(labels).toContain('BUDDER');
    expect(labels).toContain('GOOGLE CTV');
    expect(labels).toContain('IBV — VIDEO');
  });

  it('uses the same words on a tile and on a tag', () => {
    // Two taxonomies for one thing is how a filter starts lying about the board.
    for (const p of PILLAR_OPTIONS) expect(p.label).toBe(LINE_LABEL[p.line]);
  });

  it('tags three kinds of thing', () => {
    expect([...TAGGABLE]).toEqual(['task', 'deal', 'contract']);
  });
});

describe('what a form is allowed to send', () => {
  it('keeps the real ones', () => {
    expect(cleanLines(['apps', 'ctv'])).toEqual(['apps', 'ctv']);
  });

  it('drops anything that is not a pillar', () => {
    expect(cleanLines(['apps', 'not_a_line', '', 'DROP TABLE'])).toEqual(['apps']);
  });

  it('drops a repeat rather than storing it twice', () => {
    expect(cleanLines(['ctv', 'ctv', 'ctv'])).toEqual(['ctv']);
  });

  it('always reads in the same order, however he ticked them', () => {
    // A card whose tags reorder between saves reads as a card that changed.
    expect(cleanLines(['ibv', 'core_clients', 'apps'])).toEqual(
      cleanLines(['apps', 'ibv', 'core_clients']),
    );
  });

  it('trims what a form pads', () => {
    expect(cleanLines([' apps ', '\tctv'])).toEqual(['apps', 'ctv']);
  });

  it('is nothing when nothing was ticked', () => {
    expect(cleanLines([])).toEqual([]);
  });
});
