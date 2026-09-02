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
    // בקרת גרסאות אופטימית: אם הלקוח שלח baseUpdatedAt והענן חדש ממנו — דוחים כדי לא לדרוס נתונים חדשים יותר.
    if (body.baseUpdatedAt != null) {
      const cur = await getJson(key, { updatedAt: 0 });
      if ((cur.updatedAt || 0) > Number(body.baseUpdatedAt)) {
        return resp(409, { conflict: true, data: cur.data, updatedAt: cur.updatedAt || 0 });
      }
    }
    const updatedAt = Date.now();
    await putJson(key, { data: body.data, updatedAt });
    return resp(200, { ok: true, updatedAt });
  }
  return resp(405, { error: 'method not allowed' });
}

// ---------- Open Finance (חיבור חי לבנק ולכרטיסי האשראי) ----------
// המפתחות (clientId/clientSecret) נשמרים אך ורק כאן בשרת (S3, תחת data/) ולעולם לא נשלחים לדפדפן.
const OF_AUTH = 'https://api.open-finance.ai/oauth';
const OF_API = 'https://api.open-finance.ai/v2';
const OF_CONFIG_KEY = 'data/__of_config__.json';
const OF_PROVIDER_HE = { isracard: 'ישראכרט', americanExpress: 'אמריקן אקספרס', cal: 'כאל', max: 'מקס',
  leumi: 'בנק לאומי', hapoalim: 'בנק הפועלים', discount: 'בנק דיסקונט', mizrahi: 'מזרחי טפחות', beinleumi: 'הבינלאומי',
  mercantile: 'מרכנתיל', yahav: 'בנק יהב', pagi: 'פאגי', otsarHahayal: 'אוצר החייל', masad: 'מסד', ubank: 'יובנק',
  pepper: 'פפר', 'one-zero': 'וואן זירו', jerusalem: 'בנק ירושלים', union: 'בנק איגוד', digiBank: 'דיגיבנק',
  'open-finance': 'בנק לדוגמה (סנדבוקס)', 'open-finance-card': 'כרטיס לדוגמה (סנדבוקס)' };
const OF_CARD_PROVIDERS = new Set(['isracard', 'americanExpress', 'cal', 'max', 'open-finance-card']);
const ofProvKey = (id) => String(id || '').replace(/-sandbox$/, '');
const ofProvName = (id) => OF_PROVIDER_HE[ofProvKey(id)] || ofProvKey(id) || '—';
const INCOME_MAINS = new Set(['SALARY', 'PENSION', 'REIMBURSEMENTS', 'BENEFITS']);
// כרטיס שמגיע דרך הבנק (למשל מסטרקארד של הפועלים): שם החברה המנפיקה — כדי שהחיוב המרוכז בבנק («ישראכרט») יזוהה כמכוסה ע"י הפירוט
const BANK_CARD_ISSUER = { hapoalim: 'ישראכרט', mizrahi: 'ישראכרט', leumi: 'מקס', discount: 'כאל', beinleumi: 'כאל', mercantile: 'כאל', yahav: 'ישראכרט', pagi: 'כאל', otsarHahayal: 'כאל', masad: 'כאל' };
function cardIssuerName(providerId, number, product) {
  const key = ofProvKey(providerId);
  if (OF_CARD_PROVIDERS.has(key)) return ofProvName(key);
  const n = String(number || '').replace(/\D/g, '');
  if (/^3[47]/.test(n)) return 'אמריקן אקספרס';
  const p = String(product || '');
  if (/דיינרס|diners/i.test(p)) return 'דיינרס';
  return BANK_CARD_ISSUER[key] || 'כרטיס אשראי';
}

async function ofLoadConfig() { const c = await getJson(OF_CONFIG_KEY, null); return c && typeof c === 'object' ? c : null; }
const ofMask = (c) => c ? {
  configured: !!(c.clientId && c.clientSecret && c.userId), userId: c.userId || '',
  clientId: c.clientId ? c.clientId.slice(0, 4) + '••••••••' + c.clientId.slice(-4) : '', hasSecret: !!c.clientSecret,
  lastSync: c.lastSync || null, updatedAt: c.updatedAt || null, autoSync: c.autoSync !== false,
} : { configured: false, autoSync: true };

