import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.static(join(__dirname, 'public')));

// ---------- Helpers ----------
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const intOrNull = (v) => (v === undefined || v === null || v === '' ? null : parseInt(v, 10));

function asyncRoute(fn) {
  return (req, res) => {
    try { fn(req, res); }
    catch (err) { console.error(err); res.status(400).json({ error: err.message }); }
  };
}

// חישוב תאריך יעד: תאריך בסיס + מספר חודשים (מוחזר YYYY-MM-DD)
const addMonthsSQL = (dateCol, monthsCol) =>
  `date(${dateCol}, '+' || ${monthsCol} || ' months')`;

// ========================================================================
//  Categories
// ========================================================================
app.get('/api/categories', asyncRoute((req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY kind, name').all());
}));

app.post('/api/categories', asyncRoute((req, res) => {
  const { name, kind, is_home, color, monthly_budget } = req.body;
  if (!str(name)) throw new Error('שם הקטגוריה הוא שדה חובה');
  const info = db.prepare(
    'INSERT INTO categories (name, kind, is_home, color, monthly_budget) VALUES (?, ?, ?, ?, ?)'
  ).run(str(name), kind === 'income' ? 'income' : 'expense', is_home === false || is_home === 0 ? 0 : 1,
        str(color) || '#3f6fff', num(monthly_budget));
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/categories/:id', asyncRoute((req, res) => {
  const { name, kind, is_home, color, monthly_budget } = req.body;
  if (!str(name)) throw new Error('שם הקטגוריה הוא שדה חובה');
  db.prepare(
    'UPDATE categories SET name=?, kind=?, is_home=?, color=?, monthly_budget=? WHERE id=?'
  ).run(str(name), kind === 'income' ? 'income' : 'expense', is_home === false || is_home === 0 ? 0 : 1,
        str(color) || '#3f6fff', num(monthly_budget), req.params.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
}));

app.delete('/api/categories/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ========================================================================
//  Category rules (auto-classification)
// ========================================================================
app.get('/api/rules', asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT r.*, c.name AS category_name, c.color
    FROM category_rules r JOIN categories c ON c.id = r.category_id
    ORDER BY r.match_text
  `).all());
}));

app.post('/api/rules', asyncRoute((req, res) => {
  const { match_text, category_id } = req.body;
  if (!str(match_text)) throw new Error('יש להזין טקסט לזיהוי');
  if (!intOrNull(category_id)) throw new Error('יש לבחור קטגוריה');
  const info = db.prepare(
    'INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)'
  ).run(str(match_text), intOrNull(category_id));
  res.json({ id: info.lastInsertRowid });
}));

app.delete('/api/rules/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// מנסה להתאים קטגוריה לפי הכללים הקיימים
function matchCategory(text) {
  const rules = db.prepare('SELECT match_text, category_id FROM category_rules').all();
  const hay = str(text).toLowerCase();
  for (const r of rules) {
    if (hay.includes(str(r.match_text).toLowerCase())) return r.category_id;
  }
  return null;
}

// ========================================================================
//  Transactions
// ========================================================================
app.get('/api/transactions', asyncRoute((req, res) => {
  const { month, category_id, status, source, kind } = req.query;
  const clauses = [];
  const params = [];
  if (month) { clauses.push("strftime('%Y-%m', t.tx_date) = ?"); params.push(month); }
  if (category_id) { clauses.push('t.category_id = ?'); params.push(category_id); }
  if (status === 'uncategorized') clauses.push('t.category_id IS NULL');
  if (source) { clauses.push('t.source = ?'); params.push(source); }
  if (kind) { clauses.push('t.kind = ?'); params.push(kind); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.*, c.name AS category_name, c.color AS category_color, c.is_home
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    ${where}
    ORDER BY t.tx_date DESC, t.id DESC
  `).all(...params);
  res.json(rows);
}));

