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
  // היתרה «האמיתית»: רק בשקלים, ולפי סוג — בעו"ש «expected/interimBooked/closingBooked» (היתרה החשבונאית),
  // לא «forwardAvailable» שכולל את מסגרת האשראי (מציג +30K כשבפועל החשבון ב-0). בכרטיס — המחזור הפתוח (interimBooked).
  const ils = bal.filter((b) => !b.currency || b.currency === 'ILS');
  const pick = (types) => { for (const t of types) { const f = ils.filter((b) => b.type === t); if (f.length) return f[0]; } return null; };
  const chosen = isCard ? (pick(['interimBooked', 'closingBooked', 'expected']) || ils[0] || null)
    : (pick(['expected', 'interimBooked', 'closingBooked', 'interimAvailable']) || null);
  const avail = pick(['forwardAvailable', 'interimAvailable']);
  return { id: a.id, connectionId: a.connectionId, providerId: a.providerId, provider: ofProvName(a.providerId), type: isCard ? 'CARD' : (String(a.accountType || 'CHECKING').toUpperCase()),
    issuer: isCard ? cardIssuerName(a.providerId, a.accountNumber, a.product || a.accountName) : null,
    name: a.accountName || '', product: a.product || '', number: a.accountNumber ? String(a.accountNumber).slice(-4) : '', fullNumber: a.accountNumber || '', currency: a.currency || 'ILS', balances: bal,
    balance: chosen ? chosen.amount : null, balanceType: chosen ? chosen.type : null, balanceCurrency: chosen ? 'ILS' : (bal[0] ? bal[0].currency : null), available: avail ? avail.amount : null,
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
    const { rows, accts, stats } = await ofPullRows(cfg, token, dateFrom, dateTo);
    const next = Object.assign({}, cfg, { lastSync: Date.now(), lastSyncRows: rows.length, debitPositiveDetected: stats.debitPositive });
    await putJson(OF_CONFIG_KEY, next);
    return resp(200, { ok: true, rows, accounts: accts, stats, config: ofMask(next) });
  }

  return resp(404, { error: 'unknown action' });
}
// משיכת עסקאות מנורמלות לחלון תאריכים — משמש גם את הסנכרון מהדפדפן וגם את הסנכרון האוטומטי בשרת
async function ofPullRows(cfg, token, dateFrom, dateTo, acctsIn) {
  const accts = acctsIn || (await ofGetAll(token, '/data/accounts', { limit: 200 })).map(ofAccountView);
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
  return { rows, accts, stats };
}

