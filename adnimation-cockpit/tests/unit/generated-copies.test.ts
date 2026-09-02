import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — the generator is plain ESM with no types.
import { TARGETS, generate } from '@/deploy/build-detect.mjs';

/**
 * Every generated job copy is in step with the TypeScript it came from.
 *
 * The rules the jobs run are written once in TypeScript and stripped into
 * plain ESM, because the jobs run outside the compiled app. The per-file
 * parity tests check that the two agree about the answers they give — but only
 * for the functions each test happens to import. A new export can therefore
 * ship in TypeScript with no generated half at all, and nothing says so until
 * the job crashes on its timer with "does not provide an export named …".
 *
 * That is exactly what happened to linksInSignature. This compares the whole
 * file: build each copy in memory and check it byte for byte against what is
 * on disk. A source edit without `node deploy/build-detect.mjs` now fails here.
 */

interface Target {
  src: URL;
  out: URL;
  from: string;
  rewrites: [string | RegExp, string][];
  /** Exports the generator drops on purpose, and says why where it drops them. */
  omits?: string[];
}

const targets = TARGETS as Target[];

describe('the generated job copies', () => {
  it('covers every target the generator knows about', () => {
    expect(targets.length).toBeGreaterThan(5);
  });

  it.each(targets.map((t) => [t.from, t] as const))(
    '%s is in step with its generated copy',
    (from, target) => {
      const onDisk = readFileSync(target.out, 'utf8');
      const expected = generate(target) as string;
      expect(
        onDisk === expected,
        `${from} has changed without its generated copy. Run: node deploy/build-detect.mjs`,
      ).toBe(true);
    },
  );

  it.each(targets.map((t) => [t.from, t] as const))(
    '%s exports everything its source exports',
    async (from, target) => {
      const source = readFileSync(target.src, 'utf8');
      // Values only: an exported interface or type has nothing to generate.
      const wanted = [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(
        (m) => m[1] as string,
      );
      const generated = (await import(/* @vite-ignore */ target.out.pathname)) as Record<string, unknown>;
      const omitted = new Set(target.omits ?? []);
      for (const name of wanted) {
        if (omitted.has(name)) {
          // A declared omission must actually be omitted, or the declaration
          // is stale and hiding the next real gap.
          expect(generated[name], `${from} declares ${name} omitted, but it is generated`).toBeUndefined();
          continue;
        }
        expect(generated[name], `${from} exports ${name}, the generated copy does not`).toBeDefined();
      }
    },
  );
});