app.post('/api/transactions', asyncRoute((req, res) => {
  const { tx_date, source, account, description, merchant, amount, kind, category_id, notes } = req.body;
  if (!str(tx_date)) throw new Error('יש להזין תאריך');
  if (num(amount) <= 0) throw new Error('יש להזין סכום חיובי');
  const info = db.prepare(`
    INSERT INTO transactions (tx_date, source, account, description, merchant, amount, kind, category_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(str(tx_date), str(source) || 'manual', str(account), str(description), str(merchant),
         num(amount), kind === 'income' ? 'income' : 'expense', intOrNull(category_id), str(notes));
  res.json({ id: info.lastInsertRowid });
}));

app.patch('/api/transactions/:id', asyncRoute((req, res) => {
  const cur = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!cur) throw new Error('העסקה לא נמצאה');
  const b = req.body;
  const category_id = b.category_id === undefined ? cur.category_id : intOrNull(b.category_id);
  db.prepare(`
    UPDATE transactions SET
      tx_date=?, account=?, description=?, merchant=?, amount=?, kind=?, category_id=?, notes=?
    WHERE id=?
  `).run(
    b.tx_date !== undefined ? str(b.tx_date) : cur.tx_date,
    b.account !== undefined ? str(b.account) : cur.account,
    b.description !== undefined ? str(b.description) : cur.description,
    b.merchant !== undefined ? str(b.merchant) : cur.merchant,
    b.amount !== undefined ? num(b.amount) : cur.amount,
    b.kind !== undefined ? (b.kind === 'income' ? 'income' : 'expense') : cur.kind,
    category_id,
    b.notes !== undefined ? str(b.notes) : cur.notes,
    req.params.id
  );

  // יצירת כלל סיווג אוטומטי לעתיד (אופציונלי)
  if (b.make_rule && category_id) {
    const key = str(b.rule_text || cur.merchant || cur.description);
    if (key) db.prepare('INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)').run(key, category_id);
  }
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id));
}));

app.delete('/api/transactions/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ייבוא עסקאות מתדפיס (אשראי / בנק). מקבל שורות מנותחות מהלקוח.
app.post('/api/transactions/import', asyncRoute((req, res) => {
  const { source, account, rows } = req.body;
  if (!Array.isArray(rows) || !rows.length) throw new Error('אין שורות לייבוא');
  const src = str(source) || 'credit_card';
  const acct = str(account);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (tx_date, source, account, description, merchant, amount, kind, category_id, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0, skipped = 0, autoCategorized = 0;
  const tx = db.transaction((items) => {
    for (const r of items) {
      const date = str(r.date);
      const desc = str(r.description);
      const merchant = str(r.merchant || r.description);
      const amount = Math.abs(num(r.amount));
      if (!date || amount <= 0) { skipped++; continue; }
      const kind = r.kind === 'income' ? 'income' : 'expense';
      const hash = createHash('sha1')
        .update([src, acct, date, desc, amount, kind].join('|')).digest('hex');
      const cat = matchCategory(desc + ' ' + merchant);
      if (cat) autoCategorized++;
      const info = insert.run(date, src, acct, desc, merchant, amount, kind, cat, hash);
      if (info.changes) added++; else skipped++;
    }
  });
  tx(rows);
  res.json({ added, skipped, autoCategorized });
}));

// מחיקה גורפת של אצווה (למשל ביטול ייבוא שגוי) לפי מקור+חשבון+חודש
app.post('/api/transactions/bulk-delete', asyncRoute((req, res) => {
  const { source, account, month } = req.body;
  const clauses = [], params = [];
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  if (month) { clauses.push("strftime('%Y-%m', tx_date) = ?"); params.push(month); }
  if (!clauses.length) throw new Error('יש לציין לפחות תנאי אחד');
  const info = db.prepare(`DELETE FROM transactions WHERE ${clauses.join(' AND ')}`).run(...params);
  res.json({ deleted: info.changes });
}));

// ========================================================================
//  Professionals
// ========================================================================
app.get('/api/professionals', asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM components c WHERE c.professional_id = p.id) AS components_count,
      (SELECT COUNT(*) FROM warranties w WHERE w.professional_id = p.id) AS warranties_count
    FROM professionals p ORDER BY p.trade, p.name
  `).all());
}));

