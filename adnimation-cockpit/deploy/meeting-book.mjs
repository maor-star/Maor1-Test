#!/usr/bin/env node
/**
 * Books his meetings.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… \
 *   ANTHROPIC_API_KEY=… node meeting-book.mjs
 *
 * DRY=1 decides everything and sends nothing — no mail, no Slack, no calendar
 * event, no row. It is how he reads what it would have written before letting
 * it write anything.
 *
 * Someone asks to meet. It reads his diary, offers three times that are
 * actually free — or sends his booking link when the diary cannot be read —
 * files the thread under "Claude/Meetings", and tells him in Slack who it just
 * put in his week. When they come back and pick one of those times, it puts
 * the meeting in the calendar and tells him that too.
 *
 * Three outcomes, and he drew the lines between them himself:
 *
 *   SEND   someone he deals with, asking to meet, in working hours. It answers.
 *   ASK    something he might not want — an evening, a weekend, or a request
 *          it is not certain about. One Slack message with who it is and what
 *          it is about; it answers only if he says yes, and never otherwise.
 *   LEAVE  a machine, a stranger, a cold pitch. Silence. He does not want a
 *          question about those either.
 *
 * Nothing here can widen what the rules allowed: the rules decide first
 * (meeting-rules.mjs), the model may only narrow, and maySend is a third gate
 * written apart from the code that wanted to send.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';
import {
  MEETINGS_LABEL, decide, freeWindows, mayAnswer, maySend, pickSlots,
  proposalText, settled, slotLine, wantsMeeting,
} from './meeting-rules.mjs';
import { isInternalAddress } from './internal-mail.mjs';
import { postAsBot, readReplies } from './bot-post.mjs';
import { agentState, briefVeto, markRan, mayAct, recordRun, startLog } from './agent-brief.mjs';
import { loadSecrets } from './job-secrets.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const DRY = process.env.DRY === '1';
const AGENT = 'meeting-booker';
/** Which Slack bot speaks for it — the same table the app reads. */
const BOT = 'work';
const MAX = Number(process.env.MEETING_MAX ?? 25);

if (!DB || !RAW_KEY || !MAILBOX) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ── Google ───────────────────────────────────────────────────────────────
 * A token per scope, because domain-wide delegation refuses the whole request
 * when one scope is not granted — and the calendar scope is exactly the one
 * that may not be. Asking per scope is what lets the mail half keep working
 * while the diary half waits for the delegation.
 */
