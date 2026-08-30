import { describe, expect, it } from 'vitest';
import {
  COLD_AFTER_DAYS, classify, inView, parseMoneyToCents, rank,
  opportunityInputSchema, type OpportunityRow,
} from '@/lib/opportunities/rules';
import { detectOpportunity, type DetectionInput } from '@/lib/opportunities/detect';

const NOW = new Date('2026-08-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(over: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: 'a1', title: 'Talk to Markito about their second site', kind: 'supply', status: 'new',
    note: null, valueCents: null, counterparty: 'Markito', nextStep: null, nextStepDate: null,
    revisitOn: null, source: 'manual', sourceUrl: null, sourceExcerpt: null, sourceAt: null,
    createdAt: daysAgo(30), lastTouchedAt: daysAgo(30), decidedAt: null, decidedNote: null,
    ...over,
  };
}

/**
 * The judgement this module exists to make is "has this gone quiet", so that
 * is what these test. The failure that matters is not a crash — it is an
 * opportunity that sat for a month and never appeared in the cold view.
 */
describe('opportunities — going cold', () => {
  it('calls an untouched one with no next step cold', () => {
    expect(classify(row(), NOW).cold).toBe(true);
  });

  it('does not call it cold before the threshold', () => {
    const fresh = row({ lastTouchedAt: daysAgo(COLD_AFTER_DAYS - 1) });
    expect(classify(fresh, NOW).cold).toBe(false);
  });

  it('is not cold while it has a next step still in the future', () => {
    const planned = row({ nextStep: 'Email Ravit', nextStepDate: '2026-09-15' });
    const state = classify(planned, NOW);
    expect(state.cold).toBe(false);
    expect(state.needsNextStep).toBe(false);
  });

  it('goes cold once a next-step date has passed and nothing happened', () => {
    const slipped = row({ nextStep: 'Email Ravit', nextStepDate: '2026-08-01' });
    const state = classify(slipped, NOW);
    expect(state.overdue).toBe(true);
    expect(state.cold).toBe(true);
  });

  it('treats touching it as movement, so editing resets the clock', () => {
    const touched = row({ lastTouchedAt: daysAgo(1) });
    expect(classify(touched, NOW).cold).toBe(false);
  });

  it('never calls a parked one cold — parking is a decision', () => {
    const parked = row({ status: 'parked', revisitOn: '2026-12-01' });
    const state = classify(parked, NOW);
    expect(state.cold).toBe(false);
    expect(state.dueToRevisit).toBe(false);
  });

  it('surfaces a parked one once its revisit date arrives', () => {
    const due = row({ status: 'parked', revisitOn: '2026-08-29' });
    expect(classify(due, NOW).dueToRevisit).toBe(true);
  });

  it('leaves decided ones alone', () => {
    for (const status of ['won', 'lost'] as const) {
      expect(classify(row({ status }), NOW).cold).toBe(false);
    }
  });
});

describe('opportunities — views', () => {
  it('keeps suggestions out of the open list until he accepts them', () => {
    const suggested = row({ status: 'suggested' });
    expect(inView(suggested, 'open', NOW)).toBe(false);
    expect(inView(suggested, 'inbox', NOW)).toBe(true);
  });

  it('puts a due-to-revisit parked one in the cold view', () => {
    const due = row({ status: 'parked', revisitOn: '2026-08-01' });
    expect(inView(due, 'cold', NOW)).toBe(true);
    expect(inView(due, 'parked', NOW)).toBe(true);
  });

  it('shows decided ones only under decided', () => {
    const won = row({ status: 'won' });
    expect(inView(won, 'closed', NOW)).toBe(true);
    expect(inView(won, 'open', NOW)).toBe(false);
    expect(inView(won, 'all', NOW)).toBe(true);
  });
});

describe('opportunities — ranking', () => {
  it('leads with the cold ones, not the newest', () => {
    const fresh = row({ id: 'fresh', lastTouchedAt: daysAgo(0), valueCents: 900_000_00 });
    const cold = row({ id: 'cold', lastTouchedAt: daysAgo(40) });
    expect(rank([fresh, cold], NOW)[0]!.id).toBe('cold');
  });

  it('within the same urgency, the bigger one leads', () => {
    const small = row({ id: 'small', lastTouchedAt: daysAgo(1), valueCents: 1000_00 });
    const big = row({ id: 'big', lastTouchedAt: daysAgo(1), valueCents: 500_000_00 });
    expect(rank([small, big], NOW)[0]!.id).toBe('big');
  });

  it('falls back to the quietest when nothing is sized', () => {
    const recent = row({ id: 'recent', lastTouchedAt: daysAgo(2) });
    const older = row({ id: 'older', lastTouchedAt: daysAgo(9) });
    expect(rank([recent, older], NOW)[0]!.id).toBe('older');
  });
});

