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

export const TARGETS = [
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
    src: new URL('../lib/agents/autoreply.ts', import.meta.url),
    out: new URL('./autoreply-rules.mjs', import.meta.url),
    from: 'lib/agents/autoreply.ts',
    test: 'tests/unit/autoreply-parity.test.ts',
    /**
     * Deliberately not generated: both need zod and the model client, which
     * the job neither has nor wants — the job decides WHETHER to answer, the
     * app decides WHAT to say. Everything the job's send gate depends on sits
     * above them in the source and is generated.
     */
    omits: ['draftSchema', 'draftReply'],
    rewrites: [
      // The job does its own Claude call, so the drafting half is not needed.
      [/import \{ z \} from 'zod';\n/, ''],
      [/import \{ ask \}[^;]+;\n/, ''],
      /*
       * Everything from draftSchema down needs zod and the model client, which
       * the job does not have and does not want: the job decides WHETHER to
       * answer, the app decides WHAT to say. Declared in `omits` below so the
       * generated-copies test knows this is a decision, not a slip.
       */
      [/export const draftSchema[\s\S]*$/, ''],
      ['const NEVER: [RegExp, string][] = [', 'const NEVER = ['],
      ['const SIMPLE: [RegExp, string][] = [', 'const SIMPLE = ['],
      ['export function triage(candidate: ReplyCandidate): Triage {', 'export function triage(candidate) {'],
      [
        'export function maySend(triaged: Triage, draft: Draft): { send: boolean; why: string } {',
        'export function maySend(triaged, draft) {',
      ],
      [
        'export function mayFile(triaged: Triage): { consider: boolean; why: string } {',
        'export function mayFile(triaged) {',
      ],
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
    src: new URL('../lib/crm/from-mail.ts', import.meta.url),
    out: new URL('./crm-from-mail.mjs', import.meta.url),
    from: 'lib/crm/from-mail.ts',
    test: 'tests/unit/crm-from-mail-parity.test.ts',
    rewrites: [
      ['const NOT_A_PERSON = [', 'const NOT_A_PERSON = ['],
      ['export function domainOf(email: string): string | null {', 'export function domainOf(email) {'],
      [/export function isHarvestable\(\n  candidate: HarvestCandidate,\n  ownDomains: string\[\] = \['adnimation\.com'\],\n\): \{ ok: boolean; why: string \} \{/, "export function isHarvestable(candidate, ownDomains = ['adnimation.com']) {"],
      ['export function isCompanyDomain(email: string): boolean {', 'export function isCompanyDomain(email) {'],
      ['export function signatureBlock(body: string, lines = 18): string {', 'export function signatureBlock(body, lines = 18) {'],
      [/export function fieldsToFill<T extends Record<string, unknown>>\(\n  existing: T,\n  found: Partial<T>,\n\): Partial<T> \{/, 'export function fieldsToFill(existing, found) {'],
      ['  const patch: Partial<T> = {};', '  const patch = {};'],
      [/  for \(const \[key, value\] of Object\.entries\(found\) as \[keyof T, T\[keyof T\]\]\[\]\) \{/, '  for (const [key, value] of Object.entries(found)) {'],
      [
        /export function linksInSignature\(block: string\): \{ linkedinUrl: string \| null; website: string \| null \} \{/,
        'export function linksInSignature(block) {',
      ],
    ],
  },
  {
    src: new URL('../lib/sync/mirror-skip.ts', import.meta.url),
    out: new URL('./mirror-skip.mjs', import.meta.url),
    from: 'lib/sync/mirror-skip.ts',
    test: 'tests/unit/mirror-skip-parity.test.ts',
    rewrites: [
      ['export function skipPair(raw: string | undefined = process.env.TASK_MIRROR_SKIP_PAIR): string[] {', 'export function skipPair(raw = process.env.TASK_MIRROR_SKIP_PAIR) {'],
      ['export function keepList(raw: string | undefined = process.env.TASK_MIRROR_KEEP): string[] {', 'export function keepList(raw = process.env.TASK_MIRROR_KEEP) {'],
      [/export function shouldMirror\(\n  assigneeEmails: string\[\],\n  pair: string\[\] = skipPair\(\),\n  keep: string\[\] = keepList\(\),\n\): boolean \{/, 'export function shouldMirror(assigneeEmails, pair = skipPair(), keep = keepList()) {'],
      ['const parse = (raw: string) =>', 'const parse = (raw) =>'],
    ],
  },
  {
    src: new URL('../lib/agents/slack-bots.ts', import.meta.url),
    out: new URL('./slack-bots.mjs', import.meta.url),
    from: 'lib/agents/slack-bots.ts',
    test: 'tests/unit/slack-bots-parity.test.ts',
    rewrites: [
      ['export const BOTS: BotIdentity[] = [', 'export const BOTS = ['],
      ['export const AGENT_BOT: Record<string, string> = {', 'export const AGENT_BOT = {'],
      ['export function botFor(agentName: string): BotIdentity {', 'export function botFor(agentName) {'],
      ['export function botStatuses(env: EnvLike = process.env): BotStatus[] {', 'export function botStatuses(env = process.env) {'],
      [/export function resolveBotByKey\(\n  key: string,\n  env: EnvLike = process\.env,\n\): \{[\s\S]*?\n\} \{/, 'export function resolveBotByKey(key, env = process.env) {'],
      ['export function resolveBot(agentName: string, env: EnvLike = process.env) {', 'export function resolveBot(agentName, env = process.env) {'],
      [/export function postingIdentity\(resolved: \{[\s\S]*?\n\}\): \{ username: string; icon: string \} \| null \{/, 'export function postingIdentity(resolved) {'],
      // The non-null assertion is TypeScript-only.
      [/BOTS\[BOTS\.length - 1\]!/g, 'BOTS[BOTS.length - 1]'],
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
  {
    src: new URL('../lib/meetings/rules.ts', import.meta.url),
    out: new URL('./meeting-rules.mjs', import.meta.url),
    from: 'lib/meetings/rules.ts',
    test: 'tests/unit/meetings-parity.test.ts',
    rewrites: [
      ['export function wantsMeeting(candidate: MeetingCandidate): MeetingRead {', 'export function wantsMeeting(candidate) {'],
      ['export function mayAnswer(candidate: MeetingCandidate): Verdict {', 'export function mayAnswer(candidate) {'],
      [
        /export function pickSlots\(\n  free: Slot\[\],\n  options: \{[^}]*\} = \{\},\n\): Slot\[\] \{/,
        'export function pickSlots(free, options = {}) {',
      ],
      ["export function slotLine(slot: Slot, timeZone = 'Asia/Jerusalem'): string {", "export function slotLine(slot, timeZone = 'Asia/Jerusalem') {"],
      ['  const parts = (d: Date) =>', '  const parts = (d) =>'],
      ['  const get = (ps: Intl.DateTimeFormatPart[], type: string) =>', '  const get = (ps, type) =>'],
      ['export function proposalText(input: ProposalInput): string {', 'export function proposalText(input) {'],
      [
        /export function maySend\(\n  read: MeetingRead,\n  allowed: Verdict,\n  reply: string,\n  has: \{ slots: number; calendly: boolean \},\n\): Verdict \{/,
        'export function maySend(read, allowed, reply, has) {',
      ],
      ['export function offsetMinutes(at: Date, timeZone: string): number {', 'export function offsetMinutes(at, timeZone) {'],
      ['export function instantAt(day: string, hour: number, minute: number, timeZone: string): Date {', 'export function instantAt(day, hour, minute, timeZone) {'],
      ['  const pad = (n: number) =>', '  const pad = (n) =>'],
      ['export function dayKey(at: Date, timeZone: string): string {', 'export function dayKey(at, timeZone) {'],
      ['export function weekdayIn(at: Date, timeZone: string): number {', 'export function weekdayIn(at, timeZone) {'],
      [
        'export function clockTime(value: string, fallback: string): { hour: number; minute: number } {',
        'export function clockTime(value, fallback) {',
      ],
      ['export function freeWindows(busy: Slot[], options: WorkingHours = {}): Slot[] {', 'export function freeWindows(busy, options = {}) {'],
      ['  const clashes = (start: number, end: number) =>', '  const clashes = (start, end) =>'],
      [
        "export function isEvening(slot: Slot, eveningFrom = '18:00', timeZone = 'Asia/Jerusalem'): boolean {",
        "export function isEvening(slot, eveningFrom = '18:00', timeZone = 'Asia/Jerusalem') {",
      ],
      ['export function asksForEvening(text: string): boolean {', 'export function asksForEvening(text) {'],
      [/export function decide\(input: \{[\s\S]*?\n\}\): Decision \{/, 'export function decide(input) {'],
      ['export function settled(why: string): boolean {', 'export function settled(why) {'],
      // Two `(type: string)` arrows are left, one in each date helper.
      [/\(type: string\) =>/g, '(type) =>'],
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

/*
 * Deliberately not including `Date`: `{ start: Date.parse(x) }` is an object
 * literal, not an annotation, and the guard cannot tell them apart. A `: Date`
 * that survived is a syntax error in the generated file, which the parity test
 * catches the moment it imports it.
 */
const SURVIVING_ANNOTATION =
  /:\s*(string|number|boolean|RegExp|Slot|MeetingCandidate|MeetingRead|Verdict|ProposalInput|WorkingHours|Decision|Detection|ContractGuess|AttachmentInput|ContractCategory|FilingStage|FilingTarget|InvoiceInput|InvoiceGuess|MailFacts|PromoGuess|CodeGuess|ReplyCandidate|Triage|Draft|BotIdentity|BotStatus|EnvLike|HarvestCandidate|HarvestedContact)\b/;

/**
 * What the generated copy of one target should be, byte for byte.
 *
 * Exported so the suite can build every copy in memory and compare it with
 * what is on disk. Forgetting to run this script is otherwise invisible until
 * a job crashes on its timer — which is exactly how a new export shipped
 * without its generated half.
 */
export function generate(target) {
  let body = stripTypeDeclarations(readFileSync(target.src, 'utf8'));
  for (const [from, to] of target.rewrites) body = body.replace(from, to);

  // Anything left with a type annotation would be a syntax error at run time,
  // and a job that crashes on the timer is worse than one that fails to build.
  if (SURVIVING_ANNOTATION.test(body)) {
    throw new Error(`${target.from}: a type annotation survived the strip — update its rewrites`);
  }

  return header(target.from, target.test) + body;
}

// Only when run as a script; importing this file must not write anything.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  for (const target of TARGETS) {
    let generated;
    try {
      generated = generate(target);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    writeFileSync(target.out, generated);
    console.log(`wrote ${target.out.pathname}`);
  }
}
