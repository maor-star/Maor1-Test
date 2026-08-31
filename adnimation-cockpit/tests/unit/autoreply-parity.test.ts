import { describe, expect, it } from 'vitest';
import { triage, type ReplyCandidate } from '@/lib/agents/autoreply';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/autoreply-rules.mjs';

/**
 * The screen and the job must refuse exactly the same mail.
 *
 * This is the gate that decides whether words go out in his name, so a
 * disagreement between the two copies is the most expensive one in the system:
 * the timer would answer something the rules here would have left alone.
 */
const CASES: ReplyCandidate[] = [
  {
    subject: 'Thanks!', snippet: 'Thank you, received.',
    fromEmail: 'a@b.com', fromName: 'A',
    messages: [{ fromMe: false, text: 'Thank you, received.' }], knownCompany: null,
  },
  {
    subject: 'Pricing', snippet: 'Can you do a discount?',
    fromEmail: 'a@b.com', fromName: 'A',
    messages: [{ fromMe: false, text: 'discount?' }], knownCompany: 'Markito',
  },
  {
    subject: 'Re: the MSA', snippet: 'Please confirm clause 4',
    fromEmail: 'a@b.com', fromName: 'A',
    messages: [{ fromMe: false, text: 'confirm?' }], knownCompany: null,
  },
  {
    subject: 'Meeting time', snippet: 'Does Tuesday at 10 work?',
    fromEmail: 'a@b.com', fromName: 'A',
    messages: [{ fromMe: false, text: 'Tuesday?' }], knownCompany: null,
  },
  {
    subject: 'תודה', snippet: 'תודה רבה, קיבלתי',
    fromEmail: 'a@b.co.il', fromName: 'A',
    messages: [{ fromMe: false, text: 'תודה' }], knownCompany: null,
  },
  {
    subject: 'Thanks', snippet: 'thanks',
    fromEmail: 'a@b.com', fromName: 'A',
    messages: [
      { fromMe: false, text: 'a' }, { fromMe: true, text: 'b' },
      { fromMe: false, text: 'c' }, { fromMe: true, text: 'd' },
      { fromMe: false, text: 'e' },
    ],
    knownCompany: null,
  },
  {
    subject: 'Thanks', snippet: 'thanks',
    fromEmail: 'a@b.com', fromName: 'A',
    messages: [{ fromMe: true, text: 'my last word' }], knownCompany: null,
  },
];

describe('the screen and the answering job refuse the same mail', () => {
  it.each(CASES.map((c, i) => [i, c] as const))('agrees on case %i', (_i, candidate) => {
    expect(js.triage(candidate)).toEqual(triage(candidate));
  });

  it('agrees that nothing unrecognised is answerable', () => {
    const odd = {
      subject: 'A thought', snippet: 'I had an idea about the roadmap',
      fromEmail: 'a@b.com', fromName: 'A',
      messages: [{ fromMe: false, text: 'idea' }], knownCompany: null,
    };
    expect(js.triage(odd).answerable).toBe(false);
    expect(triage(odd).answerable).toBe(false);
  });
});
