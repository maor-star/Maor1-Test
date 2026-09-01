import crypto from 'crypto';
import db from './db.js';

const SECRET = process.env.SESSION_SECRET || 'easy-weight-loss-dev-secret';
const COOKIE = 'ewl_session';
const MAX_AGE_DAYS = 30;

// ---- Password hashing (scrypt, no external dependency) ----
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return attempt.length === expected.length && crypto.timingSafeEqual(attempt, expected);
}

// ---- Signed session cookie ----
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

export function startSession(res, user) {
  const exp = Date.now() + MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const token = sign({ uid: user.id, exp });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIES === 'true',
    maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function endSession(res) {
  res.clearCookie(COOKIE);
}

/** Attaches `req.user` (the full profile row) when a valid session cookie is present. */
export function attachUser(req, res, next) {
  const payload = unsign(parseCookies(req.headers.cookie)[COOKIE]);
  req.user = payload
    ? db.prepare('SELECT * FROM profiles WHERE id = ? AND active = 1').get(payload.uid) || null
    : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'נדרשת התחברות' });
  next();
}

/** Strips secrets before a profile is sent to the browser. */
export function publicProfile(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}
