#!/usr/bin/env node
/**
 * Regenerate deploy/opportunity-detect.mjs from lib/opportunities/detect.ts.
 *
 *   node deploy/build-detect.mjs
 *
 * The sweep job runs as plain ESM outside the compiled app, so it cannot import
 * the TypeScript. Rather than maintain the rules twice, they are written once
 * in TypeScript and the types stripped here. detect-parity.test.ts fails if the
 * generated copy drifts, so forgetting to run this is caught by the suite
 * rather than in production.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../lib/opportunities/detect.ts', import.meta.url);
const OUT = new URL('./opportunity-detect.mjs', import.meta.url);

const HEADER = `/**
 * GENERATED FROM lib/opportunities/detect.ts — do not edit by hand.
 *
 * The sweep job runs as plain ESM outside the compiled app, so it needs a
 * JavaScript copy of the detection rules. tests/unit/detect-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
`;

const REWRITES = [
  [/export interface DetectionInput \{[\s\S]*?\n\}\n\n/, ''],
  [/export interface Detection \{[\s\S]*?\n\}\n\n/, ''],
  ['const STRONG: [RegExp, string][] = [', 'const STRONG = ['],
  ['const WEAK: [RegExp, string][] = [', 'const WEAK = ['],
  ['const NOISE: RegExp[] = [', 'const NOISE = ['],
  ["function classifyKind(text: string): Detection['kind'] {", 'function classifyKind(text) {'],
  ['export function detectOpportunity(input: DetectionInput): Detection {', 'export function detectOpportunity(input) {'],
  ['  const none: Detection = {', '  const none = {'],
  ['  const reasons: string[] = [];', '  const reasons = [];'],
];

let body = readFileSync(SRC, 'utf8');
for (const [from, to] of REWRITES) body = body.replace(from, to);

// Anything left with a type annotation would be a syntax error at run time, and
// a job that crashes on the timer is worse than one that fails to build.
if (/:\s*(string|number|boolean|RegExp|Detection)\b/.test(body)) {
  console.error('a type annotation survived the strip — update REWRITES in this file');
  process.exit(1);
}

writeFileSync(OUT, HEADER + body);
console.log(`wrote ${OUT.pathname}`);
