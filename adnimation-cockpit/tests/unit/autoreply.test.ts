import { describe, expect, it } from 'vitest';
import { maySend, triage, type Draft, type ReplyCandidate, mayFile} from '@/lib/agents/autoreply';

/**
 * The one agent that puts words in his mouth to people outside the company.
 *
 * So these are almost entirely about refusal. A reply he would not have sent
 * is not a small error — it commits him, in writing, to someone who will hold
 * him to it — and declining costs him one email to write himself. The two are
 * not comparable, and the tests are weighted the same way.
 */
function mail(over: Partial<ReplyCandidate> = {}): ReplyCandidate {
  return {
    subject: 'Thanks!',
    snippet: 'Thank you, received. Much appreciated.',
    fromEmail: 'ravit@markito.com',
    fromName: 'Ravit',
    messages: [{ fromMe: false, text: 'Thank you, received. Much appreciated.' }],
    knownCompany: 'Markito',
    ...over,
  };
}

describe('auto-reply — what it will never answer', () => {
  it.each([
    ['a contract', 'Re: the MSA', 'Please confirm you agree to clause 4'],
    ['pricing', 'Our rates', 'Can you do 15% rev share?'],
    ['an invoice', 'Invoice 88', 'When will this be paid?'],
    ['anything legal', 'Legal review', 'Our counsel has questions'],
    ['hiring', 'Candidate for ad ops', 'What salary can you offer?'],
    ['a complaint', 'Escalation', 'This is unacceptable and urgent'],
    ['an acquisition', 'Term sheet', 'Our valuation assumptions'],
    ['GDPR', 'DPA request', 'Please sign the attached DPA'],
    ['a commitment', 'Exclusivity', 'Can you guarantee an SLA?'],
    ['Hebrew about money', 'לגבי המחיר', 'אפשר הנחה?'],
    ['Hebrew about contracts', 'החוזה', 'תאשר בבקשה'],
  ])('refuses %s', (_label, subject, text) => {
    const result = triage(mail({ subject, snippet: text, messages: [{ fromMe: false, text }] }));
    expect(result.answerable).toBe(false);
  });

  it('refuses a long conversation — that is a negotiation, not a question', () => {
    const messages = Array.from({ length: 6 }, (_, i) => ({
      fromMe: i % 2 === 1,
      text: 'thanks',
    }));
    expect(triage(mail({ messages })).answerable).toBe(false);
  });

  it('refuses when the last word is already his', () => {
    expect(
      triage(mail({ messages: [{ fromMe: false, text: 'thanks' }, { fromMe: true, text: 'no problem' }] }))
        .answerable,
    ).toBe(false);
  });

  it('refuses a long message, however friendly', () => {
    const text = `Thanks so much! ${'x'.repeat(1600)}`;
    expect(triage(mail({ messages: [{ fromMe: false, text }] })).answerable).toBe(false);
  });

  it('refuses anything it does not positively recognise as simple', () => {
    // The default is silence. Not matching a "never" rule is not permission.
    expect(
      triage(mail({ subject: 'Some thoughts', snippet: 'I had an idea about the roadmap' }))
        .answerable,
    ).toBe(false);
  });

  it('refuses empty mail', () => {
    expect(triage(mail({ subject: null, snippet: null })).answerable).toBe(false);
  });
});

describe('auto-reply — what it will consider', () => {
  it.each([
    ['a thank-you', 'Thanks!', 'Thank you, received.'],
    ['scheduling', 'Meeting time', 'Does Tuesday at 10 work for you?'],
    ['a request for a link', 'Deck', 'Could you send the deck?'],
    ['who to talk to', 'Contact', 'Who should I contact about integrations?'],
    ['Hebrew thanks', 'תודה', 'תודה רבה, קיבלתי'],
  ])('considers %s', (_label, subject, text) => {
    const result = triage(mail({ subject, snippet: text, messages: [{ fromMe: false, text }] }));
    expect(result.answerable).toBe(true);
  });
});

const draft = (over: Partial<Draft> = {}): Draft => ({
  shouldReply: true,
  reasoning: 'a simple thank-you',
  reply: 'Thanks Ravit — noted. Speak soon.\n\nMaor',
  confidence: 'high',
  ...over,
});