const tokens = new Map();
async function token(scope) {
  const held = tokens.get(scope);
  if (held && held.expiresAt > Date.now() + 60_000) return held.value;

  const key = JSON.parse(
    RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(JSON.stringify({
    iss: key.client_email, sub: MAILBOX, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

  const body = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  }).then((r) => r.json());

  if (!body.access_token) {
    const hint = body.error === 'unauthorized_client' ? ` — grant ${scope}` : '';
    throw new Error(`${scope}: ${body.error}${hint}`);
  }
  tokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const CAL_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const CAL = 'https://www.googleapis.com/auth/calendar';

/**
 * A calendar token, from whichever scope the delegation actually grants.
 *
 * His delegation carries the full `calendar` scope and neither of the narrow
 * ones — asking for `calendar.readonly` is refused outright with
 * unauthorized_client, which read as "no calendar at all" until the scopes
 * were listed one by one. So the narrow scope is tried first, because reading
 * a diary should ask for reading, and the full one is the fallback rather than
 * the assumption.
 */
async function calendarToken(write = false) {
  if (write) return token(CAL);
  try {
    return await token(CAL_READ);
  } catch (e) {
    if (!String(e.message).includes('unauthorized_client')) throw e;
    return token(CAL);
  }
}

async function gmail(path, scope = READ, init) {
  const t = await token(scope);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const header = (hs, name) => hs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

function plainText(part, out = []) {
  if (!part) return out;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.push(Buffer.from(part.body.data, 'base64').toString('utf8'));
  }
  for (const child of part.parts ?? []) plainText(child, out);
  return out;
}

/** The label, created under its parent the first time it is needed. */
async function labelId(name) {
  const { labels } = await gmail('/labels');
  const found = labels?.find((l) => l.name === name);
  if (found) return found.id;
  if (DRY) return null;

  // Gmail nests by name, and the parent has to exist before the child.
  const parent = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : null;
  if (parent && !labels?.some((l) => l.name === parent)) {
    await gmail('/labels', MODIFY, {
      method: 'POST',
      body: JSON.stringify({ name: parent, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    }).catch(() => {});
  }
  const created = await gmail('/labels', MODIFY, {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  });
  console.log(`created the label "${name}"`);
  return created.id;
}

async function file(messageId, labelIdValue) {
  if (!labelIdValue) return false;
  return gmail(`/messages/${messageId}/modify`, MODIFY, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [labelIdValue], removeLabelIds: ['INBOX'] }),
  })
    .then(() => true)
    .catch((e) => {
      console.log(`      could not file it: ${e.message}`);
      return false;
    });
}

async function reply(candidate, text) {
  const subject = (candidate.subject ?? '').toLowerCase().startsWith('re:')
    ? candidate.subject
    : `Re: ${candidate.subject ?? 'Meeting'}`;
  const encoded = /^[\x00-\x7F]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;

  const mime = [
    `To: ${candidate.fromEmail}`,
    `Subject: ${encoded}`,
    ...(candidate.messageId ? [`In-Reply-To: ${candidate.messageId}`, `References: ${candidate.messageId}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
  ].join('\r\n');

  return gmail('/messages/send', SEND, {
    method: 'POST',
    body: JSON.stringify({ raw: b64(mime), threadId: candidate.threadId }),
  });
}

/* ── The diary ─────────────────────────────────────────────────────────── */

async function busyBlocks(from, to) {
  const t = await calendarToken();
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error?.message ?? `http_${res.status}`;
    // Two different failures read the same from here, so they are named apart:
    // a scope the delegation withheld, and an API nobody switched on.
    throw new Error(
      message.includes('has not been used in project')
        ? 'the Google Calendar API is not switched on in the Cloud project yet'
        : `freeBusy: ${message}`,
    );
  }
  const body = await res.json();
  return Object.values(body.calendars ?? {}).flatMap((c) =>
    (c.busy ?? []).map((b) => ({ start: b.start, end: b.end })),
  );
}

async function putInCalendar({ summary, description, slot, attendee, timeZone }) {
  const t = await calendarToken(true);
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: slot.start, timeZone },
        end: { dateTime: slot.end, timeZone },
        attendees: [{ email: attendee }],
      }),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) throw new Error(body?.error?.message ?? `http_${res.status}`);
  return { id: body.id, link: body.htmlLink };
}

/**
 * His booking link, from the Calendly token.
 *
 * /users/me needs the `user:read` scope, which his token does not carry — but
 * the token's own payload holds the user uuid, and the uuid is the whole of
 * the user URI. So the identity comes from the token and the link comes from
 * his first active event type. Nothing about the token is logged.
 */
async function calendlyLink(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (!payload.user_uuid) return null;
    const uri = `https://api.calendly.com/users/${payload.user_uuid}`;

    const me = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (me?.resource?.scheduling_url) return me.resource.scheduling_url;

    const types = await fetch(
      `https://api.calendly.com/event_types?user=${encodeURIComponent(uri)}&active=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const list = types?.collection ?? [];
    // The generic one before the conference-specific ones, when it can tell.
    const generic = list.find((t) => /meet|call|intro|30/i.test(t.name ?? '')) ?? list[0];
    return generic?.scheduling_url ?? null;
  } catch {
    return null;
  }
}

/* ── The model, as the second gate ─────────────────────────────────────── */

const SYSTEM = `You are reading one email thread for Maor Davidovich, CEO of
Adnimation, an Israeli ad-tech company, and deciding one thing only: is this a
genuine request from someone he deals with to meet him, and how sure are you.

You never write the reply and you never choose the times. Your answer can only
narrow what the rules already allowed — the rules have already decided this
thread qualifies, and your job is to catch what they could not see.

Say NOT a request when any of these is true:
· it is automated, a newsletter, a booking confirmation or a calendar notice
· it is cold outreach, however polite — "15 minutes to show you", "we help
  companies like yours", a pitch with a meeting attached
· the meeting is already agreed and this is only confirming it
· nobody is actually asking to meet him

Confidence is what he acts on, so be strict with it:
· high — an ongoing conversation with someone he clearly deals with, and they
  are plainly asking for a time
· medium — probably real, but you would want him to look
· low — you are guessing

Also report, from the thread and nothing else: who they are and what the
meeting would be about, in one line each, factual, no adjectives you cannot
support. He reads those two lines to decide.`;

async function readThread(candidate, apiKey) {
  const thread = candidate.messages
    .map((m) => `${m.fromMe ? 'Maor' : candidate.fromName}: ${m.text.slice(0, 3000)}`)
    .join('\n\n---\n\n');

  const prompt = [
    `From: ${candidate.fromName} <${candidate.fromEmail}>`,
    candidate.internal ? 'They are inside Adnimation.' : null,
    candidate.knownCompany ? `The CRM has them as: ${candidate.knownCompany}` : null,
    candidate.knownContact ? 'He has corresponded with this address before.' : null,
    `Subject: ${candidate.subject}`,
    '',
    'The thread, oldest first:',
    thread,
    '',
    'Answer as JSON: {"isRequest": boolean, "confidence": "high|medium|low", ' +
      '"who": "one line — who they are", "about": "one line — what the meeting is about", ' +
      '"language": "he|en", "minutes": 30, "reasoning": "one line"}',
  ].filter((l) => l !== null).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`claude: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? text);
}

/**
 * Which of the times it offered they accepted — an index into that list or
 * nothing at all. It is never allowed to invent a time: a meeting he never
 * offered is not a meeting he agreed to.
 */
async function whichSlot(offered, theirWords, apiKey) {
  const list = offered.map((s, i) => `${i}: ${slotLine(s)}`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system:
        'You are told which times were offered and what the other side then wrote. Say which ' +
        'offered time they accepted, by its number, or null if they accepted none of them, ' +
        'proposed a different time, or are unclear. Never pick a time that is not on the list.',
      messages: [{
        role: 'user',
        content: `The times offered:\n${list}\n\nThey wrote:\n${theirWords.slice(0, 2000)}\n\n` +
          'Answer as JSON: {"index": number|null, "why": "one line"}',
      }],
    }),
  });
  if (!res.ok) throw new Error(`claude: http_${res.status}`);
  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const answer = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? text);
  const index = Number.isInteger(answer.index) ? answer.index : null;
  return index !== null && index >= 0 && index < offered.length
    ? { slot: offered[index], why: answer.why ?? '' }
    : { slot: null, why: answer.why ?? 'they did not pick one of the offered times' };
}

/* ── His yes or no, read back out of Slack ─────────────────────────────── */

const YES = /^\s*(yes|yep|yeah|ok|okay|sure|go ahead|do it|book it|כן|בסדר|אישור|תקבע|קבע|סבבה|יאללה)\b/i;
const NO = /^\s*(no|nope|don'?t|skip|leave it|לא|לא צריך|תדלג|תשאיר)\b/i;

function readAnswer(messages) {
  for (const m of messages) {
    const text = (m.text ?? '').trim();
    if (YES.test(text)) return 'yes';
    if (NO.test(text)) return 'no';
  }
  return null;
}

async function tellHim(lines, notify, { thread } = {}) {
  if (lines.length === 0) return { ok: false, reason: 'nothing to say' };
  if (!notify) {
    console.log('slack notifications are off for this agent, so nothing was sent.');
    return { ok: false, reason: 'notifications are off' };
  }
  const sent = await postAsBot(BOT, lines.join('\n'));
  if (!sent.ok) console.error(`could not tell him in Slack: ${sent.reason}`);
  return sent;
}

async function main() {
  const started = Date.now();
  const log = startLog();

  const state = await agentState(sql, AGENT);
  const gate = mayAct(state, { dry: DRY, force: process.env.FORCE === '1' });
  if (!gate.act && !DRY) {
    console.log(`booking nothing: ${gate.why}.`);
    await recordRun(sql, AGENT, {
      dry: DRY, output: log.text(), summary: { skipped: gate.why }, startedAt: new Date(started),
    });
    await sql.end();
    process.exit(0);
  }
  if (!DRY) await markRan(sql, AGENT);

  const filled = await loadSecrets(sql, ['ANTHROPIC_API_KEY', 'CALENDLY_LINK', 'CALENDLY_TOKEN']);
  if (filled.length > 0) console.log(`keys from the Keys screen: ${filled.join(', ')}`);

  const CLAUDE = process.env.ANTHROPIC_API_KEY;
  if (!CLAUDE) {
    console.error('ANTHROPIC_API_KEY is required — the second gate cannot be skipped.');
    await sql.end();
    process.exit(78);
  }

  /*
   * His dials, from the agent's card. The defaults here are his own answers:
   * he starts at 10:30, he works Sunday to Thursday, and an evening meeting is
   * a question rather than an offer.
   */
  const s = state.settings ?? {};
  const setting = (key, fallback) => (s[key] === undefined || s[key] === '' ? fallback : s[key]);
  const timeZone = String(setting('timeZone', 'Asia/Jerusalem'));
  const options = {
    days: Array.isArray(s.days) ? s.days.map(Number) : [0, 1, 2, 3, 4],
    from: String(setting('from', '10:30')),
    to: String(setting('to', '18:00')),
    minutes: Number(setting('minutes', 30)),
    horizonDays: Number(setting('horizonDays', 10)),
    timeZone,
  };
  const eveningFrom = String(setting('eveningFrom', '18:00'));
  const offerCount = Number(setting('offers', 3));
  const minLeadHours = Number(setting('minLeadHours', 18));
  /*
   * His booking link. He may type it on the agent's card or paste it on the
   * Keys screen — and if he has given the cockpit a Calendly token instead, it
   * asks Calendly rather than making him paste the same thing twice.
   */
  let calendly = String(setting('calendlyLink', process.env.CALENDLY_LINK ?? '')).trim() || null;
  if (!calendly && process.env.CALENDLY_TOKEN) {
    calendly = await calendlyLink(process.env.CALENDLY_TOKEN);
    if (calendly) console.log(`booking link read from your Calendly account: ${calendly}`);
  }
  const bookItself = setting('book', true) !== false;
  const signOff = String(setting('signOff', 'Best,\nMaor'));

  console.log(
    `working ${options.from}–${options.to} ${timeZone}, days ${options.days.join('')}, ` +
      `${options.minutes} minutes, evenings after ${eveningFrom} are a question` +
      `${calendly ? ', booking link set' : ', no booking link'}${DRY ? ' (dry run)' : ''}`,
  );

  /* The diary. Without the scope it still works — it sends the link instead. */
  let free = [];
  let diaryReason = null;
  try {
    const from = new Date();
    const to = new Date(Date.now() + (options.horizonDays + 1) * 86_400_000);
    const busy = await busyBlocks(from, to);
    free = freeWindows(busy, options);
    console.log(`${busy.length} busy block(s) read, ${free.length} free slot(s) inside your hours`);
  } catch (e) {
    diaryReason = e.message;
    console.log(`could not read your diary: ${e.message}`);
    if (!calendly) {
      console.log('and there is no booking link set, so there is nothing it could offer anyone.');
    }
  }

  const meetingsLabel = await labelId(MEETINGS_LABEL);
  const told = [];
  let proposed = 0;
  let asked = 0;
  let booked = 0;
  let left = 0;

  /* ── First: anything he has already been asked about in Slack ─────────── */
  const waiting = await sql`
    select * from meeting_requests
    where status = 'asked' and asked_at > now() - interval '4 days'
  `.catch(() => []);

  for (const row of waiting) {
    const heard = await readReplies(BOT, row.ask_channel, row.ask_ts);
    if (!heard.ok) {
      console.log(`  cannot read your answer about "${row.subject}": ${heard.reason}`);
      continue;
    }
    const answer = readAnswer(heard.messages);
    if (!answer) continue;
    if (answer === 'no') {
      console.log(`  YOU SAID NO: ${row.subject} — leaving it alone`);
      if (!DRY) {
        await sql`update meeting_requests set status = 'declined', answer = 'no' where thread_id = ${row.thread_id}`;
      }
      left += 1;
      continue;
    }
    // He said yes: answer them now, with the times this run found.
    const slots = pickSlots(free, { count: offerCount, minLeadHours });
    const text = proposalText({
      toName: row.from_name,
      slots,
      calendlyUrl: calendly,
      timeZone,
      signOff,
      language: row.why?.includes('hebrew') ? 'he' : 'en',
    });
    console.log(`  YOU SAID YES: ${row.subject} — answering ${row.from_email}`);
    console.log(text.split('\n').map((l) => `        ${l}`).join('\n'));
    if (DRY) { proposed += 1; continue; }

    await reply(
      { subject: row.subject, fromEmail: row.from_email, threadId: row.thread_id, messageId: null },
      text,
    );
    await sql`
      update meeting_requests
      set status = 'proposed', answer = 'yes', kind = ${slots.length ? 'propose' : 'calendly'},
          proposed_slots = ${JSON.stringify(slots)}::jsonb, reply = ${text}, replied_at = now()
      where thread_id = ${row.thread_id}
    `;
    proposed += 1;
    told.push(`:calendar: You said yes — I offered ${row.from_name ?? row.from_email} ${slots.length || 'the booking link'} time(s).`);
  }

  /* ── Second: the new mail ─────────────────────────────────────────────── */
  const { messages } = await gmail(
    `/messages?maxResults=${MAX}&q=${encodeURIComponent('in:inbox -from:me newer_than:14d')}`,
  );
  const refs = messages ?? [];
  console.log(`${refs.length} in the inbox`);

  for (const ref of refs) {
    const message = await gmail(`/messages/${ref.id}?format=full`);
    const hs = message.payload?.headers ?? [];
    const from = header(hs, 'from') ?? '';
    const fromEmail = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
    const subject = header(hs, 'subject') ?? '(no subject)';

    const [already] = await sql`
      select thread_id from meeting_requests where thread_id = ${message.threadId}
    `;
    if (already) continue;

    const thread = await gmail(`/threads/${message.threadId}?format=full`);
    const messages_ = (thread.messages ?? []).map((m) => ({
      fromMe: (header(m.payload?.headers ?? [], 'from') ?? '').includes(MAILBOX),
      text: plainText(m.payload).join('\n').slice(0, 6000) || m.snippet || '',
    }));

    const [known] = await sql`
      select known_company, known_contact from mail_threads where thread_id = ${message.threadId}
    `;
    // Corresponded with before this thread — the cockpit's own record, not a
    // guess from the address.
    const [seen] = await sql`
      select count(*)::int as n from mail_threads
      where counterpart_email = ${fromEmail} and thread_id <> ${message.threadId}
    `.catch(() => [{ n: 0 }]);

    const candidate = {
      subject,
      snippet: message.snippet ?? '',
      fromEmail,
      fromName: (/^(.*)</.exec(from)?.[1] ?? from).trim().replace(/^"|"$/g, ''),
      messages: messages_,
      knownContact: Boolean(known?.known_contact) || (seen?.n ?? 0) > 0,
      knownCompany: known?.known_company ?? null,
      internal: isInternalAddress(fromEmail),
      threadId: message.threadId,
      messageId: header(hs, 'message-id'),
    };

    const read = wantsMeeting(candidate);
    if (!read.wants) continue; // not a meeting thread at all; nothing to record

    const allowed = mayAnswer(candidate);
    const theyWrote = candidate.messages.at(-1)?.text ?? candidate.snippet ?? '';

    let verdict = { isRequest: false, confidence: 'low', reasoning: 'not asked' };
    if (allowed.ok) {
      verdict = await readThread(candidate, CLAUDE).catch((e) => ({
        isRequest: false, confidence: 'low', reasoning: e.message,
      }));
    }
    const modelSays = verdict.isRequest ? String(verdict.confidence ?? 'low') : 'low';

    const slots = pickSlots(free, { count: offerCount, minLeadHours });
    const choice = decide({
      read,
      allowed,
      slots,
      confidence: modelSays,
      calendly: Boolean(calendly),
      theyAsked: `${subject}\n${theyWrote}`,
      eveningFrom,
      timeZone,
    });

    /* What he has taught it may only ever hold something back. */
    if (choice.action !== 'leave') {
      const veto = await briefVeto({
        brief: state.brief,
        playbook: state.playbook,
        agent: AGENT,
        what: choice.action === 'send' ? 'reply with times for a meeting' : 'ask you about a meeting',
        item: { from, subject, theyWrote: theyWrote.slice(0, 600) },
      });
      if (!veto.go) {
        console.log(`  LEFT FOR YOU: ${subject}\n      because: ${veto.why}`);
        left += 1;
        continue;
      }
    }

    if (choice.action === 'leave') {
      left += 1;
      console.log(`  LEFT FOR YOU: ${subject}`);
      console.log(`      from ${from}`);
      console.log(`      because: ${choice.why}`);
      // Only a settled reason is written down; a thread waiting on him will
      // look different tomorrow and deserves another look.
      if (!DRY && settled(choice.why)) {
        await sql`
          insert into meeting_requests (thread_id, from_email, from_name, subject, kind, status, why)
          values (${message.threadId}, ${fromEmail}, ${candidate.fromName}, ${subject}, 'left', 'left', ${choice.why})
          on conflict (thread_id) do nothing
        `;
      }
      continue;
    }

    if (choice.action === 'ask') {
      asked += 1;
      const question = [
        `:grey_question: *A meeting I am not sure you want*`,
        `> *Who:* ${verdict.who ?? candidate.fromName} <${fromEmail}>`,
        `> *About:* ${verdict.about ?? subject}`,
        `> *They wrote:* ${theyWrote.replace(/\s+/g, ' ').slice(0, 300)}`,
        `> *Why I am asking:* ${choice.why}`,
        slots.length ? `> *I would offer:* ${slots.map((x) => slotLine(x, timeZone)).join(' · ')}` : '',
        '',
        'Reply *yes* and I will answer them, or *no* and I will leave it alone.',
      ].filter(Boolean).join('\n');

      console.log(`  ${DRY ? 'WOULD ASK YOU' : 'ASKING YOU'}: ${subject}`);
      console.log(question.split('\n').map((l) => `        ${l}`).join('\n'));
      if (DRY) continue;

      const sent = state.notify ? await postAsBot(BOT, question) : { ok: false, reason: 'notifications are off' };
      if (!sent.ok) {
        console.log(`      could not ask you: ${sent.reason} — leaving it in your inbox`);
        continue;
      }
      await sql`
        insert into meeting_requests
          (thread_id, from_email, from_name, subject, kind, status, why, ask_channel, ask_ts, asked_at)
        values (${message.threadId}, ${fromEmail}, ${candidate.fromName}, ${subject}, 'ask', 'asked',
                ${choice.why}, ${sent.channel}, ${sent.ts}, now())
        on conflict (thread_id) do nothing
      `;
      continue;
    }

    /* Send. */
    const language = verdict.language === 'he' ? 'he' : 'en';
    const text = proposalText({
      toName: candidate.fromName,
      slots,
      calendlyUrl: calendly,
      timeZone,
      signOff,
      language,
    });
    const send = maySend(read, allowed, text, { slots: slots.length, calendly: Boolean(calendly) });
    if (!send.ok) {
      left += 1;
      console.log(`  LEFT FOR YOU: ${subject}\n      because: ${send.why}`);
      continue;
    }

    console.log(`  ${DRY ? 'WOULD ANSWER' : 'ANSWERED'}: ${subject}`);
    console.log(`      from ${from}`);
    console.log(`      they wrote: ${theyWrote.replace(/\s+/g, ' ').slice(0, 300)}`);
    console.log(text.split('\n').map((l) => `        ${l}`).join('\n'));
    if (DRY) { proposed += 1; continue; }

    await reply(candidate, text);
    const filedOk = await file(ref.id, meetingsLabel);
    await sql`
      insert into meeting_requests
        (thread_id, from_email, from_name, subject, kind, status, proposed_slots, reply, why, replied_at, filed_at)
      values (${message.threadId}, ${fromEmail}, ${candidate.fromName}, ${subject},
              ${slots.length ? 'propose' : 'calendly'}, 'proposed', ${JSON.stringify(slots)}::jsonb,
              ${text}, ${choice.why}, now(), ${filedOk ? sql`now()` : null})
      on conflict (thread_id) do nothing
    `;
    proposed += 1;
    told.push(
      `:calendar: *${verdict.who ?? candidate.fromName}* — ${verdict.about ?? subject}\n` +
        `> I offered: ${slots.length ? slots.map((x) => slotLine(x, timeZone)).join(' · ') : 'the booking link'}`,
    );
  }

  /* ── Third: the times they accepted, put in the calendar ──────────────── */
  const open = await sql`
    select * from meeting_requests
    where status = 'proposed' and event_id is null and replied_at > now() - interval '21 days'
  `.catch(() => []);

  for (const row of open) {
    const offered = Array.isArray(row.proposed_slots) ? row.proposed_slots : [];
    if (offered.length === 0) continue;

    const thread = await gmail(`/threads/${row.thread_id}?format=full`).catch(() => null);
    if (!thread) continue;
    const last = (thread.messages ?? []).at(-1);
    if (!last) continue;
    const lastFromMe = (header(last.payload?.headers ?? [], 'from') ?? '').includes(MAILBOX);
    if (lastFromMe) continue; // nothing new from them since the offer

    const theirWords = plainText(last.payload).join('\n').slice(0, 4000) || last.snippet || '';
    const picked = await whichSlot(offered, theirWords, CLAUDE).catch((e) => ({ slot: null, why: e.message }));
    if (!picked.slot) {
      console.log(`  ${row.from_email} answered but picked no offered time: ${picked.why}`);
      continue;
    }

    console.log(`  ${DRY ? 'WOULD BOOK' : 'BOOKING'}: ${row.from_email} — ${slotLine(picked.slot, timeZone)}`);
    if (DRY) { booked += 1; continue; }
    if (!bookItself) {
      told.push(
        `:calendar: *${row.from_name ?? row.from_email}* accepted ${slotLine(picked.slot, timeZone)} — ` +
          'you asked to put it in the diary yourself.',
      );
      continue;
    }

    try {
      const event = await putInCalendar({
        summary: `${row.from_name ?? row.from_email} — ${row.subject ?? 'Meeting'}`,
        description: `Booked from the mail thread.\n\n${(row.reply ?? '').slice(0, 500)}`,
        slot: picked.slot,
        attendee: row.from_email,
        timeZone,
      });
      await sql`
        update meeting_requests
        set status = 'booked', chosen_slot = ${JSON.stringify(picked.slot)}::jsonb, event_id = ${event.id}
        where thread_id = ${row.thread_id}
      `;
      booked += 1;
      told.push(
        `:white_check_mark: *Booked: ${row.from_name ?? row.from_email}* — ${slotLine(picked.slot, timeZone)}\n` +
          `> ${row.subject ?? ''}${event.link ? `\n> ${event.link}` : ''}`,
      );
    } catch (e) {
      console.log(`      could not put it in the calendar: ${e.message}`);
      told.push(
        `:warning: *${row.from_name ?? row.from_email}* accepted ${slotLine(picked.slot, timeZone)}, ` +
          `but I could not write to your calendar (${e.message.slice(0, 120)}). Please add it yourself.`,
      );
    }
  }

  if (told.length > 0) {
    const heading = booked
      ? `:calendar: *${booked === 1 ? 'A meeting was booked' : `${booked} meetings were booked`} for you*`
      : ':calendar: *Your diary*';
    await tellHim([heading, '', ...told], state.notify);
    if (!DRY) await sql`update meeting_requests set told_at = now() where told_at is null and status in ('proposed','booked')`;
  }

  if (diaryReason && !DRY) {
    console.log(
      'the calendar half is waiting on the delegation; the booking link carried the rest.',
    );
  }

  console.log(
    `${proposed} answered, ${asked} put to you, ${booked} booked, ${left} left alone, ` +
      `in ${Math.round((Date.now() - started) / 1000)}s.`,
  );

  await recordRun(sql, AGENT, {
    dry: DRY,
    output: log.text(),
    summary: { read: refs.length, proposed, asked, booked, left, diary: diaryReason ? 'unavailable' : 'read' },
    startedAt: new Date(started),
  });

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
