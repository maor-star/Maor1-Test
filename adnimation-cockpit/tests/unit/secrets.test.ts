import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hintOf } from '@/lib/secrets/store';
// @ts-expect-error — the job copy is plain ESM with no types.
import { decrypt as jobDecrypt } from '@/deploy/job-secrets.mjs';
import { SECRETS, SECRET_KEYS, specFor } from '@/lib/secrets/catalogue';

/**
 * The keys he pastes in.
 *
 * Two promises worth testing. A value survives the round trip through
 * encryption unchanged — including the non-ASCII a token can contain. And the
 * app and the jobs agree, byte for byte, about how a stored value is read:
 * they are separate implementations because the jobs run outside the compiled
 * app, and a key that reaches one and not the other is worse than no key,
 * because the screen says it is set.
 */

const SECRET = 'test-auth-secret-for-the-suite';

describe('a value, encrypted and read back', () => {
  it('comes back exactly as it went in', () => {
    process.env.AUTH_SECRET = SECRET;
    for (const value of ['sk-abc123', 'AIzaSyD-very-long-key_with-dashes', 'urn:li:person:XyZ', 'שלום', 'a'.repeat(4000)]) {
      expect(decrypt(encrypt(value))).toBe(value);
    }
  });

  it('is different every time, so two identical keys do not look identical at rest', () => {
    process.env.AUTH_SECRET = SECRET;
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('will not decrypt under a different AUTH_SECRET', () => {
    process.env.AUTH_SECRET = SECRET;
    const stored = encrypt('sk-abc123');
    process.env.AUTH_SECRET = 'a-different-secret';
    expect(decrypt(stored)).toBeNull();
    process.env.AUTH_SECRET = SECRET;
  });

  it('treats a mangled value as absent rather than throwing', () => {
    process.env.AUTH_SECRET = SECRET;
    expect(decrypt('nonsense')).toBeNull();
    expect(decrypt('a:b:c')).toBeNull();
    expect(decrypt('')).toBeNull();
  });
});

describe('the app and the jobs agree', () => {
  it('reads what the app wrote, from the job side', () => {
    process.env.AUTH_SECRET = SECRET;
    for (const value of ['sk-abc123', 'AIza-x_y-z', 'שלום']) {
      expect(jobDecrypt(encrypt(value), SECRET)).toBe(value);
    }
  });

  it('refuses the same things the app refuses', () => {
    expect(jobDecrypt('nonsense', SECRET)).toBeNull();
    expect(jobDecrypt(encrypt('x'), 'wrong-secret')).toBeNull();
  });
});

describe('what he is shown instead of the value', () => {
  it('is the last four characters, and never more', () => {
    expect(hintOf('sk-abcdef1234')).toBe('••••1234');
    expect(hintOf('sk-abcdef1234')).not.toContain('abcdef');
  });

  it('shows nothing at all of a value too short to hide', () => {
    expect(hintOf('abc')).toBe('••••');
  });
});

describe('the catalogue', () => {
  it('says what every key unlocks and where it comes from', () => {
    for (const s of SECRETS) {
      expect(s.unlocks.length, s.key).toBeGreaterThan(20);
      expect(s.where.length, s.key).toBeGreaterThan(10);
    }
  });

  it('has no duplicate keys, since one would silently shadow the other', () => {
    expect(new Set(SECRET_KEYS).size).toBe(SECRET_KEYS.length);
  });

  it('finds a key it declares and nothing it does not', () => {
    expect(specFor('GEMINI_API_KEY')?.group).toBe('models');
    expect(specFor('DATABASE_URL')).toBeNull();
  });
});
