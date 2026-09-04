/**
 * GENERATED FROM lib/meetings/rules.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/meetings-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
/**
 * Booking a meeting for him, and — the harder half — knowing whose meeting is
 * worth booking.
 *
 * This puts words in his mouth to people outside the company, so it is built
 * the way the auto-reply is: rules first, model second, and the model may only
 * ever narrow what the rules allowed. Three instructions of his are hard rules
 * here rather than sentences in a prompt, because a prompt is advice and this
 * is not:
 *
 *   · Only people he is already in contact with. A stranger asking for
 *     "15 minutes to show you something" is a sales call, and answering it
 *     with his diary is worse than silence.
 *   · Never anything automated. No-reply, newsletters, booking confirmations,
 *     anything sent by a machine — none of it gets a reply from a machine.
 *   · When in doubt, do nothing. Every gate below fails closed, and the
 *     reason is written down so he can see what it left alone and why.
 *
 * What it says is businesslike and short: who, how long, three times, one
 * link. No pleasantries it cannot mean.
 */

/** Where the answered threads are filed, under the same parent as the rest. */
export const MEETINGS_LABEL = process.env.MEETINGS_LABEL ?? 'Claude/Meetings';

/**
 * Whose name goes on the bottom of anything sent in his name.
 *
 * Not a nicety. Mail that goes out over his address without his name on it
 * reads as sent by a machine, which is exactly what it is — and the person
 * receiving it should not have to wonder. So it is a gate rather than a
 * template: a reply that has lost his name does not go.
 */
export const OWNER_NAME = process.env.OWNER_NAME ?? 'Maor Davidovich';

export function firstName(full = OWNER_NAME) {
  return (full ?? '').trim().split(/\s+/)[0] ?? '';
}

/** His name is in it, in either alphabet. */
export function signedByHim(text, name = OWNER_NAME) {
  const first = firstName(name).toLowerCase();
  if (first === '') return true;
  const body = (text ?? '').toLowerCase();
  // The Hebrew spelling of the same name, for a reply written in Hebrew.
  const hebrew = first === 'maor' ? 'מאור' : first;
  return body.includes(first) || (text ?? '').includes(hebrew);
}

/**
 * Asking to meet. Deliberately narrow: the cost of missing one is that he
 * books it himself, and the cost of a false positive is a reply nobody wanted.
 */
