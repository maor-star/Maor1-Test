import { describe, expect, it } from 'vitest';
import {
  decide, freeWindows, mayAnswer, maySend, pickSlots, proposalText, sameOffer, slotLine, wantsMeeting,
  type MeetingCandidate, type Slot,
} from '@/lib/meetings/rules';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/meeting-rules.mjs';

/**
 * The screen and the job must agree about whom he writes to.
 *
 * The app shows what the agent would do; the job on the box is what actually
 * sends. A disagreement here means a reply going to someone the screen said it
 * would leave alone — so every gate is fed the same cases through both halves.
 */
const CASES: MeetingCandidate[] = [
  {
    subject: 'Quick call this week?', snippet: '', fromEmail: 'ravit@markito.com', fromName: 'Ravit',
    messages: [{ fromMe: false, text: 'Can we find a time to talk?' }],
    knownContact: true, knownCompany: 'Markito', internal: false,
  },
  {
    subject: 'Intro', snippet: '', fromEmail: 'sdr@vendor.com', fromName: 'SDR',
    messages: [{ fromMe: false, text: 'I am reaching out — we help publishers grow your revenue. Worth a quick chat?' }],
    knownContact: false, knownCompany: null, internal: false,
  },
  {
    subject: 'Invitation: Sync', snippet: '', fromEmail: 'calendar-notification@google.com', fromName: null,
    messages: [{ fromMe: false, text: 'Calendar invite attached. Do not reply to this.' }],
    knownContact: false, knownCompany: null, internal: false,
  },
  {
    subject: 'פגישה', snippet: '', fromEmail: 'dana@adnimation.com', fromName: 'דנה',
    messages: [{ fromMe: false, text: 'אפשר לקבוע פגישה מחר?' }],
    knownContact: false, knownCompany: null, internal: true,
  },
];

const NOW = new Date('2026-09-09T07:00:00Z');
const BUSY: Slot[] = [{ start: '2026-09-10T07:30:00Z', end: '2026-09-10T09:00:00Z' }];

describe('the screen and the meetings job agree', () => {
  it.each(CASES.map((c, i) => [i, c] as const))('agrees whether case %i is asking to meet', (_i, c) => {
    expect(js.wantsMeeting(c)).toEqual(wantsMeeting(c));
  });

  it.each(CASES.map((c, i) => [i, c] as const))('agrees whether case %i may be answered', (_i, c) => {
    expect(js.mayAnswer(c)).toEqual(mayAnswer(c));
  });

  it('agrees about when he is free', () => {
    expect(js.freeWindows(BUSY, { now: NOW, horizonDays: 6 })).toEqual(
      freeWindows(BUSY, { now: NOW, horizonDays: 6 }),
    );
  });

  it('agrees about which times to offer', () => {
    const free = freeWindows(BUSY, { now: NOW, horizonDays: 6 });
    expect(js.pickSlots(free, { now: NOW })).toEqual(pickSlots(free, { now: NOW }));
  });

  it('agrees about what to write', () => {
    const slots = pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW });
    const input = { toName: 'Ravit', slots, calendlyUrl: 'https://calendly.com/maor/30min' };
    expect(js.proposalText(input)).toEqual(proposalText(input));
  });

  it.each([
    ['high', 'can we talk Tuesday?'],
    ['high', 'could we do this evening?'],
    ['medium', 'next week?'],
    ['low', 'ok'],
  ])('agrees on send/ask/leave at %s confidence', (confidence, theyAsked) => {
    const input = {
      read: { wants: true, why: 'they asked to meet' },
      allowed: { ok: true, why: 'someone you deal with' },
      slots: pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW }),
      confidence, calendly: true, theyAsked,
    };
    expect(js.decide(input)).toEqual(decide(input));
  });

  it('agrees about what a rewrite in his voice may change', () => {
    const slots = pickSlots(freeWindows([], { now: NOW, horizonDays: 6 }), { now: NOW });
    const link = 'https://calendly.com/maor/30min';
    const offer = { slots, calendlyUrl: link };
    const lines = slots.map((s) => slotLine(s));
    const good = `Hi,\n\n${lines.map((l) => `· ${l}`).join('\n')}\n\n${link}\n\nBest,\nMaor`;
    for (const text of [good, good.replace(link, ''), `${good}\n\nor 21:45?`, '']) {
      expect(js.sameOffer(text, offer)).toEqual(sameOffer(text, offer));
    }
  });

  it('agrees at the last gate', () => {
    const read = { wants: true, why: 'they asked to meet' };
    const allowed = { ok: true, why: 'someone you deal with' };
    const reply = 'Hi Ravit,\n\nAny of these work:\n· Monday\n\nBest,\nMaor';
    for (const has of [{ slots: 3, calendly: false }, { slots: 0, calendly: false }, { slots: 0, calendly: true }]) {
      expect(js.maySend(read, allowed, reply, has)).toEqual(maySend(read, allowed, reply, has));
    }
  });
});
