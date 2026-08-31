import { describe, expect, it } from 'vitest';
import { isStaleBuild } from '@/lib/stale-build';

/**
 * Telling a stale build apart from a real fault decides whether the page
 * reloads itself or stops and says something.
 *
 * Getting it wrong in one direction strands him on a blank screen after every
 * deploy; in the other it reloads for ever on a page that is genuinely broken.
 */
describe('recognising a tab left open across a deploy', () => {
  it.each([
    'ChunkLoadError',
    'Loading chunk 429 failed.',
    'Failed to fetch dynamically imported module: https://cockpit.wonderfool.xyz/_next/static/chunks/x.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
  ])('knows %s is a stale build', (message) => {
    expect(isStaleBuild(new Error(message))).toBe(true);
  });

  it.each([
    'Cannot read properties of undefined (reading "map")',
    'contract.versions is not iterable',
    'Failed to fetch',
    'NetworkError when attempting to fetch resource',
  ])('does not blame the deploy for %s', (message) => {
    expect(isStaleBuild(new Error(message))).toBe(false);
  });

  it('reads the error name too, which is where ChunkLoadError lives', () => {
    const e = new Error('Loading CSS chunk failed');
    e.name = 'ChunkLoadError';
    expect(isStaleBuild(e)).toBe(true);
  });
});