const WANTS = [
  /\b(set|schedule|arrange|book|fix|find|grab)\s+(up\s+)?(a\s+|some\s+)?(time|call|meeting|chat|slot|30 ?min|15 ?min)\b/i,
  /\b(are you|when are you|would you be)\s+(free|available)\b/i,
  /\b(does|would)\s+.{0,25}\s*(work for you|suit you)\b/i,
  /\b(your|my)\s+(calendar|availability|diary)\b/i,
  /\b(let'?s|lets|can we|shall we|happy to)\s+(talk|meet|speak|catch up|hop on|jump on|connect)\b/i,
  /\b(send|share)\s+(me\s+)?(your|a)\s+(calendly|booking|scheduling)\b/i,
  /\b(zoom|google meet|teams)\s+(call|meeting)\b/i,
  /(נקבע|לקבוע|לתאם|פגישה|שיחה קצרה|מתי נוח|מתי אתה פנוי|יומן)/,
];

/** Reads like scheduling but is not a request to him. */
const NOT_A_REQUEST = [
  /\b(invitation|invite|has been (scheduled|updated|cancell?ed)|calendar invite attached)\b/i,
  /\b(webinar|conference|summit|expo|meetup|networking event|save the date)\b/i,
  /\b(reschedul(ed|ing) below|declined your invitation|accepted your invitation)\b/i,
  /\b(book a demo|schedule a demo|free trial|special offer|limited time)\b/i,
];

/**
 * Whoever wrote this, a machine did.
 *
 * The address list is the CRM harvester's (NOT_A_PERSON there); this is the
 * shape of the message itself.
 */
const MACHINE_TEXT = [
  /\bunsubscribe\b/i,
  /\bthis (is an automated|email was sent automatically)\b/i,
  /\bdo not reply to this\b/i,
  /\bview (this|it) in your browser\b/i,
  /\byou are receiving this (email|message) because\b/i,
  /(להסרה מרשימת התפוצה|הודעה אוטומטית)/,
];

/** The cold-outreach shapes that most often ask for "15 minutes". */
const COLD_PITCH = [
  /\b(i('| a)m reaching out|reaching out to (you|see)|quick question for you)\b/i,
  /\b(we help|we work with|our (platform|solution|technology|tool)|i noticed (that )?you)\b/i,
  /\b(increase your|boost your|maximi[sz]e your|grow your) (revenue|traffic|yield|fill)\b/i,
  /\b(no obligation|worth a (quick )?chat|see if (it|there)('| i)s a fit)\b/i,
];

/** Is this someone asking to meet him? */
export function wantsMeeting(candidate) {
  const last = candidate.messages[candidate.messages.length - 1];
  const text = `${candidate.subject ?? ''}\n${last?.text ?? candidate.snippet ?? ''}`;
  if (text.trim() === '') return { wants: false, why: 'nothing to read' };

  for (const pattern of NOT_A_REQUEST) {
    if (pattern.test(text)) return { wants: false, why: 'an invitation or an event, not a request to meet' };
  }
  if (!WANTS.some((pattern) => pattern.test(text))) {
    return { wants: false, why: 'nobody asked to meet' };
  }
  return { wants: true, why: 'they asked to meet' };
}

/**
 * May this person be answered at all?
 *
 * Fails closed on every branch. `knownContact` is the cockpit's own record of
 * having corresponded before — not a guess from the address.
 */
export function mayAnswer(candidate) {
  const email = (candidate.fromEmail ?? '').trim().toLowerCase();
  if (!email.includes('@')) return { ok: false, why: 'no address to answer' };

  const last = candidate.messages[candidate.messages.length - 1];
  if (!last) return { ok: false, why: 'nothing in the thread' };
  if (last.fromMe) return { ok: false, why: 'the last word is already yours' };

  const body = `${candidate.subject ?? ''}\n${last.text}`;
  if (MACHINE_TEXT.some((p) => p.test(body))) return { ok: false, why: 'sent by a machine' };
  if (COLD_PITCH.some((p) => p.test(body)) && !candidate.knownContact) {
    return { ok: false, why: 'cold outreach from someone you do not deal with' };
  }

  /*
   * The rule he set, in one line: only people he is in contact with. Somebody
   * inside Adnimation counts; so does an address the cockpit has corresponded
   * with before, or a company the CRM already holds. Everyone else waits for
   * him, however polite the mail is.
   */
  if (!candidate.internal && !candidate.knownContact && !candidate.knownCompany) {
    return { ok: false, why: 'not someone you are in contact with' };
  }

  // A thread with history is a negotiation about something; the scheduling
  // line in it is rarely the whole of it.
  if (candidate.messages.length > 6) {
    return { ok: false, why: 'a long thread — too much history to answer blind' };
  }
  return { ok: true, why: candidate.internal ? 'inside the company' : 'someone you deal with' };
}

/**
 * The times to offer.
 *
 * Spread across days rather than three in one afternoon: offering a morning,
 * an afternoon and another day is what makes one of them land. Nothing sooner
 * than `minLeadHours`, because a slot two hours from now is not an offer.
 */
export function pickSlots(free, options = {}) {
  const count = options.count ?? 3;
  const now = options.now ?? new Date();
  const earliest = now.getTime() + (options.minLeadHours ?? 18) * 3_600_000;

  const usable = free
    .filter((s) => Date.parse(s.start) >= earliest)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const chosen = [];
  const days = new Set();
  for (const slot of usable) {
    const day = slot.start.slice(0, 10);
    if (days.has(day)) continue;
    chosen.push(slot);
    days.add(day);
    if (chosen.length === count) return chosen;
  }
  // Fewer distinct days than slots asked for: fill from what is left rather
  // than offer one time and call it a choice.
  for (const slot of usable) {
    if (chosen.some((c) => c.start === slot.start)) continue;
    chosen.push(slot);
    if (chosen.length === count) break;
  }
  return chosen;
}

/** "Monday 8 September, 16:00–16:45" — his timezone, written out. */
export function slotLine(slot, timeZone = 'Asia/Jerusalem') {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const parts = (d) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
  const get = (ps, type) => ps.find((p) => p.type === type)?.value ?? '';
  const s = parts(start);
  const e = parts(end);
  return `${get(s, 'weekday')} ${get(s, 'day')} ${get(s, 'month')}, ${get(s, 'hour')}:${get(s, 'minute')}–${get(e, 'hour')}:${get(e, 'minute')}`;
}

/**
 * The reply itself: businesslike, no filler, and never more than it knows.
 *
 * Three times and a link, or just the link when the calendar cannot be read.
 * It never says what the meeting is about — it does not know — and it never
 * promises anything beyond the time.
 */
export function proposalText(input) {
  const hebrew = input.language === 'he';
  const first = (input.toName ?? '').trim().split(/\s+/)[0] ?? '';
  const tz = input.timeZone ?? 'Asia/Jerusalem';
  const lines = [];

  if (hebrew) {
    lines.push(first ? `היי ${first},` : 'היי,');
    lines.push('');
    if (input.slots.length > 0) {
      lines.push('אפשר באחד מהמועדים האלה (שעון ישראל):');
      for (const slot of input.slots) lines.push(`· ${slotLine(slot, tz)}`);
      lines.push('');
      lines.push(input.calendlyUrl ? `אם נוח יותר, אפשר לבחור ישירות כאן: ${input.calendlyUrl}` : 'תגיד לי מה מתאים ואשלח הזמנה.');
    } else if (input.calendlyUrl) {
      lines.push(`אפשר לבחור מועד שנוח לך כאן: ${input.calendlyUrl}`);
    }
    lines.push('');
    lines.push(input.signOff ?? 'תודה,\nמאור');
    return lines.join('\n');
  }

  lines.push(first ? `Hi ${first},` : 'Hi,');
  lines.push('');
  if (input.slots.length > 0) {
    lines.push(`Any of these work (${tz.replace('_', ' ')} time):`);
    for (const slot of input.slots) lines.push(`· ${slotLine(slot, tz)}`);
    lines.push('');
    lines.push(
      input.calendlyUrl
        ? `Or pick a time directly: ${input.calendlyUrl}`
        : 'Tell me which suits and I will send an invitation.',
    );
  } else if (input.calendlyUrl) {
    lines.push(`Pick a time that suits you here: ${input.calendlyUrl}`);
  }
  lines.push('');
  lines.push(input.signOff ?? 'Best,\nMaor');
  return lines.join('\n');
}

/**
 * The last gate before a reply is sent.
 *
 * Separate from writing it, and it can only ever refuse: the thing that
 * decides to send must not be the thing that wanted to send.
 */
export function maySend(read, allowed, reply, has) {
  if (!read.wants) return { ok: false, why: read.why };
  if (!allowed.ok) return { ok: false, why: allowed.why };
  if (has.slots === 0 && !has.calendly) {
    return { ok: false, why: 'no free times to offer and no booking link set' };
  }
  if (reply.trim().length < 20) return { ok: false, why: 'the reply is empty' };
  if (reply.length > 1200) return { ok: false, why: 'the reply grew too long to be a scheduling note' };
  // Anything sent over his address carries his name. No exceptions, no dial.
  if (!signedByHim(reply)) return { ok: false, why: 'it is not signed with your name' };
  return { ok: true, why: allowed.why };
}

/* ── Working out when he is actually free ──────────────────────────────────
 *
 * Google gives back the busy blocks; the free ones have to be worked out from
 * them, inside his working hours and in his timezone. It is arithmetic, so it
 * lives here with the rest of the rules rather than in the job — the job does
 * HTTP and nothing else, and this half is the half worth testing.
 */

/** How far the zone is from UTC at a given instant, in minutes. */
export function offsetMinutes(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The instant at which the clock in `timeZone` reads this day and time.
 *
 * Two passes because the offset itself depends on the answer: the first guess
 * uses the offset at the same wall time in UTC, which is wrong by an hour on
 * the two days a year the clocks move, and the second uses the offset at the
 * guess, which is right.
 */
export function instantAt(day, hour, minute, timeZone) {
  const pad = (n) => String(n).padStart(2, '0');
  const naive = Date.parse(`${day}T${pad(hour)}:${pad(minute)}:00Z`);
  const first = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  return new Date(naive - offsetMinutes(first, timeZone) * 60_000);
}

/** The calendar day in that timezone, as YYYY-MM-DD. */
export function dayKey(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 0 = Sunday, as the working-days setting numbers them. */
export function weekdayIn(at, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  const index = WEEKDAYS.indexOf(name.slice(0, 3));
  return index === -1 ? at.getUTCDay() : index;
}

/** "10:30" → hours and minutes, and never anything a Date will not take. */
export function clockTime(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(fallback);
  const hour = Math.min(23, Math.max(0, Number(match?.[1] ?? 10)));
  const minute = Math.min(59, Math.max(0, Number(match?.[2] ?? 0)));
  return { hour, minute };
}

/**
 * The free slots inside his working hours, once the busy blocks are removed.
 *
 * Slots step every half hour from the time he starts — he starts at 10:30, so
 * the offers are 10:30, 11:00 and so on, not 10:00. A slot never straddles a
 * busy block, never ends after the working day, and never starts in the past.
 */
export function freeWindows(busy, options = {}) {
  const timeZone = options.timeZone ?? 'Asia/Jerusalem';
  const days = options.days ?? [0, 1, 2, 3, 4];
  const from = clockTime(options.from ?? '', '10:30');
  const to = clockTime(options.to ?? '', '18:00');
  const minutes = options.minutes ?? 30;
  const horizon = options.horizonDays ?? 10;
  const now = options.now ?? new Date();

  const blocks = busy
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    .sort((a, b) => a.start - b.start);
  const clashes = (start, end) => blocks.some((b) => b.start < end && b.end > start);

  const out = [];
  for (let i = 0; i <= horizon; i += 1) {
    const at = new Date(now.getTime() + i * 86_400_000);
    if (!days.includes(weekdayIn(at, timeZone))) continue;

    const day = dayKey(at, timeZone);
    const opens = instantAt(day, from.hour, from.minute, timeZone).getTime();
    const closes = instantAt(day, to.hour, to.minute, timeZone).getTime();

    for (let start = opens; start + minutes * 60_000 <= closes; start += 30 * 60_000) {
      const end = start + minutes * 60_000;
      if (start <= now.getTime()) continue;
      if (clashes(start, end)) continue;
      out.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }
  return out;
}

/**
 * An evening slot, by his own line — he takes evening meetings only when they
 * matter, so anything at or after this hour is not something to offer without
 * asking him first.
 */
export function isEvening(slot, eveningFrom = '18:00', timeZone = 'Asia/Jerusalem') {
  const line = clockTime(eveningFrom, '18:00');
  const day = dayKey(new Date(slot.start), timeZone);
  return Date.parse(slot.start) >= instantAt(day, line.hour, line.minute, timeZone).getTime();
}

/** They are asking for a time he does not normally give. */
const ASKS_FOR_EVENING = [
  /\b(this|tomorrow|tonight) evening\b/i,
  /\b(after|past)\s+(6|7|8|9|18:00|19:00|20:00)\s*(pm)?\b/i,
  /\b(late|end of the) (afternoon|day)\b/i,
  /\b(weekend|saturday|friday night)\b/i,
  /(בערב|אחרי שש|אחרי 18|בסופ"?ש|שבת)/,
];

export function asksForEvening(text) {
  return ASKS_FOR_EVENING.some((p) => p.test(text ?? ''));
}

/**
 * Send, ask him, or leave it alone — his three outcomes, in his words.
 *
 * He drew the line himself: spam and strangers get silence, not a question;
 * a meeting he might not want gets a question in Slack with who it is and what
 * it is about; everything else it simply books. So doubt about WHO is asking
 * ends the thread here, and doubt about WHETHER HE WANTS IT goes to him.
 */
export function decide(input) {
  if (!input.read.wants) return { action: 'leave', why: input.read.why };
  if (!input.allowed.ok) return { action: 'leave', why: input.allowed.why };
  // Not confident it is even a request to meet: silence, as he asked.
  if (input.confidence === 'low') return { action: 'leave', why: 'not confident enough to answer' };

  if (asksForEvening(input.theyAsked)) {
    return { action: 'ask', why: 'they are asking for an evening or a weekend' };
  }
  if (input.confidence !== 'high') {
    return { action: 'ask', why: 'not certain you want this one' };
  }

  const daytime = input.slots.filter((s) => !isEvening(s, input.eveningFrom, input.timeZone));
  if (daytime.length === 0) {
    if (input.slots.length > 0) {
      return { action: 'ask', why: 'the only free times are in the evening' };
    }
    if (!input.calendly) return { action: 'ask', why: 'your diary has nothing free to offer' };
  }
  return { action: 'send', why: input.allowed.why };
}

/**
 * Whether a refusal is final.
 *
 * A thread left alone because the last word is his changes by tomorrow; one
 * left alone because a machine sent it never does. Only the second is written
 * down, or the agent would decide once and never look again.
 */
const TRANSIENT = [
  'the last word is already yours',
  'nothing in the thread',
  'nothing to read',
  'your diary has nothing free',
];

export function settled(why) {
  return !TRANSIENT.some((t) => (why ?? '').includes(t));
}

/**
 * A rewrite in his voice must still be the same offer.
 *
 * He asked for the reply to sound like him rather than like a form. The way
 * that stays safe is to let the model rewrite the words and nothing else: the
 * times and the booking link are handed to it as lines it must reproduce
 * exactly, and this checks that it did. A rewrite that moved a meeting by half
 * an hour, dropped one of the three, or invented a second link is refused and
 * the plain version goes instead.
 */
export function sameOffer(rewritten, offer) {
  const text = (rewritten ?? '').trim();
  if (text.length < 20) return { ok: false, why: 'the rewrite came back empty' };
  if (text.length > 1200) return { ok: false, why: 'the rewrite grew too long to be a scheduling note' };

  const tz = offer.timeZone ?? 'Asia/Jerusalem';
  const lines = offer.slots.map((s) => slotLine(s, tz));
  for (const line of lines) {
    if (!text.includes(line)) return { ok: false, why: `it changed or dropped "${line}"` };
  }

  /*
   * No time that was not offered. Every clock time in the reply has to belong
   * to one of the lines above — otherwise something invented a slot, which is
   * the one mistake here that costs him a meeting he never agreed to.
   */
  const offered = new Set();
  for (const line of lines) for (const m of line.matchAll(/\d{1,2}:\d{2}/g)) offered.add(m[0]);
  for (const m of text.matchAll(/\d{1,2}:\d{2}/g)) {
    if (!offered.has(m[0])) return { ok: false, why: `it added a time nobody offered (${m[0]})` };
  }

  const urls = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[.,;)]+$/, ''));
  if (offer.calendlyUrl) {
    if (!urls.includes(offer.calendlyUrl)) return { ok: false, why: 'it dropped your booking link' };
  }
  const strays = urls.filter((u) => u !== offer.calendlyUrl);
  if (strays.length > 0) return { ok: false, why: `it added a link of its own (${strays[0]})` };

  // A rewrite is free to change the sign-off. It is not free to remove it.
  if (!signedByHim(text)) return { ok: false, why: 'it dropped your name from the sign-off' };

  return { ok: true, why: 'the offer survived the rewrite' };
}

/* ── Who else should be in the room ────────────────────────────────────────
 *
 * He asked for the right people from the company to be on every meeting it
 * books, and to be asked when it does not know. "Does not know" is the whole
 * of the design here: an address already on the thread is not a guess, and a
 * name the model produced from nowhere is. Only the first gets an invitation.
 */

export const INTERNAL_DOMAIN = process.env.INTERNAL_DOMAIN ?? 'adnimation.com';

const clean = (email) => (email ?? '').trim().toLowerCase();

export function isInternal(email, domain = INTERNAL_DOMAIN) {
  return clean(email).endsWith(`@${domain.toLowerCase()}`);
}

/** Every address in a header line, however it was written. */
export function emailsIn(text) {
  const found = String(text ?? '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  return [...new Set(found.map(clean))];
}

/**
 * Who goes on the invitation.
 *
 * Three sources, and only two of them are trusted without him: the person who
 * asked for the meeting, and any colleague already on the thread — both are
 * facts about the conversation. The third is the model's opinion about who
 * else should be there, and that is never acted on alone: a colleague it
 * names is put to him in Slack first, and only a name that matches the
 * company roster is even worth asking about.
 */
export function pickAttendees(input) {
  const domain = input.domain ?? INTERNAL_DOMAIN;
  const mine = clean(input.mailbox);
  const requester = clean(input.requester);

  const onThread = [...new Set(input.threadAddresses.map(clean))]
    .filter((e) => e.includes('@') && e !== mine);

  // Colleagues already in the conversation. Nothing to ask about: he can see
  // them on the thread, and leaving them off the invitation is the surprise.
  const colleagues = onThread.filter((e) => isInternal(e, domain) && e !== requester);

  const roster = input.roster ?? [];
  const known = new Set(roster.map((p) => clean(p.email)));
  const suggested = [...new Set((input.suggested ?? []).map(clean))]
    .filter((e) => e && e !== mine && e !== requester)
    .filter((e) => !colleagues.includes(e));

  // A name the model produced that is not on the roster is not a person we
  // know of, so it is not even a question — it is dropped.
  const askable = suggested.filter((e) => known.has(e));

  const invite = [...new Set([requester, ...onThread])].filter(Boolean);

  return {
    invite,
    ask: askable,
    why: colleagues.length
      ? `${colleagues.length} colleague(s) already on the thread`
      : 'nobody else from the company is on this thread',
  };
}

/**
 * His answer, when it asked who should be on it.
 *
 * He will type an address, or a first name, or "just me" — all three are
 * answers, and anything else is not one, so the thread waits rather than
 * guessing. Names are matched only against the roster: a name that resolves
 * to nobody is reported back rather than silently dropped.
 */
/*
 * "Nobody" is an answer, and a different one from silence.
 *
 * The Hebrew forms carry no `\b`: a word boundary is defined on ASCII word
 * characters, so one after "אני" never matches and "רק אני" read as no answer
 * at all — which would leave the meeting waiting for him forever.
 */
const NOBODY = [
  /^\s*(no ?one|nobody|just me|only me|alone|none|skip)\b/i,
  /^\s*(אף אחד|רק אני|לבד|לא צריך)/,
];

export function readPeopleAnswer(text, roster = []) {
  const said = String(text ?? '').trim();
  if (said === '') return { answered: false, emails: [], unmatched: [] };
  if (NOBODY.some((p) => p.test(said))) return { answered: true, emails: [], unmatched: [] };

  const emails = emailsIn(said).filter((e) => roster.length === 0 || roster.some((p) => clean(p.email) === e));
  const matched = new Set(emails);
  const unmatched = [];

  /*
   * A first name, which is how he will actually answer. Matched whole-word
   * against the roster in both alphabets; two people sharing a first name is
   * not a match, it is a question, so it counts as unmatched.
   */
  for (const word of said.split(/[\s,·]+/)) {
    const token = word.replace(/[^\p{L}\p{N}.'-]/gu, '');
    if (token.length < 2 || token.includes('@')) continue;
    const hits = roster.filter((p) => {
      const first = p.name.split(/\s+/)[0] ?? '';
      return first.toLowerCase() === token.toLowerCase() || p.name.toLowerCase() === token.toLowerCase();
    });
    if (hits.length === 1) matched.add(clean(hits[0].email));
    else if (hits.length > 1) unmatched.push(token);
  }

  const list = [...matched];
  return { answered: list.length > 0 || emails.length > 0, emails: list, unmatched };
}
