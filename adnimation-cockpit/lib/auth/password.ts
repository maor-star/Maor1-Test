/**
 * Password sign-in for the single owner account.
 *
 * PBKDF2-SHA256 via Web Crypto, so the same code runs in the Node runtime and
 * at the edge — the Auth.js config is shared between the two.
 *
 * The password itself never appears in this repository or in the database. The
 * server holds `OWNER_PASSWORD_HASH` as `iterations:salt:hash` (base64) in its
 * environment file; `npm run hash-password` produces that string.
 */

const ITERATIONS = 210_000; // OWASP guidance for PBKDF2-SHA256
const KEY_BYTES = 32;
const SALT_BYTES = 16;

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Produces the `iterations:salt:hash` string stored in the environment. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${ITERATIONS}:${b64(salt)}:${b64(hash)}`;
}

/** Constant-time comparison, so a wrong password leaks nothing by timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false; // No hash configured: nobody gets in.
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [iterRaw, saltRaw, hashRaw] = parts as [string, string, string];
  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;

  try {
    const expected = unb64(hashRaw);
    const actual = await derive(password, unb64(saltRaw), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
