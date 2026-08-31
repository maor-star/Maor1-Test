import { describe, expect, it } from 'vitest';
import {
  counterpartyFrom, looksLikeContract, versionFromName, type AttachmentInput,
} from '@/lib/contracts/intake';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/contract-intake.mjs';

/**
 * The intake job cannot import TypeScript, so the rules exist twice. Two copies
 * of a rule is how a screen and its job quietly stop agreeing — here it would
 * mean the timer filing a document the screen would have refused, or the
 * reverse. This fails if the generated copy is stale.
 */
const CASES: AttachmentInput[] = [
  { fileName: 'Markito - Agreement v2.pdf', mimeType: 'application/pdf', sizeBytes: 240_000, context: 'signed agreement attached' },
  { fileName: 'scan_0012.pdf', mimeType: 'application/pdf', sizeBytes: 90_000, context: 'Here is the NDA for signature.' },
  { fileName: 'הסכם שיתוף פעולה.pdf', mimeType: 'application/pdf', sizeBytes: 120_000, context: 'לחתימה' },
  { fileName: 'Invoice 4821.pdf', mimeType: 'application/pdf', sizeBytes: 60_000, context: 'Payment due' },
  { fileName: 'numbers.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 20_000, context: 'monthly figures' },
  { fileName: 'signature.png', mimeType: 'image/png', sizeBytes: 4_000, context: 'here' },
  { fileName: 'doc1.pdf', mimeType: null, sizeBytes: 200_000, context: 'see attached' },
];

describe('the contracts screen and the intake job read attachments the same way', () => {
  it.each(CASES.map((c, i) => [i, c] as const))('agrees on case %i', (_i, input) => {
    expect(js.looksLikeContract(input)).toEqual(looksLikeContract(input));
  });

  it.each([
    ['Markito Agreement v3.pdf', 0],
    ['agreement.pdf', 2],
    ['agreement v1.pdf', 3],
  ])('agrees on the version in %s', (name, existing) => {
    expect(js.versionFromName(name, existing)).toBe(versionFromName(name, existing));
  });

  it.each([
    [{ email: 'ravit@markito.co.il', displayName: 'Ravit' }],
    [{ email: 'ravit@gmail.com', displayName: 'Ravit Cohen' }],
    [{ email: null, displayName: null }],
  ])('agrees on the counterparty for %o', (opts) => {
    expect(js.counterpartyFrom(opts)).toBe(counterpartyFrom(opts));
  });
});