// ---------- Gemini (עוזר הבית מבוסס AI) ----------
// מפתח ה-API של Gemini נשמר אך ורק בשרת (S3); הדפדפן שולח שאלה + תקציר נתונים, והשרת פונה ל-Gemini.
const AI_CONFIG_KEY = 'data/__ai_config__.json';
const AI_DEFAULT_MODEL = 'gemini-3.6-flash';
// רשימת המודלים הזמינים למפתח (תומכי generateContent) — כדי שהמנהל יבחר מודל שקיים בפועל
async function geminiModels(key) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name)).map((m) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || m.name, desc: m.description || '' }));
}
async function aiLoadConfig() { const c = await getJson(AI_CONFIG_KEY, null); return c && typeof c === 'object' ? c : null; }
const aiMask = (c) => c && c.geminiKey ? { configured: true, keyHint: c.geminiKey.slice(0, 4) + '••••••••' + c.geminiKey.slice(-4), model: c.model || AI_DEFAULT_MODEL, updatedAt: c.updatedAt || null } : { configured: false, model: AI_DEFAULT_MODEL };
async function geminiCall(cfg, body) {
  const model = cfg.model || AI_DEFAULT_MODEL;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.geminiKey), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) { const msg = (j && j.error && j.error.message) || txt.slice(0, 300); const e = new Error(r.status === 400 && /API key/i.test(msg) ? 'מפתח Gemini לא תקין' : ('Gemini ' + r.status + ': ' + msg)); e.status = r.status; throw e; }
  const parts = (((j || {}).candidates || [])[0] || {}).content; const text = parts && parts.parts ? parts.parts.map((p) => p.text || '').join('') : '';
  return { text, usage: j && j.usageMetadata || null, blocked: !text && j && j.promptFeedback ? j.promptFeedback.blockReason : null };
}
async function handleAI(action, event) {
  const u = await currentUserFrom(event);
  if (!u) return resp(401, { error: 'unauthorized' });
  let body = {}; try { body = readBody(event); } catch (e) { return resp(400, { error: 'bad json' }); }
  const isAdmin = u.role === 'admin';
  const cfg = await aiLoadConfig();
  if (action === 'config') {
    if (!isAdmin) return resp(403, { error: 'רק המנהל יכול לעדכן את מפתח ה-AI' });
    if (body.clear === true) { await putJson(AI_CONFIG_KEY, {}); return resp(200, { ok: true, config: aiMask(null) }); }
    const next = Object.assign({}, cfg || {});
    if (body.geminiKey !== undefined && String(body.geminiKey || '').trim() !== '') next.geminiKey = String(body.geminiKey).trim();
    if (body.model !== undefined) next.model = String(body.model || '').trim() || AI_DEFAULT_MODEL;
    if (!next.geminiKey) return resp(400, { error: 'יש להזין מפתח Gemini' });
    // אימות מיידי: קריאה קצרה ל-Gemini
    try { const t = await geminiCall(next, { contents: [{ role: 'user', parts: [{ text: 'ענה במילה אחת: בדיקה' }] }], generationConfig: { maxOutputTokens: 5 } }); if (!t.text && !t.blocked) throw new Error('לא התקבלה תשובה'); }
    catch (e) { return resp(400, { error: 'המפתח לא אומת: ' + e.message }); }
    next.updatedAt = Date.now();
    await putJson(AI_CONFIG_KEY, next);
    return resp(200, { ok: true, config: aiMask(next) });
  }
  if (action === 'status') return resp(200, { ok: true, config: aiMask(cfg) });
  if (action === 'models') {
    if (!isAdmin) return resp(403, { error: 'forbidden' });
    const key = String(body.geminiKey || '').trim() || (cfg && cfg.geminiKey);
    if (!key) return resp(400, { error: 'אין מפתח' });
    try { return resp(200, { ok: true, models: await geminiModels(key) }); } catch (e) { return resp(400, { error: 'לא ניתן לקבל רשימת מודלים: ' + e.message }); }
  }
  if (action === 'ask') {
    if (!cfg || !cfg.geminiKey) return resp(400, { error: 'עוזר ה-AI עדיין לא הוגדר — הזינו מפתח Gemini במסך «מפתחות»' });
    const question = String(body.question || '').trim().slice(0, 4000);
    if (!question) return resp(400, { error: 'שאלה ריקה' });
    const digest = String(body.digest || '').slice(0, 400000);
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const system = [
      'אתה «עוזר הבית» — יועץ פיננסי ביתי חכם וידידותי של משפחה ישראלית. ענה בעברית, בקצרה ולעניין, עם מספרים מדויקים בשקלים (₪) מהנתונים.',
      'הנתונים שלפניך הם כל המידע באתר ניהול הבית של המשתמש: הוצאות והכנסות לפי חודש וקטגוריה, בתי עסק, כרטיסים, משכנתאות, נדל"ן, הוצאות קבועות, תחזוקה, אחריות, ורשימת העסקאות האחרונות.',
      'כללים: «הוצאות הבית» אינן כוללות משכנתא ונדל"ן (מנוהלים בנפרד). העברות בין חשבונות/מזומן/שיקים אינם מסווגים ואינם הכנסה. אם משהו לא קיים בנתונים — אמור זאת, אל תנחש.',
      'כשמתאים, הצע תובנה או המלצה קונקרטית (איפה לחסוך, מה חורג מהממוצע). אפשר להשתמש בכותרות קצרות, רשימות וטבלאות Markdown פשוטות.',
      '', '=== נתוני הבית (JSON/טקסט) ===', digest,
    ].join('\n');
    const contents = history.filter((h) => h && h.text).map((h) => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 6000) }] }));
    contents.push({ role: 'user', parts: [{ text: question }] });
    try {
      const out = await geminiCall(cfg, { system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } });
      if (!out.text) return resp(200, { ok: false, error: out.blocked ? 'התשובה נחסמה על ידי Gemini (' + out.blocked + ')' : 'לא התקבלה תשובה' });
      return resp(200, { ok: true, text: out.text, usage: out.usage, model: cfg.model || AI_DEFAULT_MODEL });
    } catch (e) { return resp(200, { ok: false, error: e.message }); }
  }
  return resp(404, { error: 'unknown action' });
}

