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
  {
    src: new URL('../lib/agents/mailbox.ts', import.meta.url),
    out: new URL('./mailbox-rules.mjs', import.meta.url),
    from: 'lib/agents/mailbox.ts',
    test: 'tests/unit/mailbox-parity.test.ts',
    rewrites: [
      [/export interface MailFacts \{[\s\S]*?\n\}\n\n/, ''],
      [/export interface PromoGuess \{[\s\S]*?\n\}\n\n/, ''],
      [/export interface CodeGuess \{[\s\S]*?\n\}\n\n/, ''],
      ['const PROMO_SIGNALS: [RegExp, string][] = [', 'const PROMO_SIGNALS = ['],
      ['export function looksPromotional(mail: MailFacts): PromoGuess {', 'export function looksPromotional(mail) {'],
      ['export function isSpentAuthCode(mail: MailFacts, expiryHours = CODE_EXPIRY_HOURS): CodeGuess {', 'export function isSpentAuthCode(mail, expiryHours = CODE_EXPIRY_HOURS) {'],
      ['  const reasons: string[] = [];', '  const reasons = [];'],
    ],
  },
  {
    src: new URL('../lib/agents/internal-mail.ts', import.meta.url),
    out: new URL('./internal-mail.mjs', import.meta.url),
    from: 'lib/agents/internal-mail.ts',
    test: 'tests/unit/internal-mail-parity.test.ts',
    rewrites: [
      [/export interface InvoiceInput \{[\s\S]*?\n\}\n\n/, ''],
      [/export interface InvoiceGuess \{[\s\S]*?\n\}\n\n/, ''],
      ['const INVOICE_WORDS = [', 'const INVOICE_WORDS = ['],
      ['const NOT_AN_INVOICE = [', 'const NOT_AN_INVOICE = ['],
      ['export function isInternalAddress(address: string, domains = INTERNAL_DOMAINS): boolean {', 'export function isInternalAddress(address, domains = INTERNAL_DOMAINS) {'],
      [/export function assertInternalRecipients\(\n  recipients: string\[\],\n  domains = INTERNAL_DOMAINS,\n\): \{ ok: true; recipients: string\[\] \} \| \{ ok: false; error: string \} \{/, 'export function assertInternalRecipients(recipients, domains = INTERNAL_DOMAINS) {'],
      ['export function looksLikeInvoice(input: InvoiceInput): InvoiceGuess {', 'export function looksLikeInvoice(input) {'],
      ['  const reasons: string[] = [];', '  const reasons = [];'],
    ],
  },
  {
    src: new URL('../lib/contracts/drive.ts', import.meta.url),
    out: new URL('./contract-folders.mjs', import.meta.url),
    from: 'lib/contracts/drive.ts',
    test: 'tests/unit/contract-folders-parity.test.ts',
    rewrites: [
      [/export type ContractCategory =[^;]+;\n/, ''],
      [/export type FilingStage =[\s\S]*?;\n/, ''],
      [/export interface FilingTarget \{[\s\S]*?\n\}\n\n/, ''],
      ['export const CONTRACT_CATEGORIES: readonly ContractCategory[] = [', 'export const CONTRACT_CATEGORIES = ['],
      // `as const` is TypeScript-only and would be a syntax error at run time.
      [/\n\] as const;/g, '\n];'],
      ['export const CATEGORY_FOLDER: Record<ContractCategory, string> = {', 'export const CATEGORY_FOLDER = {'],
      ['export const STAGE_FOLDER: Record<FilingStage, string> = {', 'export const STAGE_FOLDER = {'],
      ['export function stageForStatus(status: string): FilingStage {', 'export function stageForStatus(status) {'],
      ['export function safeFolderName(name: string): string {', 'export function safeFolderName(name) {'],
      [/export function filingFolder\(\n  counterparty: string,\n  category: ContractCategory \| null,\n  stage: FilingStage = 'signed',\n\): FilingTarget \{/, "export function filingFolder(counterparty, category, stage = 'signed') {"],
      [/export function versionedFileName\(opts: \{[\s\S]*?\n\}\): string \{/, 'export function versionedFileName(opts) {'],
      [/export function categoriseCounterparty\(signals: \{[\s\S]*?\n\}\): ContractCategory \| null \{/, 'export function categoriseCounterparty(signals) {'],
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

/**
 * Strip the type-only declarations every file has, before the per-file
 * rewrites deal with what is left.
 *
 * Doing this generically rather than naming each interface per target is what
 * stops a new type in a source file quietly breaking its generated copy — the
 * per-file lists were three files long and already drifting.
 */
function stripTypeDeclarations(source) {
  return (
    source
      // export interface X { … } and export type X = …;
      .replace(/export interface \w+ \{[\s\S]*?\n\}\n+/g, '')
      .replace(/export type \w+ =[\s\S]*?;\n+/g, '')
      .replace(/^type \w+ =[\s\S]*?;\n+/gm, '')
      // import type { … } from '…';
      .replace(/import type \{[^}]*\} from [^;]+;\n/g, '')
      /*
       * Local annotations: `const reasons: string[] = []`.
       *
       * Globally, because a per-file string rewrite replaces only the first
       * occurrence — and `const reasons: string[] = []` appears twice in the
       * mailbox rules, which is exactly how this was found.
       */
      .replace(/\b(const|let) (\w+): [\w[\]<>, |'"]+ =/g, '$1 $2 =')
      // `as const` is TypeScript-only and a syntax error at run time.
      .replace(/\n\] as const;/g, '\n];')
      .replace(/ as const;/g, ';')
  );
}

for (const target of TARGETS) {
  let body = stripTypeDeclarations(readFileSync(target.src, 'utf8'));
  for (const [from, to] of target.rewrites) body = body.replace(from, to);

  // Anything left with a type annotation would be a syntax error at run time,
  // and a job that crashes on the timer is worse than one that fails to build.
  if (
    /:\s*(string|number|boolean|RegExp|Detection|ContractGuess|AttachmentInput|ContractCategory|FilingStage|FilingTarget|InvoiceInput|InvoiceGuess|MailFacts|PromoGuess|CodeGuess)\b/.test(
      body,
    )
  ) {
    console.error(`${target.from}: a type annotation survived the strip — update its rewrites`);
    process.exit(1);
  }

  writeFileSync(target.out, header(target.from, target.test) + body);
  console.log(`wrote ${target.out.pathname}`);
}
