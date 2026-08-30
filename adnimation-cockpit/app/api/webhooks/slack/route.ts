import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { captureSlackReaction } from '@/lib/opportunities/slack-capture';

/**
 * Slack events — capture an opportunity by reacting to a message.
 *
 * He adds the agreed emoji to any Slack message and it lands in the
 * opportunities list with its text and a link back. That is the only capture
 * path that costs nothing at the moment he notices something, which is the
 * moment that decides whether it gets captured at all.
 *
 * It is off until SLACK_SIGNING_SECRET is set. Without the secret a request
 * cannot be proven to have come from Slack, and an unauthenticated endpoint
 * that writes rows is a hole — so the absence of the secret disables the
 * route rather than skipping the check.
 *
 * Setup, once:
 *   1. Slack app → Basic Information → copy the Signing Secret.
 *   2. Event Subscriptions → on → Request URL:
 *      https://cockpit.wonderfool.xyz/api/webhooks/slack
 *      (Slack sends a url_verification challenge, which this answers.)
 *   3. Subscribe to bot events: reaction_added.
 *   4. Reinstall the app.
 *
 * The bot already holds reactions:read and the history scopes, so no new
 * permissions are needed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The emoji that means "this is an opportunity". */
const CAPTURE_EMOJI = (process.env.SLACK_CAPTURE_EMOJI ?? 'bulb')
  .split(',')
  .map((s) => s.trim().replace(/:/g, ''))
  .filter(Boolean);

/** Slack retries aggressively; anything older than this is a redelivery. */
const MAX_SKEW_SECONDS = 60 * 5;

function verify(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  // A replayed request with a valid signature is still a replay.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS) return false;

  const expected = `v0=${createHmac('sha256', secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on a length mismatch, which is itself a difference.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.SLACK_SIGNING_SECRET) {
    // Deliberately not 401: nothing is wrong with the request, the feature is
    // simply not switched on yet.
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  if (
    !verify(
      rawBody,
      request.headers.get('x-slack-request-timestamp'),
      request.headers.get('x-slack-signature'),
    )
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: {
    type?: string;
    challenge?: string;
    event?: {
      type?: string;
      reaction?: string;
      user?: string;
      item?: { type?: string; channel?: string; ts?: string };
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Slack proves it owns the URL by asking for the challenge back.
  if (payload.type === 'url_verification' && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const event = payload.event;
  if (
    event?.type === 'reaction_added' &&
    event.reaction &&
    CAPTURE_EMOJI.includes(event.reaction) &&
    event.item?.type === 'message' &&
    event.item.channel &&
    event.item.ts
  ) {
    // Slack treats a slow reply as a failure and redelivers, so the capture
    // runs after the response rather than before it. captureSlackPermalink
    // upserts on (source, source_ref), so a redelivery cannot duplicate.
    const { channel, ts } = event.item;
    void captureSlackReaction(channel, ts, event.user ?? 'slack').catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