// ---------- סנכרון אוטומטי בשרת (כל 3 ימים) + דוח שבועי במייל ----------
// שני אלה רצים מלוח-זמנים בענן (EventBridge Scheduler → invoke ישיר של הפונקציה עם {cron:'sync'|'report'}),
// ומשתמשים בקוד של האפליקציה עצמה (web/index.html מה-S3) דרך headless.js — כך הייבוא, סינון הכפילויות,
// הסיווג והתזרים זהים ב-100% למה שקורה בדפדפן.
const { createRuntime } = require('./headless');
const WEB_BUCKET = process.env.WEB_BUCKET || 'home-management-450118321037-us-east-1';
const SITE_URL = process.env.SITE_URL || 'https://bait.wonderfool.xyz';
const REPORT_KEY = 'data/__report_config__.json';
const REPORT_FROM = process.env.REPORT_FROM || 'ניהול הבית <bait@adnimation.com>';
const SYNC_EVERY_MS = 3 * 86400000;
const FN_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || 'home-management-sync';

async function reportLoadCfg() { const c = await getJson(REPORT_KEY, null); return Object.assign({ to: [], enabled: true, lastReport: null, lastSync: null }, c && typeof c === 'object' ? c : {}); }
async function reportSaveCfg(patch) { const cur = await reportLoadCfg(); const next = Object.assign({}, cur, patch, { updatedAt: Date.now() }); await putJson(REPORT_KEY, next); return next; }
const reportView = (c) => ({ to: c.to || [], enabled: c.enabled !== false, from: REPORT_FROM.replace(/^.*<|>.*$/g, ''), lastReport: c.lastReport || null, lastSync: c.lastSync || null,
  nextSync: c.lastSync && c.lastSync.at ? c.lastSync.at + SYNC_EVERY_MS : null });

