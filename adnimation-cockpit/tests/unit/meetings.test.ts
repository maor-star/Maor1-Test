import { describe, expect, it } from 'vitest';
import {
  asksForEvening, clockTime, decide, freeWindows, mayAnswer, maySend,
  pickSlots, proposalText, settled, slotLine, wantsMeeting,
  type MeetingCandidate, type Slot,
} from '@/lib/meetings/rules';
import { FakeCalendar } from '@/lib/integrations/calendar';

/**
 * The meetings agent, tested where it can do harm.
 *
 * It writes to people outside the company in his name and puts things in his
 * week, so the tests that matter are the ones about refusing: a stranger, a
 * machine, a pitch with a meeting attached. Every one of those must end in
 * silence — not a reply, and not a question in Slack either, which is the line
 * he drew himself.
 */

const base: MeetingCandidate = {
  subject: 'Quick call this week?',
  snippet: '',
  fromEmail: 'ravit@markito.com',
  fromName: 'Ravit Cohen',
  messages: [{ fromMe: false, text: 'Can we find a time this week to talk about the placements?' }],
  knownContact: true,
  knownCompany: 'Markito',
  internal: false,
};

describe('who is asking to meet', () => {
  it('reads a plain request as one', () => {
    expect(wantsMeeting(base).wants).toBe(true);
  });

  it('reads the Hebrew for it', () => {
    const he = { ...base, subject: 'פגישה', messages: [{ fromMe: false, text: 'אפשר לקבוע פגישה השבוע?' }] };
    expect(wantsMeeting(he).wants).toBe(true);
  });

  it('does not mistake a calendar notice for a request', () => {
    const invite = { ...base, subject: 'Invitation: Sync @ Mon 3pm', messages: [{ fromMe: false, text: 'Calendar invite attached' }] };
    expect(wantsMeeting(invite).wants).toBe(false);
  });

  it('does not mistake a webinar for a request', () => {
    const webinar = { ...base, subject: 'Save the date: our summit', messages: [{ fromMe: false, text: 'Register for the webinar and book a demo' }] };
    expect(wantsMeeting(webinar).wants).toBe(false);
  });
});

describe('who may be answered at all', () => {
  it('answers someone he deals with', () => {
    expect(mayAnswer(base).ok).toBe(true);
  });

  it('answers someone inside the company even with no history', () => {
    const colleague = { ...base, fromEmail: 'dana@adnimation.com', internal: true, knownContact: false, knownCompany: null };
    expect(mayAnswer(colleague).ok).toBe(true);
  });

  it('never answers a stranger, however polite', () => {
    const stranger = { ...base, fromEmail: 'someone@newco.io', knownContact: false, knownCompany: null };
    expect(mayAnswer(stranger)).toEqual({ ok: false, why: 'not someone you are in contact with' });
  });

  it('never answers a cold pitch', () => {
    const pitch: MeetingCandidate = {
      ...base, fromEmail: 'sdr@vendor.com', knownContact: false, knownCompany: null,
      messages: [{ fromMe: false, text: 'I am reaching out — we help publishers increase your revenue. Worth a quick chat?' }],
    };
    expect(mayAnswer(pitch).ok).toBe(false);
  });

  it('never answers a machine', () => {
    const machine = { ...base, messages: [{ fromMe: false, text: 'This is an automated message. Do not reply to this. Unsubscribe here.' }] };
    expect(mayAnswer(machine)).toEqual({ ok: false, why: 'sent by a machine' });
  });

  it('leaves a thread where the last word is already his', () => {
    const answered = { ...base, messages: [...base.messages, { fromMe: true, text: 'Sure, how about Tuesday?' }] };
    expect(mayAnswer(answered).ok).toBe(false);
  });

  it('leaves a long negotiation alone', () => {
    const long = { ...base, messages: Array.from({ length: 7 }, (_, i) => ({ fromMe: i % 2 === 1, text: 'more' })) };
    expect(mayAnswer(long).ok).toBe(false);
  });
});