app.post('/api/professionals', asyncRoute((req, res) => {
  const { name, trade, company, phone, email, rating, notes } = req.body;
  if (!str(name)) throw new Error('שם בעל המקצוע הוא שדה חובה');
  const info = db.prepare(`
    INSERT INTO professionals (name, trade, company, phone, email, rating, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(str(name), str(trade), str(company), str(phone), str(email), num(rating), str(notes));
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/professionals/:id', asyncRoute((req, res) => {
  const { name, trade, company, phone, email, rating, notes } = req.body;
  if (!str(name)) throw new Error('שם בעל המקצוע הוא שדה חובה');
  db.prepare(`
    UPDATE professionals SET name=?, trade=?, company=?, phone=?, email=?, rating=?, notes=? WHERE id=?
  `).run(str(name), str(trade), str(company), str(phone), str(email), num(rating), str(notes), req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/professionals/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM professionals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ========================================================================
//  Warranties
// ========================================================================
const warrantyExpiry =
  `COALESCE(NULLIF(w.expiry_date,''), ${addMonthsSQL('w.purchase_date', 'w.warranty_months')})`;

app.get('/api/warranties', asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT w.*, p.name AS professional_name, p.phone AS professional_phone,
      ${warrantyExpiry} AS effective_expiry,
      CAST(julianday(${warrantyExpiry}) - julianday('now') AS INTEGER) AS days_left
    FROM warranties w LEFT JOIN professionals p ON p.id = w.professional_id
    ORDER BY effective_expiry
  `).all());
}));

function warrantyBody(b) {
  return [
    str(b.item_name), str(b.category), str(b.brand), str(b.model), str(b.serial),
    str(b.area), str(b.vendor), str(b.purchase_date) || null, intOrNull(b.warranty_months) ?? 12,
    str(b.expiry_date) || null, num(b.cost), intOrNull(b.professional_id), str(b.doc_url), str(b.notes),
  ];
}

app.post('/api/warranties', asyncRoute((req, res) => {
  if (!str(req.body.item_name)) throw new Error('שם הפריט הוא שדה חובה');
  const info = db.prepare(`
    INSERT INTO warranties
      (item_name, category, brand, model, serial, area, vendor, purchase_date, warranty_months,
       expiry_date, cost, professional_id, doc_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...warrantyBody(req.body));
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/warranties/:id', asyncRoute((req, res) => {
  if (!str(req.body.item_name)) throw new Error('שם הפריט הוא שדה חובה');
  db.prepare(`
    UPDATE warranties SET
      item_name=?, category=?, brand=?, model=?, serial=?, area=?, vendor=?, purchase_date=?,
      warranty_months=?, expiry_date=?, cost=?, professional_id=?, doc_url=?, notes=? WHERE id=?
  `).run(...warrantyBody(req.body), req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/warranties/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM warranties WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ========================================================================
//  Components + maintenance
// ========================================================================
const nextDue = `CASE WHEN c.last_replaced IS NULL OR c.last_replaced = '' THEN NULL
                 ELSE ${addMonthsSQL('c.last_replaced', 'c.interval_months')} END`;

app.get('/api/components', asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT c.*, p.name AS professional_name, p.phone AS professional_phone, p.trade AS professional_trade,
      ${nextDue} AS next_due,
      CAST(julianday(${nextDue}) - julianday('now') AS INTEGER) AS days_left
    FROM components c LEFT JOIN professionals p ON p.id = c.professional_id
    ORDER BY (next_due IS NULL), next_due
  `).all());
}));

function componentBody(b) {
  return [
    str(b.name), str(b.system) || 'כללי', str(b.area), intOrNull(b.professional_id),
    str(b.last_replaced) || null, intOrNull(b.interval_months) ?? 12, num(b.cost_estimate), str(b.notes),
  ];
}

