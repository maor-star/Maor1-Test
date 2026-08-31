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

const TARGETS = [
  {
    src: new URL('../lib/opportunities/detect.ts', import.meta.url),
    out: new URL('./opportunity-detect.mjs', import.meta.url),
    from: 'lib/opportunities/detect.ts',
    test: 'tests/unit/detect-parity.test.ts',
    rewrites: [
      [/export interface DetectionInput \{[\s\S]*?\n\}\n\n/, ''],
      [/export interface Detection \{[\s\S]*?\n\}\n\n/, ''],
      ['const STRONG: [RegExp, string][] = [', 'const STRONG = ['],
      ['const WEAK: [RegExp, string][] = [', 'const WEAK = ['],
      ['const NOISE: RegExp[] = [', 'const NOISE = ['],
      ["function classifyKind(text: string): Detection['kind'] {", 'function classifyKind(text) {'],
      ['export function detectOpportunity(input: DetectionInput): Detection {', 'export function detectOpportunity(input) {'],
      ['  const none: Detection = {', '  const none = {'],
      ['  const reasons: string[] = [];', '  const reasons = [];'],
    ],
  },
  {
    src: new URL('../lib/contracts/intake.ts', import.meta.url),
    out: new URL('./contract-intake.mjs', import.meta.url),
    from: 'lib/contracts/intake.ts',
    test: 'tests/unit/contract-parity.test.ts',
    rewrites: [
      [/export interface AttachmentInput \{[\s\S]*?\n\}\n\n/, ''],
      [/export interface ContractGuess \{[\s\S]*?\n\}\n\n/, ''],
      ['const CONTRACT_WORDS = [', 'const CONTRACT_WORDS = ['],
      ['const NOT_CONTRACT = [', 'const NOT_CONTRACT = ['],
      ['export function looksLikeContract(input: AttachmentInput): ContractGuess {', 'export function looksLikeContract(input) {'],
      ['  const reasons: string[] = [];', '  const reasons = [];'],
      ['export function versionFromName(fileName: string, existingVersions: number): number {', 'export function versionFromName(fileName, existingVersions) {'],
      [/export function counterpartyFrom\(opts: \{[\s\S]*?\n\}\): string \| null \{/, 'export function counterpartyFrom(opts) {'],
    ],
  },
];

const header = (from, test) => `/**
 * GENERATED FROM ${from} — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. ${test}
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
`;

for (const target of TARGETS) {
  let body = readFileSync(target.src, 'utf8');
  for (const [from, to] of target.rewrites) body = body.replace(from, to);

  // Anything left with a type annotation would be a syntax error at run time,
  // and a job that crashes on the timer is worse than one that fails to build.
  if (/:\s*(string|number|boolean|RegExp|Detection|ContractGuess|AttachmentInput)\b/.test(body)) {
    console.error(`${target.from}: a type annotation survived the strip — update its rewrites`);
    process.exit(1);
  }

  writeFileSync(target.out, header(target.from, target.test) + body);
  console.log(`wrote ${target.out.pathname}`);
}
