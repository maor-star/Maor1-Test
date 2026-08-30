import { describe, expect, it } from 'vitest';
import { detectOpportunity, type DetectionInput } from '@/lib/opportunities/detect';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import { detectOpportunity as detectJs } from '@/deploy/opportunity-detect.mjs';

/**
 * The sweep job cannot import TypeScript, so the detection rules exist twice:
 * once in lib/opportunities/detect.ts and once generated into
 * deploy/opportunity-detect.mjs. Two copies of a rule is exactly how a screen
 * and its job quietly stop agreeing — the screen proposes something the timer
 * never would, and nobody finds out.
 *
 * This is the check that makes that impossible: if the generated copy is stale,
 * the suite fails and says to run `node deploy/build-detect.mjs`.
 */
const CASES: DetectionInput[] = [
  {
    subject: 'Partnership opportunity — our inventory',
    snippet: 'We would like to discuss working together on your demand. Happy to jump on a call.',
    counterpartEmail: 'ravit@markito.com', counterpartName: 'Ravit', knownContact: true,
    knownCompany: 'Markito', lastFromMe: false,
  },
  {
    subject: 'הצעה עסקית',
    snippet: 'שלום מאור, אנחנו מעוניינים בשיתוף פעולה. אפשר לקבוע פגישה?',
    counterpartEmail: 'dana@vidazoo.com', counterpartName: 'Dana', knownContact: true,
    knownCompany: 'Vidazoo', lastFromMe: false,
  },
  {
    subject: 'Our monthly newsletter', snippet: 'Read the blog post. Unsubscribe here.',
    counterpartEmail: 'news@vendor.com', counterpartName: null, knownContact: false,
    knownCompany: null, lastFromMe: false,
  },
  {
    subject: 'Invoice #4821', snippet: 'Payment due for your account.',
    counterpartEmail: 'billing@vendor.com', counterpartName: null, knownContact: true,
    knownCompany: 'Vendor', lastFromMe: false,
  },
  {
    subject: 'Re: yesterday', snippet: 'Thanks, got it.',
    counterpartEmail: 'ravit@markito.com', counterpartName: 'Ravit', knownContact: true,
    knownCompany: 'Markito', lastFromMe: false,
  },
  {
    subject: 'Advertiser budget for Q4',
    snippet: 'We would like to discuss campaign spend with your DSP. Interested in your inventory.',
    counterpartEmail: 'buyer@dsp.com', counterpartName: 'Buyer', knownContact: false,
    knownCompany: null, lastFromMe: false,
  },
  {
    subject: 'Partnership opportunity', snippet: 'We would like to work together, budget ready.',
    counterpartEmail: 'ravit@markito.com', counterpartName: 'Ravit', knownContact: true,
    knownCompany: 'Markito', lastFromMe: true,
  },
  {
    subject: null, snippet: null, counterpartEmail: null, counterpartName: null,
    knownContact: false, knownCompany: null, lastFromMe: false,
  },
];

describe('the screen and the sweep job read mail the same way', () => {
  it.each(CASES.map((c, i) => [i, c] as const))(
    'agrees on case %i',
    (_i, input) => {
      expect(detectJs(input)).toEqual(detectOpportunity(input));
    },
  );
});