async function loadApp() {
  const out = await s3.send(new GetObjectCommand({ Bucket: WEB_BUCKET, Key: 'index.html' }));
  return createRuntime(await out.Body.transformToString());
}
async function ofStatusData(cfg, token) {
  const [conns, accts] = await Promise.all([ofGetAll(token, '/connections', { limit: 100 }), ofGetAll(token, '/data/accounts', { limit: 200 })]);
  return { ok: true, config: ofMask(cfg), connections: conns.map(ofConnectionView), accounts: accts.map(ofAccountView), rawConns: conns };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// בקשת רענון נתונים מ-Open Finance — לכל חיבור בנפרד (POST /connections/{id}/refresh), עם נפילה חזרה לנתיב לפי משתמש.
// מחזיר מפה {connectionId|user: httpStatus} לצורך ניטור.
async function ofRefreshAll(cfg, token) {
  const out = {}; const h = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const tryUrl = async (url) => { let r = null; try { r = await fetch(url, { method: 'POST', headers: h, body: '{}' }); if (r.status === 404 || r.status === 405) r = await fetch(url, { headers: h }); return r.status; } catch (e) { return 'error: ' + e.message; } };
  let conns = []; try { conns = await ofGetAll(token, '/connections', { limit: 100 }); } catch (e) {}
  for (const c of conns.filter((c) => c && c.id && String(c.status || '').toUpperCase() !== 'DELETED')) out[c.id] = await tryUrl(OF_API + '/connections/' + encodeURIComponent(c.id) + '/refresh');
  if (!Object.values(out).some((s) => s === 200 || s === 202 || s === 204)) out.user = await tryUrl(OF_API + '/connections/' + encodeURIComponent(cfg.userId) + '/refresh');
  return out;
}

// סנכרון מלא בשרת: רענון בבנקים → המתנה לנתונים טריים → משיכת החודש-וחצי האחרונים → ייבוא דרך לוגיקת האפליקציה → שמירה בענן
async function serverSync(opts) {
  opts = opts || {};
  const cfg = await ofLoadConfig();
  if (!cfg || !cfg.clientId || !cfg.clientSecret || !cfg.userId) throw new Error('החיבור לבנק לא הוגדר (מפתחות Open Finance)');
  const token = await ofToken(cfg);
  let refreshed = false;
  if (opts.refresh !== false) {
    // בקשה מ-Open Finance למשוך נתונים טריים; ממתינים (עד waitMs) שלפחות חיבור אחד יתעדכן
    const stamp = (c) => c.lastFetchedDataDate || (c.refreshSettings && c.refreshSettings.lastFetchedDataDate) || '';
    let before = [];
    try { before = (await ofGetAll(token, '/connections', { limit: 100 })).map((c) => c.id + '@' + stamp(c)).sort(); } catch (e) {}
    serverSync.lastRefreshStatus = await ofRefreshAll(cfg, token);
    refreshed = Object.values(serverSync.lastRefreshStatus).some((s) => s === 200 || s === 202 || s === 204);
    const until = Date.now() + (opts.waitMs || 90000);
    while (refreshed && Date.now() < until) {
      await sleep(10000);
      try { const now = (await ofGetAll(token, '/connections', { limit: 100 })).map((c) => c.id + '@' + stamp(c)).sort(); if (now.join('|') !== before.join('|')) break; } catch (e) { break; }
    }
  }
  const status = await ofStatusData(cfg, token);
  const from = new Date(); from.setDate(from.getDate() - (opts.days || 45));
  const { rows, stats } = await ofPullRows(cfg, token, isoDay(from), isoDay(new Date(Date.now() + 86400000)), status.accounts);
  const rt = await loadApp();
  const key = dataKeyFor(HOUSEHOLD_CODE);
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await getJson(key, { data: null, updatedAt: 0 });
    if (!stored.data) throw new Error('אין עדיין נתונים בענן — פתחו את האתר פעם אחת');
    const res = await rt.run(`(async()=>{ db=__io.data; ensureDefaults(); _ofStatus=__io.status;
      const r=await ofImportRows(__io.rows); ofSetState({lastSyncAt:Date.now(),lastResult:r,lastRows:__io.rows.length}); db.ofServerSync=Date.now();
      return {r:JSON.parse(JSON.stringify(r)), json:JSON.stringify(db)}; })()`, { data: stored.data, status: { ok: true, accounts: status.accounts, connections: status.connections }, rows });
    // בקרת גרסאות: אם מישהו שמר מהדפדפן בזמן שעבדנו — טוענים שוב וחוזרים על הייבוא (לא דורסים)
    const cur = await getJson(key, { updatedAt: 0 });
    if ((cur.updatedAt || 0) !== (stored.updatedAt || 0)) continue;
    const updatedAt = Date.now();
    await putJson(key, { data: JSON.parse(res.json), updatedAt });
    await putJson(OF_CONFIG_KEY, Object.assign({}, cfg, { lastSync: Date.now(), lastSyncRows: rows.length, debitPositiveDetected: stats.debitPositive }));
    const result = { ok: true, at: updatedAt, refreshed, refreshStatus: serverSync.lastRefreshStatus || null, rows: rows.length, added: res.r.added || 0, skipped: res.r.skipped || 0, auto: res.r.auto || 0, pruned: res.r.pruned || 0, from: stats.dateFrom, to: stats.dateTo };
    await reportSaveCfg({ lastSync: result });
    return result;
  }
  throw new Error('הענן השתנה תוך כדי סנכרון (3 ניסיונות) — ננסה בפעם הבאה');
}

// ---- הדוח השבועי ----
const fmtILS = (v) => { const n = Math.round(Number(v) || 0); return (n < 0 ? '−' : '') + '₪' + Math.abs(n).toLocaleString('en-US'); };
const fmtD = (s) => { const [y, m, d] = String(s || '').slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : ''; };
const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const heMonth = (ym) => { const [y, m] = String(ym).split('-').map(Number); return (HE_MONTHS[m - 1] || '') + ' ' + y; };