app.post('/api/components', asyncRoute((req, res) => {
  if (!str(req.body.name)) throw new Error('שם הרכיב הוא שדה חובה');
  const info = db.prepare(`
    INSERT INTO components (name, system, area, professional_id, last_replaced, interval_months, cost_estimate, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...componentBody(req.body));
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/components/:id', asyncRoute((req, res) => {
  if (!str(req.body.name)) throw new Error('שם הרכיב הוא שדה חובה');
  db.prepare(`
    UPDATE components SET name=?, system=?, area=?, professional_id=?, last_replaced=?,
      interval_months=?, cost_estimate=?, notes=? WHERE id=?
  `).run(...componentBody(req.body), req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/components/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM components WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// סימון "טופל" — מעדכן תאריך החלפה אחרון ורושם ביומן
app.post('/api/components/:id/service', asyncRoute((req, res) => {
  const comp = db.prepare('SELECT * FROM components WHERE id = ?').get(req.params.id);
  if (!comp) throw new Error('הרכיב לא נמצא');
  const date = str(req.body.service_date) || new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO maintenance_log (component_id, service_date, description, cost, professional_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(comp.id, date, str(req.body.description) || 'החלפה/טיפול',
         num(req.body.cost), intOrNull(req.body.professional_id) ?? comp.professional_id);
  db.prepare('UPDATE components SET last_replaced = ? WHERE id = ?').run(date, comp.id);
  res.json({ ok: true });
}));

app.get('/api/components/:id/log', asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT m.*, p.name AS professional_name
    FROM maintenance_log m LEFT JOIN professionals p ON p.id = m.professional_id
    WHERE m.component_id = ? ORDER BY m.service_date DESC
  `).all(req.params.id));
}));