/** Wednesday 2026-09-09, 07:00 UTC — 10:00 in Israel. */
const NOW = new Date('2026-09-09T07:00:00Z');

describe('the times it offers', () => {
  it('starts at half past ten, because that is when he starts', () => {
    const free = freeWindows([], { now: NOW, horizonDays: 1 });
    const first = free[0]!;
    expect(slotLine(first)).toContain('10:30');
  });

  it('never offers a time inside something already in the diary', () => {
    const busy: Slot[] = [{ start: '2026-09-10T07:30:00Z', end: '2026-09-10T09:00:00Z' }];
    const free = freeWindows(busy, { now: NOW, horizonDays: 2 });
    const clash = free.some(
      (s) => Date.parse(s.start) < Date.parse(busy[0]!.end) && Date.parse(s.end) > Date.parse(busy[0]!.start),
    );
    expect(clash).toBe(false);
  });

  it('does not offer Friday or Saturday', () => {
    const free = freeWindows([], { now: NOW, horizonDays: 6 });
    const days = new Set(free.map((s) => new Date(s.start).getUTCDay()));
    expect(days.has(5)).toBe(false);
    expect(days.has(6)).toBe(false);
  });

  it('never ends a meeting after the working day', () => {
    const free = freeWindows([], { now: NOW, horizonDays: 2, minutes: 60, to: '18:00' });
    const clock = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(iso));
    expect(free.length).toBeGreaterThan(0);
    for (const slot of free) expect(clock(slot.end) <= '18:00').toBe(true);
  });

  it('spreads the three offers across different days', () => {
    const chosen = pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW });
    const days = new Set(chosen.map((s) => s.start.slice(0, 10)));
    expect(chosen).toHaveLength(3);
    expect(days.size).toBe(3);
  });

  it('offers nothing sooner than the lead time', () => {
    const chosen = pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW, minLeadHours: 18 });
    for (const slot of chosen) {
      expect(Date.parse(slot.start)).toBeGreaterThanOrEqual(NOW.getTime() + 18 * 3_600_000);
    }
  });

  it('reads a time he typed, and falls back rather than breaking', () => {
    expect(clockTime('10:30', '10:30')).toEqual({ hour: 10, minute: 30 });
    expect(clockTime('nonsense', '10:30')).toEqual({ hour: 10, minute: 30 });
    expect(clockTime('', '18:00')).toEqual({ hour: 18, minute: 0 });
  });
});

describe('send, ask, or leave alone', () => {
  const read = { wants: true, why: 'they asked to meet' };
  const allowed = { ok: true, why: 'someone you deal with' };
  const slots = pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW });

  it('answers a daytime request from someone he deals with', () => {
    const out = decide({ read, allowed, slots, confidence: 'high', calendly: true, theyAsked: 'can we talk Tuesday?' });
    expect(out.action).toBe('send');
  });

  it('asks him about an evening', () => {
    const out = decide({ read, allowed, slots, confidence: 'high', calendly: true, theyAsked: 'could we do this evening?' });
    expect(out.action).toBe('ask');
  });

  it('asks him about a weekend', () => {
    expect(asksForEvening('maybe over the weekend?')).toBe(true);
    const out = decide({ read, allowed, slots, confidence: 'high', calendly: true, theyAsked: 'maybe over the weekend?' });
    expect(out.action).toBe('ask');
  });

  it('asks him when it is not certain he wants it', () => {
    const out = decide({ read, allowed, slots, confidence: 'medium', calendly: true, theyAsked: 'a time next week?' });
    expect(out.action).toBe('ask');
  });

  it('asks him when the only free times are in the evening', () => {
    const evening: Slot[] = [{ start: '2026-09-14T16:00:00Z', end: '2026-09-14T16:30:00Z' }];
    const out = decide({ read, allowed, slots: evening, confidence: 'high', calendly: true, theyAsked: 'next week?' });
    expect(out.action).toBe('ask');
  });

  it('says nothing at all about a stranger — not even a question', () => {
    const out = decide({
      read, allowed: { ok: false, why: 'not someone you are in contact with' },
      slots, confidence: 'high', calendly: true, theyAsked: 'quick intro call?',
    });
    expect(out.action).toBe('leave');
  });

  it('says nothing when it is not confident it is even a request', () => {
    const out = decide({ read, allowed, slots, confidence: 'low', calendly: true, theyAsked: 'ok' });
    expect(out.action).toBe('leave');
  });

  it('remembers a settled refusal and re-reads a temporary one', () => {
    expect(settled('sent by a machine')).toBe(true);
    expect(settled('the last word is already yours')).toBe(false);
  });
});

