// אפליקציית ניהול המשרד כ-Cloudflare Worker.
//
// אותם 15 נתיבי API כמו ב-server.js, עם שני הבדלים מבניים:
//   1. D1 במקום better-sqlite3 — ה-API אסינכרוני, ולכן כל נתיב הוא async.
//   2. Hono במקום Express — אין app.listen; Workers עובד על fetch handler.
//
// הוספה שלא הייתה במקור: אימות בסיסי. לאפליקציה עצמה אין שום מנגנון הרשאות,
// ולכן בלי השכבה הזאת כל מי שמוצא את הכתובת רואה ועורך הכול.

import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { HTTPException } from 'hono/http-exception';

const app = new Hono();

// ---------- Helpers ----------
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

class BadRequest extends Error {}
const bad = (msg) => { throw new BadRequest(msg); };

// ---------- אימות ----------
// נכשל סגור: בלי סיסמה מוגדרת האפליקציה לא מגישה כלום.
app.use('*', async (c, next) => {
  const user = c.env.APP_USER;
  const pass = c.env.APP_PASSWORD;
  if (!user || !pass) {
    return c.json(
      { error: 'האפליקציה לא הוגדרה: חסרים APP_USER / APP_PASSWORD' },
      500
    );
  }
  return basicAuth({ username: user, password: pass })(c, next);
});

// ---------- טיפול בשגיאות ----------
app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  // basicAuth זורק HTTPException עם 401 ו-WWW-Authenticate. בלי השורה הזאת
  // הוא היה נבלע כאן והופך ל-500, כלומר הדפדפן לא היה מציג בקשת סיסמה.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: err.message || 'שגיאת שרת' }, 500);
});

// ---------- Employees ----------
app.get('/api/employees', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM employees ORDER BY active DESC, name')
    .all();
  return c.json(results);
});

app.post('/api/employees', async (c) => {
  const { name, role, hourly_rate, active } = await c.req.json();
  if (!str(name)) bad('שם העובד הוא שדה חובה');
  const info = await c.env.DB
    .prepare('INSERT INTO employees (name, role, hourly_rate, active) VALUES (?, ?, ?, ?)')
    .bind(str(name), str(role), num(hourly_rate), active === false ? 0 : 1)
    .run();
  const row = await c.env.DB
    .prepare('SELECT * FROM employees WHERE id = ?')
    .bind(info.meta.last_row_id)
    .first();
  return c.json(row);
});

app.put('/api/employees/:id', async (c) => {
  const { name, role, hourly_rate, active } = await c.req.json();
  if (!str(name)) bad('שם העובד הוא שדה חובה');
  const id = c.req.param('id');
  await c.env.DB
    .prepare('UPDATE employees SET name = ?, role = ?, hourly_rate = ?, active = ? WHERE id = ?')
    .bind(str(name), str(role), num(hourly_rate), active === false ? 0 : 1, id)
    .run();
  const row = await c.env.DB
    .prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
  return c.json(row);
});

app.delete('/api/employees/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM employees WHERE id = ?')
    .bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- Time entries ----------
app.get('/api/time-entries', async (c) => {
  const month = c.req.query('month');
  const employeeId = c.req.query('employee_id');
  const clauses = [];
  const params = [];
  if (month) { clauses.push("strftime('%Y-%m', t.work_date) = ?"); params.push(month); }
  if (employeeId) { clauses.push('t.employee_id = ?'); params.push(employeeId); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, e.name AS employee_name, e.hourly_rate,
           (t.hours * e.hourly_rate) AS cost
    FROM time_entries t
    JOIN employees e ON e.id = t.employee_id
    ${where}
    ORDER BY t.work_date DESC, t.id DESC
  `).bind(...params).all();
  return c.json(results);
});

app.post('/api/time-entries', async (c) => {
  const { employee_id, work_date, hours, description } = await c.req.json();
  if (!employee_id) bad('יש לבחור עובד');
  if (!str(work_date)) bad('יש להזין תאריך');
  if (num(hours) <= 0) bad('יש להזין מספר שעות חיובי');
  const info = await c.env.DB
    .prepare('INSERT INTO time_entries (employee_id, work_date, hours, description) VALUES (?, ?, ?, ?)')
    .bind(employee_id, str(work_date), num(hours), str(description))
    .run();
  return c.json({ id: info.meta.last_row_id });
});

app.delete('/api/time-entries/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM time_entries WHERE id = ?')
    .bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- Expenses ----------
app.get('/api/expenses', async (c) => {
  const month = c.req.query('month');
  const where = month ? "WHERE strftime('%Y-%m', expense_date) = ?" : '';
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC`)
    .bind(...(month ? [month] : []))
    .all();
  return c.json(results);
});

app.post('/api/expenses', async (c) => {
  const { expense_date, category, vendor, description, amount } = await c.req.json();
  if (!str(expense_date)) bad('יש להזין תאריך');
  if (num(amount) <= 0) bad('יש להזין סכום חיובי');
  const info = await c.env.DB
    .prepare('INSERT INTO expenses (expense_date, category, vendor, description, amount) VALUES (?, ?, ?, ?, ?)')
    .bind(str(expense_date), str(category) || 'אחר', str(vendor), str(description), num(amount))
    .run();
  return c.json({ id: info.meta.last_row_id });
});

