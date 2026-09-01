// אימות בסביבת Workers: אין node:crypto, אז הכל נשען על WebCrypto.
// סיסמאות: PBKDF2-SHA256 (במקום scrypt, שאינו זמין ב-runtime).
// סשן: עוגייה חתומה ב-HMAC-SHA256.

const PBKDF2_ITERATIONS = 100_000;
const KEY_BITS = 256;
export const COOKIE_NAME = 'ewl_session';
const MAX_AGE_DAYS = 30;

const encoder = new TextEncoder();
const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array((hex.match(/.{2}/g) || []).map((b) => parseInt(b, 16)));

const b64url = {
  encode: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (text) => {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  },
};

/** Constant-time comparison; WebCrypto has no timingSafeEqual. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS);
}

export async function hashPassword(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(plain, stored) {
  const [scheme, iterations, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const bits = await deriveBits(plain, fromHex(saltHex), Number(iterations) || PBKDF2_ITERATIONS);
  return timingSafeEqual(new Uint8Array(bits), fromHex(hashHex));
}

// ---- Signed session cookie ----
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(secret, payload) {
  const body = b64url.encode(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${b64url.encode(mac)}`;
}

export async function verifySession(secret, token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64url.decode(mac), encoder.encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64url.decode(body)));
    return payload.exp && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export const sessionMaxAge = MAX_AGE_DAYS * 24 * 60 * 60;
export const sessionExpiry = () => Date.now() + sessionMaxAge * 1000;

/** Strips the password hash before a profile row is sent to the browser. */
export function publicProfile(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}
