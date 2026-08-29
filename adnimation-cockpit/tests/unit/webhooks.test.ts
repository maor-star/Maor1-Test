import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  alreadyHandled, idempotencyKey, resetIdempotency, verifyHmacSignature,
} from '@/lib/webhooks/idempotency';

const SECRET = 'test-secret';
const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('verifyHmacSignature', () => {
  const body = '{"event":"taskUpdated","task_id":"abc"}';

  it('accepts a correct signature', () => {
    expect(verifyHmacSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('accepts a sha256= prefixed signature', () => {
    expect(verifyHmacSignature(body, `sha256=${sign(body)}`, SECRET)).toBe(true);
  });

  it('is case insensitive about the hex digest', () => {
    expect(verifyHmacSignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyHmacSignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });

  it('rejects a signature for different content', () => {
    expect(verifyHmacSignature(body, sign('{"tampered":true}'), SECRET)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifyHmacSignature(body, null, SECRET)).toBe(false);
    expect(verifyHmacSignature(body, '', SECRET)).toBe(false);
  });

  it('fails closed when the secret is not configured', () => {
    expect(verifyHmacSignature(body, sign(body), undefined)).toBe(false);
    expect(verifyHmacSignature(body, sign(body), '')).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifyHmacSignature(body, 'not-hex-at-all', SECRET)).toBe(false);
    expect(verifyHmacSignature(body, 'zz'.repeat(32), SECRET)).toBe(false);
  });
});

describe('idempotency', () => {
  beforeEach(() => resetIdempotency());

  it('lets the first delivery through and blocks the redelivery', () => {
    const key = idempotencyKey('clickup', '{"a":1}');
    expect(alreadyHandled(key)).toBe(false);
    expect(alreadyHandled(key)).toBe(true);
  });

  it('treats different payloads as different deliveries', () => {
    expect(alreadyHandled(idempotencyKey('clickup', '{"a":1}'))).toBe(false);
    expect(alreadyHandled(idempotencyKey('clickup', '{"a":2}'))).toBe(false);
  });

  it('namespaces keys by source so two systems cannot collide', () => {
    expect(alreadyHandled(idempotencyKey('clickup', 'same'))).toBe(false);
    expect(alreadyHandled(idempotencyKey('slack', 'same'))).toBe(false);
  });

  it('forgets a key once the TTL has passed', () => {
    const key = idempotencyKey('clickup', '{"a":1}');
    const t0 = Date.now();
    expect(alreadyHandled(key, t0)).toBe(false);
    expect(alreadyHandled(key, t0 + 11 * 60 * 1000)).toBe(false);
  });
});