async function ofFetch(url, opts) {
  const r = await fetch(url, opts);
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) {
    let msg = (j && (j.message || j.error)) || txt.slice(0, 200);
    if (r.status === 401) msg = 'המפתחות נדחו ע"י Open Finance (401) — בדקו Client ID / Client Secret / User ID';
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return j;
}
async function ofToken(cfg) {
  const j = await ofFetch(OF_AUTH + '/token', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: cfg.userId, clientId: cfg.clientId, clientSecret: cfg.clientSecret }) });
  if (!j || !j.accessToken) throw new Error('לא התקבל טוקן מ-Open Finance');
  return j.accessToken;
}
async function ofGetAll(token, path, params) {
  const items = []; let next = null;
  for (let i = 0; i < 80; i++) {
    const u = new URL(OF_API + path);
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v)); });
    if (next) u.searchParams.set('nextPage', next);
    const j = await ofFetch(u.toString(), { headers: { authorization: 'Bearer ' + token } });
    const arr = Array.isArray(j) ? j : (j && j.items) || [];
    items.push(...arr);
    next = Array.isArray(j) ? null : (j && j.nextPage) || null;
    if (!next || !arr.length) break;
  }
  return items;
}
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
function ofAccountView(a) {
  const isCard = String(a.accountType || '').toUpperCase() === 'CARD' || OF_CARD_PROVIDERS.has(ofProvKey(a.providerId));
  // יתרות בפורמט PSD2: {balanceType, balanceAmount:{amount,currency}, referenceDate} — לוקחים את העדכנית ביותר
  const bal = (a.balances || []).map((b) => ({ type: b.balanceType || '', amount: Number((b.balanceAmount && b.balanceAmount.amount) != null ? b.balanceAmount.amount : b.amount), currency: (b.balanceAmount && b.balanceAmount.currency) || b.currency || 'ILS', date: b.referenceDate || '' }))
    .filter((b) => !isNaN(b.amount)).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const lim = a.creditLimit && typeof a.creditLimit === 'object' ? Number(a.creditLimit.amount) : Number(a.creditLimit);
  return { id: a.id, connectionId: a.connectionId, providerId: a.providerId, provider: ofProvName(a.providerId), type: isCard ? 'CARD' : (String(a.accountType || 'CHECKING').toUpperCase()),
    issuer: isCard ? cardIssuerName(a.providerId, a.accountNumber, a.product || a.accountName) : null,
    name: a.accountName || '', product: a.product || '', number: a.accountNumber ? String(a.accountNumber).slice(-4) : '', fullNumber: a.accountNumber || '', currency: a.currency || 'ILS', balances: bal, balance: bal.length ? bal[0].amount : null,
    creditLimit: lim > 0 ? lim : null, dueDate: a.cardDueDate || null, txCount: a.transactions || null, status: a.status || a.creditStatus || '', loanType: a.loanType || null,
    interest: Array.isArray(a.interest) ? a.interest.map((i) => ({ type: i.type, rate: (i.rate || []).map((r) => Number(r.percentage)).filter((n) => !isNaN(n)) })) : [], endDate: a.relatedDates && a.relatedDates.contractEndDate || null };
}
function ofConnectionView(c) {
  return { id: c.id, providerId: c.providerId, provider: ofProvName(c.providerId), status: c.status, mode: c.mode, expiryDate: c.expiryDate || null,
    accounts: c.accounts || 0, cards: c.cards || 0, savings: c.savings || 0, loans: c.loans || 0, transactions: c.transactions || 0,
    lastFetched: c.lastFetchedDataDate || (c.refreshSettings && c.refreshSettings.lastFetchedDataDate) || null, refresh: !!(c.refreshSettings && c.refreshSettings.refreshData),
    error: c.error && (c.error.message || c.error.type) || null, scaOAuth: c.scaOAuth || null, createdAt: c.createdAt || null };
}
// נרמול עסקה של Open Finance לשורה שהאפליקציה מייבאת (אותו פורמט של ייבוא קובץ — כך הסינון-מכפילויות אחיד)
function ofNormalize(tx, acctMap, debitPositive) {
  const acc = acctMap[tx.accountId] || null;
  const isCard = acc ? acc.type === 'CARD' : OF_CARD_PROVIDERS.has(ofProvKey(tx.providerId));
  const amtObj = tx.amount || {};
  const amt = Number((amtObj.chargedAmount && amtObj.chargedAmount.amount != null) ? amtObj.chargedAmount.amount : (amtObj.originalAmount && amtObj.originalAmount.amount)) || 0;
  const cur = (amtObj.chargedAmount && amtObj.chargedAmount.currency) || (amtObj.originalAmount && amtObj.originalAmount.currency) || 'ILS';
  const d = tx.date || {};
  const date = String(d.transactionDate || d.bookingDate || d.valueDate || '').slice(0, 10);
  const desc = (tx.description && (tx.description.description || tx.description.additionalInfo)) || tx.details || '';
  const merchant = (tx.merchantName || desc || '').trim();
  const cat = tx.changedCategory && tx.changedCategory.main ? tx.changedCategory : (tx.category || {});
  const clsType = String((tx.changedClassification && tx.changedClassification.type) || (tx.classification && tx.classification.type) || '').toUpperCase();
  let kind;
  if (isCard) kind = amt < 0 ? 'expense' : 'income';                       // כרטיס (נבדק מול הנתונים): חיוב שלילי, זיכוי חיובי
  else if (debitPositive) kind = amt > 0 ? 'expense' : 'income';            // בנק שמציג חיובים כמספר חיובי
  else kind = amt < 0 ? 'expense' : 'income';                               // PSD2: חובה שלילי, זכות חיובי
  // הסיווג של Open Finance (VARIABLE_EXPENSE / FIXED_INCOME וכו') הוא המקור האמין ביותר לכיוון התנועה
  if (/EXPENSE/.test(clsType)) kind = 'expense'; else if (/INCOME/.test(clsType)) kind = 'income';
  else if (INCOME_MAINS.has(String(cat.main || '').toUpperCase())) kind = 'income';
  const provider = ofProvName(tx.providerId || (acc && acc.providerId));
  // כרטיס: שם החברה המנפיקה (+4 ספרות אחרונות להבחנה בין כרטיסים); עו"ש: שם הבנק
  const issuer = isCard ? ((acc && acc.issuer) || cardIssuerName(tx.providerId, tx.accountNumber, '')) : null;
  const last4 = isCard ? String(tx.accountNumber || (acc && acc.fullNumber) || '').replace(/\D/g, '').slice(-4) : '';
  const account = isCard ? (issuer + (last4 ? ' ••' + last4 : '')) : ('עו"ש ' + provider);
  return { date, merchant, description: desc, amount: Math.abs(amt), currency: cur, kind,
    ref: String(tx.transactionProviderIdentifier || tx.entryReference || tx.id || ''), of_id: String(tx.id || tx.SK || ''),
    source: isCard ? 'credit_card' : 'bank', account, provider, accountId: tx.accountId || '', accountType: isCard ? 'CARD' : ((acc && acc.type) || 'CHECKING'),
    of_cat: cat.main ? { main: cat.main, sub: cat.sub || '' } : null, status: tx.status || '',
    installments: tx.installments && tx.installments.total ? { n: tx.installments.number, total: tx.installments.total } : null, raw_amount: amt };
}
async function handleOF(action, event) {
  const u = await currentUserFrom(event);
  if (!u) return resp(401, { error: 'unauthorized' });
  let body = {};
  try { body = readBody(event); } catch (e) { return resp(400, { error: 'bad json' }); }
  const isAdmin = u.role === 'admin';
  const cfg = await ofLoadConfig();

  if (action === 'config') {
    if (!isAdmin) return resp(403, { error: 'רק המנהל יכול לעדכן את מפתחות ה-API' });
    const next = Object.assign({}, cfg || {});
    if (body.userId !== undefined) next.userId = String(body.userId || '').trim();
    if (body.clientId !== undefined) next.clientId = String(body.clientId || '').trim();
    if (body.clientSecret !== undefined && String(body.clientSecret || '').trim() !== '') next.clientSecret = String(body.clientSecret).trim(); // ריק = לא לשנות
    if (body.autoSync !== undefined) next.autoSync = !!body.autoSync;
    if (body.clear === true) { await putJson(OF_CONFIG_KEY, {}); return resp(200, { ok: true, config: ofMask(null) }); }
    if (!next.userId || !next.clientId || !next.clientSecret) return resp(400, { error: 'יש למלא User ID, Client ID ו-Client Secret' });
    // אימות מיידי מול Open Finance — כדי שהמנהל ידע שהמפתחות תקינים
    let verified = false, verifyError = null;
    try { await ofToken(next); verified = true; } catch (e) { verifyError = e.message; }
    if (!verified) return resp(400, { error: 'המפתחות לא אומתו: ' + verifyError });
    next.updatedAt = Date.now();
    await putJson(OF_CONFIG_KEY, next);
    return resp(200, { ok: true, config: ofMask(next) });
  }

  if (action === 'status') {
    if (!cfg || !cfg.clientId || !cfg.clientSecret || !cfg.userId) return resp(200, { ok: true, config: ofMask(cfg), connections: [], accounts: [] });
    try {
      const token = await ofToken(cfg);
      const [conns, accts] = await Promise.all([ofGetAll(token, '/connections', { limit: 100 }), ofGetAll(token, '/data/accounts', { limit: 200 })]);
      return resp(200, { ok: true, config: ofMask(cfg), connections: conns.map(ofConnectionView), accounts: accts.map(ofAccountView) });
    } catch (e) { return resp(200, { ok: false, error: e.message, config: ofMask(cfg), connections: [], accounts: [] }); }
  }

  if (action === 'connect') { // יצירת חיבור חדש → כתובת מסע ההסכמה (המשתמש מאשר בבנק)
    if (!isAdmin) return resp(403, { error: 'רק המנהל יכול לחבר בנק/כרטיס' });
    if (!cfg || !cfg.clientSecret) return resp(400, { error: 'יש להגדיר תחילה את מפתחות ה-API' });
    const token = await ofToken(cfg);
    const start = new Date(); start.setMonth(start.getMonth() - 18);
    const payload = { language: 'he', refreshData: true, startDate: isoDay(start), connectionMode: 'PSD2' };
    if (body.redirectUrl) payload.redirectUrl = String(body.redirectUrl);
    if (Array.isArray(body.providerIds) && body.providerIds.length) payload.providerIds = body.providerIds;
    if (body.includeFakeProviders) payload.includeFakeProviders = true;
    const j = await ofFetch(OF_API + '/connections', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(payload) });
    const url = j && (j.scaOAuth || j.url || j.link || (j.connection && j.connection.scaOAuth));
    return resp(200, { ok: true, url: url || null, connection: j && j.id ? ofConnectionView(j) : (j || null) });
  }

  if (action === 'refresh') { // בקשה מ-Open Finance למשוך נתונים טריים מכל החיבורים
    if (!cfg || !cfg.clientSecret) return resp(400, { error: 'יש להגדיר תחילה את מפתחות ה-API' });
    const token = await ofToken(cfg);
    const r = await fetch(OF_API + '/connections/' + encodeURIComponent(cfg.userId) + '/refresh', { headers: { authorization: 'Bearer ' + token } });
    return resp(200, { ok: r.ok || r.status === 204, status: r.status });
  }

  if (action === 'sync') { // משיכת כל העסקאות (מנורמלות) — הקליינט מייבא אותן עם סינון כפילויות
    if (!cfg || !cfg.clientId || !cfg.clientSecret || !cfg.userId) return resp(400, { error: 'החיבור לבנק עדיין לא הוגדר (מפתחות API)' });
    const token = await ofToken(cfg);
    const since = new Date(); since.setMonth(since.getMonth() - 18);
    let dateFrom = body.dateFrom ? String(body.dateFrom).slice(0, 10) : null;
    if (!dateFrom) { if (cfg.lastSync) { const d = new Date(cfg.lastSync); d.setDate(d.getDate() - 60); dateFrom = isoDay(d); } else dateFrom = isoDay(since); }
    if (body.full) dateFrom = isoDay(since);
    // הקליינט מסנכרן בחלונות זמן (חודשיים כל פעם) כדי להישאר בתוך מגבלת 30 השניות של API Gateway
    const dateTo = body.dateTo ? String(body.dateTo).slice(0, 10) : isoDay(new Date(Date.now() + 86400000));
    const accts = (await ofGetAll(token, '/data/accounts', { limit: 200 })).map(ofAccountView);
    const acctMap = {}; accts.forEach((a) => { acctMap[a.id] = a; });
    const raw = await ofGetAll(token, '/data/transactions', { dateFrom, dateTo, sort: 1, includeDuplicates: 0 });
    // זיהוי אוטומטי של מוסכמת הסימן בבנק: אם עסקאות עו"ש שסווגו ע"י Open Finance כהוצאה מופיעות בעיקר כמספר חיובי — הבנק מציג חיובים כחיובי
    let pos = 0, neg = 0;
    raw.forEach((t) => { const acc = acctMap[t.accountId]; const isCard = acc ? acc.type === 'CARD' : OF_CARD_PROVIDERS.has(ofProvKey(t.providerId)); if (isCard) return;
      const main = String((t.category && t.category.main) || '').toUpperCase(); if (!main || INCOME_MAINS.has(main) || main === 'OTHER' || main === 'FINANCE') return;
      const a = Number(t.amount && t.amount.chargedAmount && t.amount.chargedAmount.amount); if (a > 0) pos++; else if (a < 0) neg++; });
    const debitPositive = cfg.debitPositive != null ? !!cfg.debitPositive : (pos > neg * 2);
    // מייבאים רק עו"ש וכרטיסי אשראי (לא ני"ע / פיקדונות / הלוואות — תשלומי המשכנתא ממילא מופיעים בעו"ש)
    const wantedType = (t) => { const ty = String(t.type || '').toUpperCase(); if (ty === 'CHECKING' || ty === 'CARD') return true; if (ty === 'SECURITIES' || ty === 'LOAN' || ty === 'SAVINGS') return false; const acc = acctMap[t.accountId]; return !acc || acc.type === 'CARD' || acc.type === 'CHECKING'; };
    const rows = raw.filter((t) => wantedType(t) && !t.isDuplicate && String(t.status || '').toUpperCase() !== 'DELETED').map((t) => ofNormalize(t, acctMap, debitPositive)).filter((r) => r.date && r.amount > 0 && (r.merchant || r.description));
    const stats = { fetched: raw.length, rows: rows.length, dateFrom, dateTo, debitPositive, byAccount: {} };
    rows.forEach((r) => { const k = r.account; stats.byAccount[k] = stats.byAccount[k] || { count: 0, sum: 0, type: r.accountType }; stats.byAccount[k].count++; stats.byAccount[k].sum += r.amount; });
    const next = Object.assign({}, cfg, { lastSync: Date.now(), lastSyncRows: rows.length, debitPositiveDetected: debitPositive });
    await putJson(OF_CONFIG_KEY, next);
    return resp(200, { ok: true, rows, accounts: accts, stats, config: ofMask(next) });
  }

  return resp(404, { error: 'unknown action' });
}

exports.handler = async (event) => {
  const http = (event.requestContext && event.requestContext.http) || {};
  const method = http.method || 'GET';
  const path = event.rawPath || http.path || '/';
  if (method === 'OPTIONS') return resp(200, { ok: true });
  try {
    const authMatch = path.match(/\/auth\/([a-z]+)\/?$/i);
    if (authMatch) return await handleAuth(authMatch[1].toLowerCase(), event);
    const ofMatch = path.match(/\/of\/([a-z]+)\/?$/i);
    if (ofMatch) return await handleOF(ofMatch[1].toLowerCase(), event);
    if (/\/data\/?$/.test(path)) return await handleData(method, event);
    return resp(404, { error: 'not found' });
  } catch (e) {
    return resp(500, { error: e.message });
  }
};