app.delete('/api/expenses/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?')
    .bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- Income ----------
app.get('/api/income', async (c) => {
  const month = c.req.query('month');
  const where = month ? "WHERE strftime('%Y-%m', income_date) = ?" : '';
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM income ${where} ORDER BY income_date DESC, id DESC`)
    .bind(...(month ? [month] : []))
    .all();
  return c.json(results);
});

app.post('/api/income', async (c) => {
  const { income_date, client, description, amount } = await c.req.json();
  if (!str(income_date)) bad('יש להזין תאריך');
  if (num(amount) <= 0) bad('יש להזין סכום חיובי');
  const info = await c.env.DB
    .prepare('INSERT INTO income (income_date, client, description, amount) VALUES (?, ?, ?, ?)')
    .bind(str(income_date), str(client), str(description), num(amount))
    .run();
  return c.json({ id: info.meta.last_row_id });
});

app.delete('/api/income/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM income WHERE id = ?')
    .bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- Dashboard ----------
app.get('/api/dashboard', async (c) => {
  const DB = c.env.DB;
  const month = c.req.query('month'); // אופציונלי, YYYY-MM

  const monthFilter = (col) => (month ? `WHERE strftime('%Y-%m', ${col}) = ?` : '');
  const p = month ? [month] : [];

  const one = async (sql) => {
    const row = await DB.prepare(sql).bind(...p).first();
    return row?.v ?? 0;
  };

  const totalIncome = await one(
    `SELECT COALESCE(SUM(amount),0) AS v FROM income ${monthFilter('income_date')}`
  );
  const totalExpenses = await one(
    `SELECT COALESCE(SUM(amount),0) AS v FROM expenses ${monthFilter('expense_date')}`
  );
  const laborCost = await one(`
    SELECT COALESCE(SUM(t.hours * e.hourly_rate),0) AS v
    FROM time_entries t JOIN employees e ON e.id = t.employee_id
    ${monthFilter('t.work_date')}
  `);
  const totalHours = await one(
    `SELECT COALESCE(SUM(hours),0) AS v FROM time_entries ${monthFilter('work_date')}`
  );

  const { results: byCategory } = await DB.prepare(`
    SELECT category, COALESCE(SUM(amount),0) AS total
    FROM expenses ${monthFilter('expense_date')}
    GROUP BY category ORDER BY total DESC
  `).bind(...p).all();

  const { results: hoursByEmployee } = await DB.prepare(`
    SELECT e.name, COALESCE(SUM(t.hours),0) AS hours,
           COALESCE(SUM(t.hours * e.hourly_rate),0) AS cost
    FROM employees e
    LEFT JOIN time_entries t ON t.employee_id = e.id
    ${month ? "AND strftime('%Y-%m', t.work_date) = ?" : ''}
    GROUP BY e.id HAVING hours > 0 ORDER BY hours DESC
  `).bind(...p).all();

  // מגמה חודשית — תמיד ששת החודשים האחרונים, ללא תלות בפילטר.
  //
  // המקור בנה את רשימת החודשים בתוך SQL עם שרשרת UNION. ל-D1 יש תקרה נמוכה
  // על מספר האיברים ב-compound SELECT, והשאילתה נכשלת שם עם
  // "too many terms in compound SELECT". החודשים מחושבים כאן בקוד במקום,
  // ושתי שאילתות מצטברות מחליפות את שתים-עשרה תת-השאילתות המקוריות.
  const today = new Date();
  const monthKeys = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const since = monthKeys[0];

  const [incByMonth, expByMonth] = await Promise.all([
    DB.prepare(`
      SELECT strftime('%Y-%m', income_date) AS m, COALESCE(SUM(amount),0) AS v
      FROM income WHERE strftime('%Y-%m', income_date) >= ? GROUP BY m
    `).bind(since).all(),
    DB.prepare(`
      SELECT strftime('%Y-%m', expense_date) AS m, COALESCE(SUM(amount),0) AS v
      FROM expenses WHERE strftime('%Y-%m', expense_date) >= ? GROUP BY m
    `).bind(since).all(),
  ]);

  const incMap = Object.fromEntries(incByMonth.results.map((r) => [r.m, r.v]));
  const expMap = Object.fromEntries(expByMonth.results.map((r) => [r.m, r.v]));
  const trend = monthKeys.map((m) => ({
    m,
    income: incMap[m] ?? 0,
    expenses: expMap[m] ?? 0,
  }));

  return c.json({
    month: month || 'all',
    totalIncome,
    totalExpenses,
    laborCost,
    totalHours,
    // רווח נקי = הכנסות פחות (הוצאות ישירות + עלות שכר)
    netProfit: totalIncome - totalExpenses - laborCost,
    byCategory,
    hoursByEmployee,
    trend,
  });
});

// ---------- קבצים סטטיים + SPA ----------
// run_worker_first=true ב-wrangler.jsonc מבטיח שגם קבצים סטטיים עוברים דרך האימות.
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  // כל נתיב לא מוכר מוגש כ-index.html, כמו app.get('*') במקור
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url, { method: 'GET' }));
});

export default app;