async function buildReportData(rt, data, status) {
  const json = rt.run(`(function(){ db=__io.data; ensureDefaults(); _ofStatus=__io.status; if(!budgetCatIds().length){ db.budgetCats=suggestBudgetCats(); } return JSON.stringify(weeklyReportData()); })()`, { data, status });
  return JSON.parse(json);
}

function reportHTML(w, meta) {
  const over = w.cats.filter((c) => c.status === 'over'), warn = w.cats.filter((c) => c.status === 'warn'), withBudget = w.cats.filter((c) => c.budget > 0);
  const verdict = !withBudget.length ? { ic: '🎯', txt: 'עדיין לא הוגדרו תקציבים — הגדירו אותם במסך «תקציבים» כדי לקבל ✅/🔴 בדוח הבא.', color: '#0284c7' }
    : over.length ? { ic: '🔴', txt: `${over.length} קטגוריות בקצב חריגה מהתקציב: ${over.map((c) => c.name).join(', ')}`, color: '#dc2626' }
    : warn.length ? { ic: '⚠️', txt: `על הגבול ב‑${warn.map((c) => c.name).join(', ')} — עוד קצת ועוברים את התקציב`, color: '#d97706' }
    : { ic: '✅', txt: 'עומדים ביעד בכל קטגוריות התקציב — כל הכבוד!', color: '#059669' };
  const delta = w.homePrevSame > 0 ? Math.round((w.homeMtd - w.homePrevSame) / w.homePrevSame * 100) : null;
  const stIc = { ok: '✅', warn: '⚠️', over: '🔴', none: '—' };
  const bar = (v, max, color) => { const p = max > 0 ? Math.min(100, Math.round(v / max * 100)) : 0; return `<div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden;margin-top:4px"><div style="width:${p}%;height:8px;background:${color}"></div></div>`; };
  const tile = (label, value, sub, color) => `<td style="padding:6px" width="33%"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px"><div style="font-size:12px;color:#64748b">${label}</div><div style="font-size:22px;font-weight:800;color:${color || '#0f172a'};margin-top:2px">${value}</div><div style="font-size:12px;color:#64748b;margin-top:2px">${sub || ''}</div></div></td>`;
  const catRows = w.cats.map((c) => { const col = c.status === 'over' ? '#dc2626' : c.status === 'warn' ? '#d97706' : '#059669'; return `<tr>
      <td style="padding:8px 6px;border-bottom:1px solid #eef2f7"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${escH(c.color)};margin-inline-end:6px"></span><strong>${escH(c.name)}</strong>${c.budget > 0 ? bar(c.mtd, c.budget, col) : ''}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:center;white-space:nowrap">${fmtILS(c.week)}${c.budget > 0 ? `<div style="font-size:11px;color:#64748b">יעד שבועי ${fmtILS(c.weekBudget)}</div>` : ''}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:center;white-space:nowrap">${fmtILS(c.mtd)}${c.budget > 0 ? `<div style="font-size:11px;color:#64748b">מתוך ${fmtILS(c.budget)}</div>` : ''}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:center;white-space:nowrap">${c.budget > 0 ? `<span style="color:${c.left < 0 ? '#dc2626' : '#059669'};font-weight:700">${fmtILS(c.left)}</span>` : '—'}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:center;white-space:nowrap">${fmtILS(c.projected)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:center;font-size:18px">${stIc[c.status] || ''}</td></tr>`; }).join('');
  const topRows = w.top.map((t) => `<tr><td style="padding:6px;border-bottom:1px solid #eef2f7">${escH(t.name)}${t.cat ? `<span style="color:#64748b;font-size:12px"> · ${escH(t.cat)}</span>` : ''}</td><td style="padding:6px;border-bottom:1px solid #eef2f7;text-align:left;white-space:nowrap;direction:ltr"><strong>${fmtILS(t.value)}</strong>${t.n > 1 ? ` <span style="color:#64748b;font-size:12px">(${t.n})</span>` : ''}</td></tr>`).join('');
  const upRows = w.upcoming.filter((e) => e.kind !== 'income' && e.amt >= 300).slice(0, 8).map((e) => `<tr><td style="padding:5px 6px;border-bottom:1px solid #eef2f7;white-space:nowrap">${fmtD(e.d)}</td><td style="padding:5px 6px;border-bottom:1px solid #eef2f7">${e.kind === 'card' ? '💳' : e.kind === 'mortgage' ? '🏦' : '🔁'} ${escH(e.name)}${e.est ? ' <span style="color:#64748b;font-size:12px">(אומדן)</span>' : ''}</td><td style="padding:5px 6px;border-bottom:1px solid #eef2f7;text-align:left;direction:ltr;white-space:nowrap;color:#dc2626">−${fmtILS(e.amt)}</td></tr>`).join('');
  const th = (t) => `<th style="padding:8px 6px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">${t}</th>`;
  const lowCol = w.low30.bal < 0 ? '#dc2626' : '#059669';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח שבועי — ניהול הבית</title></head>
<body style="margin:0;background:#eef1f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,'Noto Sans Hebrew',sans-serif;color:#0f172a;direction:rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:18px 8px">
<table role="presentation" width="680" style="max-width:680px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0" cellpadding="0" cellspacing="0">
  <tr><td style="background:linear-gradient(135deg,#0d9488,#0284c7);color:#fff;padding:20px 22px">
    <div style="font-size:13px;opacity:.9">🏠 ניהול הבית · דוח שבועי</div>
    <div style="font-size:24px;font-weight:800;margin-top:4px">עמדנו ביעד? · ${fmtD(w.weekStart)} – ${fmtD(w.weekEnd)}</div>
    <div style="font-size:13px;opacity:.9;margin-top:4px">${heMonth(w.month)} · יום ${w.dayN} מתוך ${w.dim}</div></td></tr>
  <tr><td style="padding:18px 16px 6px"><div style="background:${verdict.color}14;border:1px solid ${verdict.color}55;border-radius:12px;padding:12px 14px;font-size:16px"><strong>${verdict.ic} ${escH(verdict.txt)}</strong></div></td></tr>
  <tr><td style="padding:6px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${tile('הוצאות הבית השבוע', fmtILS(w.homeWeek), 'ללא נדל״ן ומשכנתא')}
    ${tile('מתחילת החודש', fmtILS(w.homeMtd), delta == null ? '' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% מול אותם ימים בחודש הקודם (${fmtILS(w.homePrevSame)})`, delta != null && delta > 10 ? '#dc2626' : '#0f172a')}
    ${tile('קצב צפוי לסוף החודש', fmtILS(w.homeProjected), w.totalBudget > 0 ? `תקציב הקטגוריות: ${fmtILS(w.totalBudget)}` : 'לפי הקצב עד כה', w.totalBudget > 0 && w.homeProjected > w.totalBudget * 1.1 ? '#dc2626' : '#0f172a')}
  </tr></table></td></tr>
  <tr><td style="padding:12px 16px 4px"><div style="font-size:17px;font-weight:800">🎯 תקציב מול ביצוע</div><div style="font-size:12px;color:#64748b">«קצב צפוי» = ההוצאה מתחילת החודש מתורגמת לחודש מלא. 🔴 מעל 110% מהתקציב · ⚠️ 95%–110% · ✅ בתוך התקציב</div></td></tr>
  <tr><td style="padding:4px 16px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px"><thead><tr>${th('קטגוריה')}${th('השבוע')}${th('מתחילת החודש')}${th('נותר')}${th('קצב צפוי')}${th('')}</tr></thead><tbody>${catRows || `<tr><td colspan="6" style="padding:12px;color:#64748b;text-align:center">אין קטגוריות תקציב — <a href="${SITE_URL}/#/budgets" style="color:#0284c7">הגדירו במסך «תקציבים»</a></td></tr>`}</tbody></table></td></tr>
  <tr><td style="padding:12px 16px 4px"><div style="font-size:17px;font-weight:800">💧 תזרים</div></td></tr>
  <tr><td style="padding:4px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${tile('יתרת עו״ש כעת', w.balNow != null ? fmtILS(w.balNow) : '—', w.creditLine ? `מסגרת אשראי ${fmtILS(w.creditLine)}` : '', w.balNow != null && w.balNow < 0 ? '#dc2626' : '#0f172a')}
    ${tile('השפל הצפוי ב‑30 יום', fmtILS(w.low30.bal), `ב‑${fmtD(w.low30.d)} · כולל הכנסות צפויות`, lowCol)}
    ${tile('השפל ללא הכנסות', fmtILS(w.low30NoIncome.bal), `ב‑${fmtD(w.low30NoIncome.d)} · רק החיובים`, '#d97706')}
  </tr></table></td></tr>
  ${upRows ? `<tr><td style="padding:6px 16px 12px"><div style="font-size:13px;color:#64748b;margin-bottom:4px">חיובים גדולים ב‑10 הימים הקרובים:</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${upRows}</table></td></tr>` : ''}
  <tr><td style="padding:12px 16px 4px"><div style="font-size:17px;font-weight:800">🛒 בתי העסק הגדולים של השבוע</div></td></tr>
  <tr><td style="padding:4px 16px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${topRows || '<tr><td style="padding:8px;color:#64748b">אין הוצאות בשבוע זה</td></tr>'}</table></td></tr>
  ${w.uncatWeek ? `<tr><td style="padding:6px 16px 14px"><div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:10px 14px;font-size:14px">🏷️ <strong>${w.uncatWeek} עסקאות</strong> מהשבוע (${fmtILS(w.uncatWeekSum)}) עדיין ללא סיווג${w.uncatAll > w.uncatWeek ? ` · סה״כ ${w.uncatAll} ממתינות` : ''} — <a href="${SITE_URL}/#/review" style="color:#0284c7;font-weight:700">לסיווג באתר ←</a></div></td></tr>` : ''}
  <tr><td style="padding:14px 16px 18px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
    <a href="${SITE_URL}" style="color:#0284c7;font-weight:700">פתיחת האתר</a> · <a href="${SITE_URL}/#/insights" style="color:#0284c7">תזרים יומי</a> · <a href="${SITE_URL}/#/budgets" style="color:#0284c7">תקציבים</a><br>
    נתונים עד ${fmtD(w.lastTx)}${meta && meta.sync ? (meta.sync.ok ? ` · סונכרן מהבנק לפני השליחה (${meta.sync.added} עסקאות חדשות)` : ` · הסנכרון מהבנק לפני השליחה נכשל: ${escH(meta.sync.error || '')}`) : ''} · נוצר אוטומטית ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}.
    ${meta && meta.test ? '<br><em>זהו דוח בדיקה שנשלח ידנית ממסך «מפתחות».</em>' : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(to, subject, html) {
  const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const ses = new SESv2Client({});
  await ses.send(new SendEmailCommand({ FromEmailAddress: REPORT_FROM, Destination: { ToAddresses: to },
    Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Html: { Data: html, Charset: 'UTF-8' } } } } }));
}