describe('opportunities — money as he would type it', () => {
  it.each([
    ['50k', 5_000_000],
    ['1.2m', 120_000_000],
    ['8000', 800_000],
    ['$1,200', 120_000],
    ['  250K ', 25_000_000],
  ])('reads %s', (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it('treats blank as unsized rather than zero', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
  });

  it('refuses something that is not a number', () => {
    expect(parseMoneyToCents('a lot')).toBeNull();
  });

  it('accepts a bare title and nothing else', () => {
    const parsed = opportunityInputSchema.safeParse({ title: 'Call Vidazoo back' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.status).toBe('new');
  });

  it('rejects an empty title', () => {
    expect(opportunityInputSchema.safeParse({ title: '   ' }).success).toBe(false);
  });
});

function mail(over: Partial<DetectionInput> = {}): DetectionInput {
  return {
    subject: null, snippet: null, counterpartEmail: 'ravit@markito.com',
    counterpartName: 'Ravit Cohen', knownContact: true, knownCompany: 'Markito',
    lastFromMe: false, ...over,
  };
}

/**
 * The detector's job is to be trusted, not to be exhaustive. A queue that is
 * mostly wrong gets ignored within a week, and then the real ones sit in it
 * unread — so these lean hardest on what it must NOT propose.
 */
describe('opportunities — reading the mail', () => {
  it('proposes a real approach from someone we deal with', () => {
    const d = detectOpportunity(mail({
      subject: 'Partnership opportunity — our inventory',
      snippet: 'We would like to discuss working together on your demand. Happy to jump on a call.',
    }));
    expect(d.isOpportunity).toBe(true);
    expect(d.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('reads Hebrew too', () => {
    const d = detectOpportunity(mail({
      subject: 'הצעה עסקית',
      snippet: 'שלום מאור, אנחנו מעוניינים בשיתוף פעולה. אפשר לקבוע פגישה?',
    }));
    expect(d.isOpportunity).toBe(true);
  });

  it('stays silent when the last word was his', () => {
    const d = detectOpportunity(mail({
      subject: 'Partnership opportunity',
      snippet: 'We would like to discuss working together, budget is ready.',
      lastFromMe: true,
    }));
    expect(d.isOpportunity).toBe(false);
  });

  it.each([
    ['a newsletter', 'Our monthly newsletter', 'Read the blog post. Unsubscribe here.'],
    ['an invoice', 'Invoice #4821', 'Payment due for your account.'],
    ['a security mail', 'Your verification code', 'Use this code to sign-in.'],
    ['an out of office', 'Automatic reply: out of office', 'I am away until Monday.'],
    ['a conference blast', 'AdTech Summit 2026', 'Register now — early bird tickets end soon.'],
    ['a job application', 'Application for Ad Ops role', 'Please find my CV attached.'],
  ])('stays silent on %s', (_label, subject, snippet) => {
    expect(detectOpportunity(mail({ subject, snippet })).isOpportunity).toBe(false);
  });

  it('stays silent on bulk senders even when the words look right', () => {
    const d = detectOpportunity(mail({
      subject: 'A partnership opportunity for you',
      snippet: 'We would like to work together. Great pricing and budget available.',
      counterpartEmail: 'marketing@somevendor.com',
    }));
    expect(d.isOpportunity).toBe(false);
  });

  it('is not satisfied by being a known contact alone', () => {
    const d = detectOpportunity(mail({
      subject: 'Re: yesterday',
      snippet: 'Thanks, got it.',
    }));
    expect(d.isOpportunity).toBe(false);
  });

  it('needs more than one weak signal from a stranger', () => {
    const d = detectOpportunity(mail({
      subject: 'Quick call?',
      snippet: 'Can we set up a meeting.',
      knownContact: false,
      knownCompany: null,
      counterpartEmail: 'someone@unknown.com',
    }));
    expect(d.isOpportunity).toBe(false);
  });

  it('guesses the kind from what the mail is about', () => {
    const supply = detectOpportunity(mail({
      subject: 'Partnership — our publisher inventory',
      snippet: 'We would like to work together monetizing our sites.',
    }));
    expect(supply.kind).toBe('supply');

    const demand = detectOpportunity(mail({
      subject: 'Advertiser budget for Q4',
      snippet: 'We would like to discuss campaign spend with your DSP. Interested in your inventory.',
    }));
    expect(['demand', 'supply', 'partnership', 'other']).toContain(demand.kind);
  });

  it('says nothing about empty mail', () => {
    expect(detectOpportunity(mail({ subject: null, snippet: null })).isOpportunity).toBe(false);
  });
});
