import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No client component may drag the database in behind it.
 *
 * A file marked 'use client' that imports `@/lib/db` — directly, or through a
 * module that does — fails the production build with `Can't resolve 'net'`,
 * from inside node_modules, naming a file that looks nothing like the mistake.
 * The build is where this is caught today, which means it is caught after the
 * change is written and only if a build is run. This catches it in the suite,
 * next to a message that says what to do.
 *
 * The fix is always the same shape: split the browser-safe half of the module
 * out (the constants, the labels, the pure functions) and leave the queries
 * behind — `lib/control/pillars.ts` beside `lib/control/tagging.ts` is the
 * worked example.
 */

const ROOT = join(__dirname, '..', '..');
const SEARCH = ['components', 'app'];

/** Every .ts/.tsx file under a directory. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * The local modules a file imports for their VALUES.
 *
 * A type-only import is erased before the bundler sees it, so
 * `import type { PipelineRow } from '@/lib/pipeline/service'` in a client
 * component is not a route to the database — most of the app's components do
 * exactly that, and counting them would make this test noise rather than a
 * guard.
 */
function imports(source: string): string[] {
  const found: string[] = [];
  // Anchored per statement, and the clause may not contain a quote — otherwise
  // the match runs from one import's keyword to a later import's specifier and
  // reads the wrong clause for the wrong module.
  const pattern = /^import\s+([^']*?)\s+from\s+'(@\/[^']+|\.[^']*)'/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const clause = match[1]!.trim();
    const spec = match[2]!;

    // `import type { … } from` — nothing survives compilation.
    if (/^type\s/.test(clause)) continue;

    // `import { type A, type B } from` — every binding is a type.
    const braces = clause.match(/^\{([\s\S]*)\}$/);
    if (braces) {
      const names = braces[1]!.split(',').map((n) => n.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => /^type\s/.test(n))) continue;
    }

    found.push(spec);
  }
  return found;
}

/** Resolve an import as written to a file on disk, or null when it is not ours. */
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(ROOT, spec.slice(2))
    : join(from, '..', spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not that one.
    }
  }
  return null;
}

const DB = join(ROOT, 'lib', 'db');

/** A module that runs on the server whatever imports it. */
function isServerAction(source: string): boolean {
  return /^\s*(['"])use server\1/m.test(source.slice(0, 200));
}

/**
 * Whether a module reaches the database, however many hops it takes.
 *
 * The walk stops at a server action: a client component importing one gets a
 * reference the bundler replaces with a call over the wire, so what the action
 * imports never reaches the browser. That is the whole point of them, and
 * following through one would flag every screen in the app.
 */
function reachesDb(file: string, seen = new Set<string>()): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);

  const source = readFileSync(file, 'utf8');
  if (isServerAction(source)) return null;

  for (const spec of imports(source)) {
    const target = resolve(file, spec);
    if (!target) continue;
    if (target.startsWith(DB)) return [spec];
    const deeper = reachesDb(target, seen);
    if (deeper) return [spec, ...deeper];
  }
  return null;
}

describe('client components and the database', () => {
  it('never reach it, however indirectly', () => {
    const offenders: string[] = [];

    for (const dir of SEARCH) {
      for (const file of walk(join(ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        // Only the first line or two can carry the directive.
        if (!/^\s*(['"])use client\1/m.test(source.slice(0, 200))) continue;
        const path = reachesDb(file);
        if (path) offenders.push(`${file.slice(ROOT.length + 1)} → ${path.join(' → ')}`);
      }
    }

    expect(
      offenders,
      `These client components reach lib/db and will fail the build with ` +
        `"Can't resolve 'net'". Split the browser-safe half of the module out:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
