const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const s3 = new S3Client({});
const BUCKET = process.env.BUCKET;
const SECRET = process.env.AUTH_SECRET || 'change-me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'maor@adnimation.com').toLowerCase();
const HOUSEHOLD_CODE = process.env.HOUSEHOLD_CODE || 'bait-home-7c3f9a1e5b2d4680c1a94f28d6';
// Stored under the data/ prefix because the function role's write permission
// is scoped to data/* (avoids an IAM change).
const USERS_KEY = 'data/__auth_users__.json';
const dataKeyFor = (code) => 'data/' + crypto.createHash('sha256').update('v1|' + String(code)).digest('hex') + '.json';

const resp = (status, body) => ({
  statusCode: status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  },
  body: JSON.stringify(body),
});

// ---------- S3 helpers ----------
async function getJson(key, fallback) {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return JSON.parse(await out.Body.transformToString());
  } catch (e) {
    // Object missing: with GetObject-but-not-ListBucket, S3 answers 403 for a
    // non-existent key instead of 404. The role provably has GetObject, so
    // treat both as "not there yet".
    const code = e.$metadata?.httpStatusCode;
    if (e.name === 'NoSuchKey' || e.name === 'AccessDenied' || code === 404 || code === 403) return fallback;
    throw e;
  }
}
async function putJson(key, obj) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(obj), ContentType: 'application/json' }));
}

// ---------- passwords & tokens ----------
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (str) => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function makeToken(user) {
  const payload = { e: user.email, r: user.role, exp: Date.now() + 30 * 24 * 3600 * 1000 };
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(p).digest());
  return p + '.' + sig;
}
function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(parts[0]).digest());
  const a = Buffer.from(parts[1]); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload; try { payload = JSON.parse(b64urlDecode(parts[0]).toString()); } catch (e) { return null; }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload; // { e, r, exp }
}
const publicUser = (u) => ({ email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt });
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));

// ---------- auth actions ----------
async function loadUsers() { const d = await getJson(USERS_KEY, { users: [] }); if (!Array.isArray(d.users)) d.users = []; return d; }
async function currentUserFrom(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  if (!payload) return null;
  const db = await loadUsers();
  const u = db.users.find((x) => x.email === String(payload.e).toLowerCase());
  if (!u) return null;
  if (u.status !== 'approved' && u.role !== 'admin') return null;
  return u;
}

function readBody(event) {
  let raw = event.body || '{}';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(raw || '{}');
}
async function handleAuth(action, event) {
  let body = {};
  try { body = readBody(event); } catch (e) { return resp(400, { error: 'bad json' }); }

  if (action === 'register') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 80);
    const password = String(body.password || '');
    if (!validEmail(email)) return resp(400, { error: 'אימייל לא תקין' });
    if (!name) return resp(400, { error: 'נא להזין שם' });
    if (password.length < 6) return resp(400, { error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
    const db = await loadUsers();
    if (db.users.some((u) => u.email === email)) return resp(409, { error: 'אימייל זה כבר רשום' });
    const salt = crypto.randomBytes(16).toString('hex');
    const isAdmin = email === ADMIN_EMAIL;
    const user = { email, name, salt, passHash: hashPassword(password, salt),
      status: isAdmin ? 'approved' : 'pending', role: isAdmin ? 'admin' : 'user', createdAt: Date.now() };
    db.users.push(user);
    await putJson(USERS_KEY, db);
    if (isAdmin) return resp(200, { ok: true, token: makeToken(user), user: publicUser(user) });
    return resp(200, { ok: true, pending: true });
  }

  if (action === 'login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const db = await loadUsers();
    const u = db.users.find((x) => x.email === email);
    if (!u) return resp(401, { error: 'אימייל או סיסמה שגויים' });
    const calc = hashPassword(password, u.salt);
    const ok = u.passHash.length === calc.length && crypto.timingSafeEqual(Buffer.from(u.passHash), Buffer.from(calc));
    if (!ok) return resp(401, { error: 'אימייל או סיסמה שגויים' });
    if (u.role !== 'admin' && u.status === 'pending') return resp(403, { error: 'pending', status: 'pending' });
    if (u.role !== 'admin' && u.status === 'rejected') return resp(403, { error: 'rejected', status: 'rejected' });
    return resp(200, { ok: true, token: makeToken(u), user: publicUser(u) });
  }

  if (action === 'me') {
    const u = await currentUserFrom(event);
    if (!u) return resp(401, { error: 'unauthorized' });
    return resp(200, { ok: true, user: publicUser(u) });
  }

  if (action === 'users') {
    const u = await currentUserFrom(event);
    if (!u || u.role !== 'admin') return resp(403, { error: 'forbidden' });
    const db = await loadUsers();
    return resp(200, { ok: true, users: db.users.map(publicUser).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) });
  }

  if (action === 'approve') {
    const admin = await currentUserFrom(event);
    if (!admin || admin.role !== 'admin') return resp(403, { error: 'forbidden' });
    const email = String(body.email || '').trim().toLowerCase();
    const status = String(body.status || '');
    if (!['approved', 'rejected', 'pending'].includes(status)) return resp(400, { error: 'bad status' });
    const db = await loadUsers();
    const u = db.users.find((x) => x.email === email);
    if (!u) return resp(404, { error: 'not found' });
    if (u.email === ADMIN_EMAIL) return resp(400, { error: 'לא ניתן לשנות את המנהל' });
    u.status = status;
    await putJson(USERS_KEY, db);
    return resp(200, { ok: true, user: publicUser(u) });
  }

  if (action === 'remove') {
    const admin = await currentUserFrom(event);
    if (!admin || admin.role !== 'admin') return resp(403, { error: 'forbidden' });
    const email = String(body.email || '').trim().toLowerCase();
    if (email === ADMIN_EMAIL) return resp(400, { error: 'לא ניתן למחוק את המנהל' });
    const db = await loadUsers();
    const before = db.users.length;
    db.users = db.users.filter((x) => x.email !== email);
    if (db.users.length === before) return resp(404, { error: 'not found' });
    await putJson(USERS_KEY, db);
    return resp(200, { ok: true });
  }

  return resp(404, { error: 'unknown action' });
}

// ---------- data (gated by approved-user token) ----------
async function handleData(method, event) {
  const u = await currentUserFrom(event);
  if (!u) return resp(401, { error: 'unauthorized' });
  const key = dataKeyFor(HOUSEHOLD_CODE);
  if (method === 'GET') {
    const stored = await getJson(key, { data: null, updatedAt: 0 });
    return resp(200, stored);
  }
  if (method === 'PUT' || method === 'POST') {
    let body = {};
    try { body = readBody(event); } catch (e) { return resp(400, { error: 'bad json' }); }
    const updatedAt = Date.now();
    await putJson(key, { data: body.data, updatedAt });
    return resp(200, { ok: true, updatedAt });
  }
  return resp(405, { error: 'method not allowed' });
}

exports.handler = async (event) => {
  const http = (event.requestContext && event.requestContext.http) || {};
  const method = http.method || 'GET';
  const path = event.rawPath || http.path || '/';
  if (method === 'OPTIONS') return resp(200, { ok: true });
  try {
    const authMatch = path.match(/\/auth\/([a-z]+)\/?$/i);
    if (authMatch) return await handleAuth(authMatch[1].toLowerCase(), event);
    if (/\/data\/?$/.test(path)) return await handleData(method, event);
    return resp(404, { error: 'not found' });
  } catch (e) {
    return resp(500, { error: e.message });
  }
};
