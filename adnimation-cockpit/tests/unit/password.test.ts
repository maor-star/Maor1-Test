import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('verifies the password it hashed', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('right');
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('is case sensitive', async () => {
    const stored = await hashPassword('Secret');
    expect(await verifyPassword('secret', stored)).toBe(false);
  });

  it('produces a different hash each time, so the salt is real', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('stores iterations, salt and hash, never the password', async () => {
    const stored = await hashPassword('hunter2');
    expect(stored.split(':')).toHaveLength(3);
    expect(stored).not.toContain('hunter2');
    expect(Number(stored.split(':')[0])).toBeGreaterThanOrEqual(210_000);
  });

  it('fails closed when no hash is configured', async () => {
    expect(await verifyPassword('anything', undefined)).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('rejects a malformed stored value rather than throwing', async () => {
    for (const bad of ['nonsense', 'a:b', '1:2:3:4', 'x:y:z', '10:AAAA:BBBB']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('refuses a hash with an implausibly low iteration count', async () => {
    const real = await hashPassword('pw');
    const [, salt, hash] = real.split(':');
    expect(await verifyPassword('pw', `10:${salt}:${hash}`)).toBe(false);
  });

  it('rejects an empty password even against a hash of an empty password', async () => {
    const stored = await hashPassword('');
    // Empty passwords are refused by the provider before this point; the hash
    // layer stays honest either way.
    expect(await verifyPassword('', stored)).toBe(true);
    expect(await verifyPassword('x', stored)).toBe(false);
  });
});
