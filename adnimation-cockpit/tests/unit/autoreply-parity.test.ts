import { describe, expect, it } from 'vitest';
import { mayFile, triage, type ReplyCandidate, maySend} from '@/lib/agents/autoreply';
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

describe('autoreply parity — what may be filed without a reply', () => {
  it('agrees, case for case, about what may be taken out of the inbox', () => {
    for (const c of CASES) {
      const ts = mayFile(triage(c));
      const mjs = js.mayFile(js.triage(c));
      expect(mjs.consider, c.subject ?? '').toBe(ts.consider);
      expect(mjs.why, c.subject ?? '').toBe(ts.why);
    }
  });
});


describe('the send gate, on both sides', () => {
  const triaged = { answerable: true, reason: 'a simple question', matched: [] as string[] };
  const draft = { shouldReply: true, confidence: 'high' as const, reply: 'Yes, Tuesday works.', reasoning: 'plain scheduling' };

  /*
   * This gate decides whether mail actually leaves the building. It used to
   * exist twice — once here in TypeScript, once hand-copied into
   * mail-answer.mjs — and the two agreed only because nobody had changed
   * either yet. The job now imports the generated copy; this proves the two
   * still answer the same on the cases that matter.
   */
  const CASES: [string, unknown, unknown][] = [
    ['a confident simple answer', triaged, draft],
    ['a draft that declined to reply', triaged, { ...draft, shouldReply: false }],
    ['medium confidence', triaged, { ...draft, confidence: 'medium' }],
    ['low confidence', triaged, { ...draft, confidence: 'low' }],
    ['an empty draft', triaged, { ...draft, reply: '   ' }],
    ['a draft that is too long', triaged, { ...draft, reply: 'x'.repeat(1201) }],
    ['a thread triage refused', { answerable: false, reason: 'it is about money', matched: ['about money'] }, draft],
  ];

  it.each(CASES)('agrees about %s', (_label, t, d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = maySend(t as any, d as any);
    const theirs = js.maySend(t, d);
    expect(theirs.send, 'the two gates disagree about whether to send').toBe(mine.send);
  });
});