describe('what it actually writes', () => {
  const slots = pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW });

  it('offers the times and the link, and signs off as him', () => {
    const text = proposalText({ toName: 'Ravit Cohen', slots, calendlyUrl: 'https://calendly.com/maor/30min' });
    expect(text).toContain('Hi Ravit,');
    expect(text.split('·')).toHaveLength(4);
    expect(text).toContain('https://calendly.com/maor/30min');
    expect(text).toContain('Maor');
  });

  it('sends only the link when the diary cannot be read', () => {
    const text = proposalText({ toName: 'Ravit', slots: [], calendlyUrl: 'https://calendly.com/maor/30min' });
    expect(text).toContain('https://calendly.com/maor/30min');
    expect(text).not.toContain('·');
  });

  it('writes in Hebrew to someone who wrote in Hebrew', () => {
    const text = proposalText({ toName: 'רוית', slots, calendlyUrl: null, language: 'he' });
    expect(text).toContain('היי רוית,');
    expect(text).toContain('שעון ישראל');
  });

  it('never says what the meeting is about, because it does not know', () => {
    const text = proposalText({ toName: 'Ravit', slots, calendlyUrl: null });
    expect(text.toLowerCase()).not.toContain('about');
  });
});

describe('the last gate, which can only refuse', () => {
  const read = { wants: true, why: 'they asked to meet' };
  const allowed = { ok: true, why: 'someone you deal with' };
  const reply = proposalText({
    toName: 'Ravit',
    slots: pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW }),
    calendlyUrl: null,
  });

  it('lets a real proposal through', () => {
    expect(maySend(read, allowed, reply, { slots: 3, calendly: false }).ok).toBe(true);
  });

  it('refuses when there is nothing to offer', () => {
    expect(maySend(read, allowed, reply, { slots: 0, calendly: false }).ok).toBe(false);
  });

  it('refuses an empty reply', () => {
    expect(maySend(read, allowed, '', { slots: 3, calendly: false }).ok).toBe(false);
  });

  it('refuses anything that grew past a scheduling note', () => {
    expect(maySend(read, allowed, 'x'.repeat(1300), { slots: 3, calendly: false }).ok).toBe(false);
  });

  it('refuses whatever the earlier gates refused, whatever was written', () => {
    expect(maySend({ wants: false, why: 'nobody asked' }, allowed, reply, { slots: 3, calendly: false }).ok).toBe(false);
    expect(maySend(read, { ok: false, why: 'a machine' }, reply, { slots: 3, calendly: false }).ok).toBe(false);
  });
});

describe('the calendar, through its fake', () => {
  it('reports only the blocks inside the window asked for', async () => {
    const cal = new FakeCalendar([
      { start: '2026-09-10T07:00:00Z', end: '2026-09-10T08:00:00Z' },
      { start: '2026-10-10T07:00:00Z', end: '2026-10-10T08:00:00Z' },
    ]);
    const busy = await cal.busy(new Date('2026-09-09T00:00:00Z'), new Date('2026-09-12T00:00:00Z'));
    expect(busy).toHaveLength(1);
  });

  it('books what it is given and keeps the record', async () => {
    const cal = new FakeCalendar();
    const result = await cal.createEvent({
      summary: 'Ravit — placements',
      slot: { start: '2026-09-10T07:30:00Z', end: '2026-09-10T08:00:00Z' },
      attendees: ['ravit@markito.com'],
    });
    expect(result.ok).toBe(true);
    expect(cal.created[0]!.attendees).toEqual(['ravit@markito.com']);
  });
});