// ========================================================================
//  Recurring bills
// ========================================================================
app.get('/api/recurring', asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT r.*, c.name AS category_name, c.color, p.name AS professional_name
    FROM recurring_bills r
    LEFT JOIN categories c ON c.id = r.category_id
    LEFT JOIN professionals p ON p.id = r.professional_id
    ORDER BY r.active DESC, r.name
  `).all());
}));

function recurringBody(b) {
  const freq = ['monthly', 'bimonthly', 'quarterly', 'yearly'].includes(b.frequency) ? b.frequency : 'monthly';
  return [
    str(b.name), intOrNull(b.category_id), str(b.provider), num(b.amount), freq,
    intOrNull(b.due_day), intOrNull(b.professional_id), b.active === false || b.active === 0 ? 0 : 1, str(b.notes),
  ];
}

app.post('/api/recurring', asyncRoute((req, res) => {
  if (!str(req.body.name)) throw new Error('שם החשבון הוא שדה חובה');
  const info = db.prepare(`
    INSERT INTO recurring_bills (name, category_id, provider, amount, frequency, due_day, professional_id, active, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...recurringBody(req.body));
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/recurring/:id', asyncRoute((req, res) => {
  if (!str(req.body.name)) throw new Error('שם החשבון הוא שדה חובה');
  db.prepare(`
    UPDATE recurring_bills SET name=?, category_id=?, provider=?, amount=?, frequency=?, due_day=?,
      professional_id=?, active=?, notes=? WHERE id=?
  `).run(...recurringBody(req.body), req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/recurring/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM recurring_bills WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ========================================================================
//  Lighting
// ========================================================================
app.get('/api/lighting', asyncRoute((req, res) => {
  res.json(db.prepare('SELECT * FROM lighting ORDER BY area, fixture').all());
}));

function lightingBody(b) {
  return [
    str(b.area), str(b.fixture), str(b.bulb_type) || 'LED', str(b.base), num(b.wattage),
    str(b.color_temp), intOrNull(b.quantity) ?? 1, str(b.last_replaced) || null, str(b.notes),
  ];
}

app.post('/api/lighting', asyncRoute((req, res) => {
  if (!str(req.body.area) && !str(req.body.fixture)) throw new Error('יש להזין חדר או שם מנורה');
  const info = db.prepare(`
    INSERT INTO lighting (area, fixture, bulb_type, base, wattage, color_temp, quantity, last_replaced, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...lightingBody(req.body));
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/lighting/:id', asyncRoute((req, res) => {
  db.prepare(`
    UPDATE lighting SET area=?, fixture=?, bulb_type=?, base=?, wattage=?, color_temp=?,
      quantity=?, last_replaced=?, notes=? WHERE id=?
  `).run(...lightingBody(req.body), req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/lighting/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM lighting WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ========================================================================
//  Dashboard
// ========================================================================
app.get('/api/dashboard', asyncRoute((req, res) => {
  const month = req.query.month;
  const mf = (col) => (month ? `WHERE strftime('%Y-%m', ${col}) = ?` : '');
  const p = () => (month ? [month] : []);

  // עלות אחזקת הבית = הוצאות בקטגוריות is_home בלבד
  const homeExpenses = db.prepare(`
    SELECT COALESCE(SUM(t.amount),0) AS v FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.kind='expense' AND c.is_home=1
    ${month ? "AND strftime('%Y-%m', t.tx_date) = ?" : ''}
  `).get(...p()).v;

  const totalExpenses = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE kind='expense'
     ${month ? "AND strftime('%Y-%m', tx_date) = ?" : ''}`
  ).get(...p()).v;

  const totalIncome = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE kind='income'
     ${month ? "AND strftime('%Y-%m', tx_date) = ?" : ''}`
  ).get(...p()).v;

  const uncategorized = db.prepare(
    `SELECT COUNT(*) AS c FROM transactions WHERE category_id IS NULL AND kind='expense'
     ${month ? "AND strftime('%Y-%m', tx_date) = ?" : ''}`
  ).get(...p()).c;

  // פילוח הוצאות אחזקת בית לפי קטגוריה
  const byCategory = db.prepare(`
    SELECT c.name, c.color, COALESCE(SUM(t.amount),0) AS total
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.kind='expense' AND c.is_home=1
    ${month ? "AND strftime('%Y-%m', t.tx_date) = ?" : ''}
    GROUP BY c.id HAVING total > 0 ORDER BY total DESC
  `).all(...p());

  // הוצאות קבועות מנורמלות לחודש
  const bills = db.prepare('SELECT amount, frequency FROM recurring_bills WHERE active = 1').all();
  const perMonth = { monthly: 1, bimonthly: 1 / 2, quarterly: 1 / 3, yearly: 1 / 12 };
  const recurringMonthly = bills.reduce((s, b) => s + b.amount * (perMonth[b.frequency] || 1), 0);

  // מגמת הוצאות אחזקת בית ל-6 חודשים
  const trend = db.prepare(`
    WITH months AS (
      SELECT strftime('%Y-%m', 'now', '-' || n || ' months') AS m
      FROM (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5)
    )
    SELECT m,
      (SELECT COALESCE(SUM(t.amount),0) FROM transactions t JOIN categories c ON c.id=t.category_id
        WHERE t.kind='expense' AND c.is_home=1 AND strftime('%Y-%m', t.tx_date)=m) AS expenses,
      (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE kind='income' AND strftime('%Y-%m', tx_date)=m) AS income
    FROM months ORDER BY m
  `).all();

  // תחזוקה קרובה (עד 60 יום או באיחור)
  const upcomingMaintenance = db.prepare(`
    SELECT c.id, c.name, c.system, c.area, p.name AS professional_name, p.phone AS professional_phone,
      ${nextDue} AS next_due,
      CAST(julianday(${nextDue}) - julianday('now') AS INTEGER) AS days_left
    FROM components c LEFT JOIN professionals p ON p.id = c.professional_id
    WHERE next_due IS NOT NULL AND julianday(next_due) - julianday('now') <= 60
    ORDER BY next_due LIMIT 8
  `).all();

  // אחריות שפגה / עומדת לפוג (עד 90 יום)
  const expiringWarranties = db.prepare(`
    SELECT w.id, w.item_name, w.brand, ${warrantyExpiry} AS effective_expiry,
      CAST(julianday(${warrantyExpiry}) - julianday('now') AS INTEGER) AS days_left
    FROM warranties w
    WHERE ${warrantyExpiry} IS NOT NULL
      AND julianday(${warrantyExpiry}) - julianday('now') <= 90
    ORDER BY effective_expiry LIMIT 8
  `).all();

  res.json({
    month: month || 'all',
    homeExpenses, totalExpenses, totalIncome, uncategorized,
    recurringMonthly,
    annualProjection: recurringMonthly * 12,
    byCategory, trend, upcomingMaintenance, expiringWarranties,
  });
}));

// Fallback to SPA
app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🏡 ניהול הבית רץ על http://localhost:${PORT}`));