async function runReport(to, opts) {
  opts = opts || {};
  let sync = null;
  if (opts.sync) { try { sync = await serverSync({ refresh: true, waitMs: 60000 }); } catch (e) { sync = { ok: false, error: e.message }; } }
  const cfg = await ofLoadConfig();
  let status = { ok: false, accounts: [], connections: [] };
  if (cfg && cfg.clientSecret) { try { status = await ofStatusData(cfg, await ofToken(cfg)); } catch (e) {} }
  const [rt, stored] = await Promise.all([loadApp(), getJson(dataKeyFor(HOUSEHOLD_CODE), { data: null })]);
  if (!stored.data) throw new Error('אין עדיין נתונים בענן');
  const w = await buildReportData(rt, stored.data, { ok: status.ok, accounts: status.accounts, connections: status.connections });
  const over = w.cats.filter((c) => c.status === 'over').length;
  const subject = `${over ? '🔴' : w.cats.some((c) => c.status === 'warn') ? '⚠️' : '✅'} דוח שבועי לבית · ${fmtD(w.weekStart)}–${fmtD(w.weekEnd)} · הוצאות ${fmtILS(w.homeWeek)}`;
  await sendEmail(to, subject, reportHTML(w, { sync, test: !!opts.test }));
  return { ok: true, to, subject, at: Date.now(), sync };
}

