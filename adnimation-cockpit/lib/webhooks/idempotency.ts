import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * CLAUDE.md §10 — Gmail, Calendly and Slack all redeliver, so every webhook
 * handler needs an idempotency key.
 *
 * DECISION: keys live in-process with a TTL rather than in the database. A
 * missed dedupe costs one redundant upsert (all our handlers are idempotent
 * anyway); a database round-trip on every webhook costs latency on the hot
 * path. Revisit if a handler ever gains a non-idempotent side effect, or when
 * the app runs on more than one instance.
 */
const seen = new Map<string, number>();
const TTL_MS = 10 * 60 * 1000;

export function idempotencyKey(source: string, payload: string): string {
  return `${source}:${createHash('sha256').update(payload).digest('hex')}`;
}

export function alreadyHandled(key: string, now = Date.now()): boolean {
  for (const [k, ts] of seen) if (now - ts > TTL_MS) seen.delete(k);
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

/** Clears the dedupe cache. Tests only. */
export function resetIdempotency(): void {
  seen.clear();
}

/**
 * Constant-time HMAC-SHA256 verification, shared by every signed webhook.
 * Returns false rather than throwing on a malformed signature.
 */
export function verifyHmacSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signature.trim().toLowerCase().replace(/^sha256=/, '');
  if (given.length !== expected.length) return false;
  if (!/^[0-9a-f]+$/.test(given)) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
  } catch {
    return false;
  }
}
