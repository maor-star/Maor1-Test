import { createSign } from 'node:crypto';
import { z } from 'zod';
import type { Slot } from '@/lib/meetings/rules';

/**
 * Google Calendar — reading when he is busy, and putting a meeting in.
 *
 * Its own token for its own scope, for the same reason Drive has one: domain-
 * wide delegation refuses the whole token request when a single scope has not
 * been granted, so a shared token would mean an ungranted calendar scope
 * breaking Gmail as well.
 *
 * That case is not theoretical here — the calendar scope is not delegated to
 * the service account yet, so `calendarStatus()` says so in the words that
 * fix it rather than returning a bare failure. Everything above this file is
 * built to work without it: with the calendar, the meetings agent offers three
 * times; without it, it sends the booking link and says nothing it cannot
 * know.
 *
 * Nothing here deletes. It reads free/busy and it creates events.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Free/busy needs only readonly; creating an event needs the full scope. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const base64url = (input: string | Buffer) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface CalendarStatus {
  configured: boolean;
  authorised: boolean;
  /** True when the credentials are fine and only the delegation is missing. */
  needsScope?: boolean;
  reason?: string;
}

export interface EventInput {
  summary: string;
  description?: string;
  slot: Slot;
  attendees: string[];
  timeZone?: string;
}

export interface EventResult {
  ok: boolean;
  eventId?: string;
  htmlLink?: string;
  error?: string;
  needsScope?: boolean;
}

/**
 * What the meetings agent needs from a calendar, and nothing else.
 *
 * An interface rather than the functions directly so the tests can run the
 * whole agent against `FakeCalendar` with no network — CLAUDE.md §9.
 */
export interface CalendarAdapter {
  busy(from: Date, to: Date): Promise<Slot[]>;
  createEvent(input: EventInput): Promise<EventResult>;
}

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const mailbox = process.env.GMAIL_MAILBOX;
  if (!raw || !mailbox) return null;
  try {
    const parsed = serviceAccountSchema.safeParse(
      JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')),
    );
    return parsed.success ? { key: parsed.data, mailbox } : null;
  } catch {
    return null;
  }
}

const cached = new Map<string, { value: string; expiresAt: number }>();

async function token(
  scope: string,
): Promise<{ token: string } | { error: string; needsScope: boolean }> {
  const held = cached.get(scope);
  if (held && held.expiresAt > Date.now() + 60_000) return { token: held.value };

  const creds = credentials();
  if (!creds) return { error: 'No Google service account on the server', needsScope: false };

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.key.client_email,
      sub: creds.mailbox,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(
    signer.sign(creds.key.private_key.replace(/\\n/g, '\n')),
  )}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;

  if (!body?.access_token) {
    const unauthorised =
      body?.error === 'unauthorized_client' ||
      (body?.error_description ?? '').toLowerCase().includes('not authorized');
    return {
      error: unauthorised
        ? `The calendar scope is not delegated yet. Google Workspace admin → Security → API ` +
          `controls → Domain-wide delegation → client 106075513985574713179 → add ${scope}.`
        : `Calendar auth failed: ${body?.error_description ?? `http_${res.status}`}`,
      needsScope: unauthorised,
    };
  }

  cached.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return { token: body.access_token };
}

export async function calendarStatus(): Promise<CalendarStatus> {
  if (!credentials()) return { configured: false, authorised: false, reason: 'No service account' };
  const auth = await token(CALENDAR_READ_SCOPE);
  return 'error' in auth
    ? { configured: true, authorised: false, needsScope: auth.needsScope, reason: auth.error }
    : { configured: true, authorised: true };
}

const busySchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
      errors: z.array(z.object({ reason: z.string() })).optional(),
    }),
  ),
});

/** The real thing. Throws only on a network failure; a missing scope is a message. */
export const googleCalendar: CalendarAdapter = {
  async busy(from, to) {
    const auth = await token(CALENDAR_READ_SCOPE);
    if ('error' in auth) throw new Error(auth.error);

    const res = await fetch(`${API}/freeBusy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: 'primary' }],
      }),
    });
    if (!res.ok) throw new Error(`calendar freeBusy: http_${res.status}`);

    const parsed = busySchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('calendar freeBusy: unexpected shape');
    return Object.values(parsed.data.calendars).flatMap((c) =>
      c.busy.map((b) => ({ start: b.start, end: b.end })),
    );
  },

  async createEvent(input) {
    const auth = await token(CALENDAR_SCOPE);
    if ('error' in auth) return { ok: false, error: auth.error, needsScope: auth.needsScope };

    const timeZone = input.timeZone ?? 'Asia/Jerusalem';
    const res = await fetch(
      `${API}/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: input.summary,
          description: input.description ?? '',
          start: { dateTime: input.slot.start, timeZone },
          end: { dateTime: input.slot.end, timeZone },
          attendees: input.attendees.map((email) => ({ email })),
        }),
      },
    );
    const body = (await res.json().catch(() => null)) as
      | { id?: string; htmlLink?: string; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.id) {
      return { ok: false, error: body?.error?.message ?? `http_${res.status}` };
    }
    return { ok: true, eventId: body.id, htmlLink: body.htmlLink };
  },
};

/** For the tests, and for a dry run with no credentials anywhere near it. */
export class FakeCalendar implements CalendarAdapter {
  readonly created: EventInput[] = [];

  constructor(private readonly blocks: Slot[] = []) {}

  async busy(from: Date, to: Date): Promise<Slot[]> {
    return this.blocks.filter(
      (b) => Date.parse(b.end) > from.getTime() && Date.parse(b.start) < to.getTime(),
    );
  }

  async createEvent(input: EventInput): Promise<EventResult> {
    this.created.push(input);
    return { ok: true, eventId: `fake-${this.created.length}`, htmlLink: 'https://example.test/e' };
  }
}