describe('auto-reply — the final gate', () => {
  const answerable = triage(mail());

  it('sends only when both gates agree', () => {
    expect(maySend(answerable, draft()).send).toBe(true);
  });

  it('never sends what the rules refused, however sure the model is', () => {
    const refused = triage(mail({ subject: 'Pricing', snippet: 'discount?' }));
    expect(maySend(refused, draft()).send).toBe(false);
  });

  it('never sends what the model refused, however simple the rules found it', () => {
    expect(maySend(answerable, draft({ shouldReply: false, reasoning: 'needs a fact I lack' })).send)
      .toBe(false);
  });

  it.each(['medium', 'low'] as const)('refuses %s confidence', (confidence) => {
    // Anything short of sure is a mail he writes himself, which costs a minute.
    expect(maySend(answerable, draft({ confidence })).send).toBe(false);
  });

  it('refuses an empty or a rambling draft', () => {
    expect(maySend(answerable, draft({ reply: '   ' })).send).toBe(false);
    expect(maySend(answerable, draft({ reply: 'x'.repeat(1300) })).send).toBe(false);
  });

  it('always says why, whichever way it went', () => {
    expect(maySend(answerable, draft()).why.length).toBeGreaterThan(0);
    expect(maySend(answerable, draft({ shouldReply: false, reasoning: 'unsure' })).why).toBe('unsure');
  });
});

/**
 * The third outcome: shown to him, filed, not answered.
 *
 * This one moves mail out of his inbox without sending anything, so the cost
 * of being wrong is that he does not see something — which is why it is only
 * ever offered for mail the rules already cleared, and never for mail they
 * held back.
 */
describe('mail that is only worth showing him', () => {
  const facts = (over: Partial<ReplyCandidate> = {}): ReplyCandidate => ({
    subject: 'Monthly platform report',
    snippet: 'Your September numbers are attached.',
    fromEmail: 'reports@vendor.com',
    fromName: 'Vendor',
    messages: [{ fromMe: false, text: 'Your September numbers are attached.' }],
    knownCompany: null,
    ...over,
  });

  it('offers to file information that is not a simple question', () => {
    const t = triage(facts());
    expect(t.answerable).toBe(false);
    expect(mayFile(t).consider).toBe(true);
  });

  it('files nothing the rules held back — the NEVER list is not a soft rule', () => {
    for (const subject of ['Invoice 4471', 'The MSA', 'Salary review', 'Urgent complaint']) {
      const t = triage(facts({ subject, snippet: subject }));
      expect(mayFile(t).consider, subject).toBe(false);
    }
  });

  it('does not file a conversation with history, or one where he spoke last', () => {
    const longThread = triage(
      facts({
        messages: Array.from({ length: 6 }, () => ({ fromMe: false, text: 'more' })),
      }),
    );
    expect(mayFile(longThread).consider).toBe(false);

    const hisWord = triage(facts({ messages: [{ fromMe: true, text: 'ok' }] }));
    expect(mayFile(hisWord).consider).toBe(false);
  });

  it('does not file something it is already answering', () => {
    const answerable = triage(
      facts({ subject: 'Thanks!', snippet: 'Thank you, received.' }),
    );
    expect(answerable.answerable).toBe(true);
    expect(mayFile(answerable).consider).toBe(false);
  });

  it('always says why not', () => {
    expect(mayFile(triage(facts({ subject: 'Invoice', snippet: 'invoice' }))).why.length)
      .toBeGreaterThan(0);
  });
});

describe('the mail answerer signs as him too', () => {
  const triaged = triage({
    subject: 'Quick one',
    snippet: 'Can you point me at the right person?',
    fromEmail: 'ravit@markito.com',
    fromName: 'Ravit',
    messages: [{ fromMe: false, text: 'Can you point me at the right person?' }],
    knownCompany: 'Markito',
  });

  const draft = (reply: string) => ({
    shouldReply: true,
    reasoning: 'simple',
    reply,
    confidence: 'high' as const,
  });

  it('sends one that is signed', () => {
    expect(maySend(triaged, draft('Sure — talk to Mor.\n\nBest,\nMaor')).send).toBe(true);
  });

  it('holds one that is not', () => {
    const verdict = maySend(triaged, draft('Sure — talk to our chief of staff.\n\nThanks'));
    expect(verdict.send).toBe(false);
    expect(verdict.why).toContain('name');
  });
});