async function handleReport(action, event) {
  const u = await currentUserFrom(event);
  if (!u) return resp(401, { error: 'unauthorized' });
  const isAdmin = u.role === 'admin';
  let body = {};
  try { body = readBody(event); } catch (e) { return resp(400, { error: 'bad json' }); }
  if (action === 'status') return resp(200, reportView(await reportLoadCfg()));
  if (!isAdmin) return resp(403, { error: 'רק המנהל יכול לשנות את הגדרות הדוח והסנכרון' });
  const cleanTo = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((s) => String(s || '').trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))].slice(0, 10);
  if (action === 'config') {
    const patch = {}; if (body.to !== undefined) patch.to = cleanTo(body.to); if (body.enabled !== undefined) patch.enabled = !!body.enabled;
    return resp(200, reportView(await reportSaveCfg(patch)));
  }
  if (action === 'test') { // דוח בדיקה — מהנתונים הקיימים (בלי סנכרון, כדי להישאר בתוך 29 השניות של API Gateway)
    const to = cleanTo(body.to); if (!to.length) return resp(400, { error: 'אין נמענים תקינים' });
    const r = await runReport(to, { sync: false, test: true });
    return resp(200, { ok: true, to: r.to, subject: r.subject });
  }
  if (action === 'syncnow') { // הפעלה אסינכרונית של הסנכרון בשרת (לוקח כ-2 דקות)
    const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
    await new LambdaClient({}).send(new InvokeCommand({ FunctionName: FN_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ cron: 'sync', by: u.email })) }));
    return resp(200, { ok: true, started: true });
  }
  return resp(404, { error: 'unknown action' });
}

// הפעלה מלוח-הזמנים (ללא HTTP): {cron:'sync'} כל 3 ימים · {cron:'report'} כל יום ראשון בבוקר
async function handleCron(event) {
  if (event.cron === 'sync') {
    try { return { ok: true, sync: await serverSync({ refresh: true, waitMs: 90000 }) }; }
    catch (e) { await reportSaveCfg({ lastSync: { ok: false, at: Date.now(), error: e.message } }); return { ok: false, error: e.message }; }
  }
  if (event.cron === 'report') {
    const cfg = await reportLoadCfg();
    const to = Array.isArray(event.to) && event.to.length ? event.to : cfg.to;
    if (cfg.enabled === false && !event.force) return { ok: true, skipped: 'disabled' };
    if (!to || !to.length) return { ok: true, skipped: 'no recipients' };
    try { const r = await runReport(to, { sync: true }); await reportSaveCfg({ lastReport: { ok: true, at: r.at, to: r.to, subject: r.subject } }); return { ok: true, report: r }; }
    catch (e) { await reportSaveCfg({ lastReport: { ok: false, at: Date.now(), to, error: e.message } }); return { ok: false, error: e.message }; }
  }
  if (event.cron === 'refresh') { // אבחון: רק בקשת רענון מהבנקים, בלי ייבוא
    const cfg = await ofLoadConfig(); if (!cfg || !cfg.clientSecret) return { ok: false, error: 'no config' };
    return { ok: true, statuses: await ofRefreshAll(cfg, await ofToken(cfg)) };
  }
  return { ok: false, error: 'unknown cron ' + event.cron };
}

exports.handler = async (event) => {
  if (event && event.cron && !event.requestContext) return handleCron(event);
  const http = (event.requestContext && event.requestContext.http) || {};
  const method = http.method || 'GET';
  const path = event.rawPath || http.path || '/';
  if (method === 'OPTIONS') return resp(200, { ok: true });
  try {
    const authMatch = path.match(/\/auth\/([a-z]+)\/?$/i);
    if (authMatch) return await handleAuth(authMatch[1].toLowerCase(), event);
    const ofMatch = path.match(/\/of\/([a-z]+)\/?$/i);
    if (ofMatch) return await handleOF(ofMatch[1].toLowerCase(), event);
    const aiMatch = path.match(/\/ai\/([a-z]+)\/?$/i);
    if (aiMatch) return await handleAI(aiMatch[1].toLowerCase(), event);
    const rpMatch = path.match(/\/report\/([a-z]+)\/?$/i);
    if (rpMatch) return await handleReport(rpMatch[1].toLowerCase(), event);
    if (/\/data\/?$/.test(path)) return await handleData(method, event);
    return resp(404, { error: 'not found' });
  } catch (e) {
    return resp(500, { error: e.message });
  }
};
