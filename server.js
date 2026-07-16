import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ---------- Helpers ----------
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

function asyncRoute(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  };
}

// ---------- Employees ----------
app.get('/api/employees', asyncRoute((req, res) => {
  const rows = db.prepare('SELECT * FROM employees ORDER BY active DESC, name').all();
  res.json(rows);
}));

app.post('/api/employees', asyncRoute((req, res) => {
  const { name, role, hourly_rate, active } = req.body;
  if (!str(name)) throw new Error('שם העובד הוא שדה חובה');
  const info = db.prepare(
    'INSERT INTO employees (name, role, hourly_rate, active) VALUES (?, ?, ?, ?)'
  ).run(str(name), str(role), num(hourly_rate), active === false ? 0 : 1);
  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/employees/:id', asyncRoute((req, res) => {
  const { name, role, hourly_rate, active } = req.body;
  if (!str(name)) throw new Error('שם העובד הוא שדה חובה');
  db.prepare(
    'UPDATE employees SET name = ?, role = ?, hourly_rate = ?, active = ? WHERE id = ?'
  ).run(str(name), str(role), num(hourly_rate), active === false ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id));
}));

app.delete('/api/employees/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Time entries ----------
app.get('/api/time-entries', asyncRoute((req, res) => {
  const { month, employee_id } = req.query;
  const clauses = [];
  const params = [];
  if (month) { clauses.push("strftime('%Y-%m', t.work_date) = ?"); params.push(month); }
  if (employee_id) { clauses.push('t.employee_id = ?'); params.push(employee_id); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.*, e.name AS employee_name, e.hourly_rate,
           (t.hours * e.hourly_rate) AS cost
    FROM time_entries t
    JOIN employees e ON e.id = t.employee_id
    ${where}
    ORDER BY t.work_date DESC, t.id DESC
  `).all(...params);
  res.json(rows);
}));

app.post('/api/time-entries', asyncRoute((req, res) => {
  const { employee_id, work_date, hours, description } = req.body;
  if (!employee_id) throw new Error('יש לבחור עובד');
  if (!str(work_date)) throw new Error('יש להזין תאריך');
  if (num(hours) <= 0) throw new Error('יש להזין מספר שעות חיובי');
  const info = db.prepare(
    'INSERT INTO time_entries (employee_id, work_date, hours, description) VALUES (?, ?, ?, ?)'
  ).run(employee_id, str(work_date), num(hours), str(description));
  res.json({ id: info.lastInsertRowid });
}));

app.delete('/api/time-entries/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Expenses ----------
app.get('/api/expenses', asyncRoute((req, res) => {
  const { month } = req.query;
  const where = month ? "WHERE strftime('%Y-%m', expense_date) = ?" : '';
  const rows = db.prepare(
    `SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC`
  ).all(...(month ? [month] : []));
  res.json(rows);
}));

app.post('/api/expenses', asyncRoute((req, res) => {
  const { expense_date, category, vendor, description, amount } = req.body;
  if (!str(expense_date)) throw new Error('יש להזין תאריך');
  if (num(amount) <= 0) throw new Error('יש להזין סכום חיובי');
  const info = db.prepare(
    'INSERT INTO expenses (expense_date, category, vendor, description, amount) VALUES (?, ?, ?, ?, ?)'
  ).run(str(expense_date), str(category) || 'אחר', str(vendor), str(description), num(amount));
  res.json({ id: info.lastInsertRowid });
}));

app.delete('/api/expenses/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Income ----------
app.get('/api/income', asyncRoute((req, res) => {
  const { month } = req.query;
  const where = month ? "WHERE strftime('%Y-%m', income_date) = ?" : '';
  const rows = db.prepare(
    `SELECT * FROM income ${where} ORDER BY income_date DESC, id DESC`
  ).all(...(month ? [month] : []));
  res.json(rows);
}));

app.post('/api/income', asyncRoute((req, res) => {
  const { income_date, client, description, amount } = req.body;
  if (!str(income_date)) throw new Error('יש להזין תאריך');
  if (num(amount) <= 0) throw new Error('יש להזין סכום חיובי');
  const info = db.prepare(
    'INSERT INTO income (income_date, client, description, amount) VALUES (?, ?, ?, ?)'
  ).run(str(income_date), str(client), str(description), num(amount));
  res.json({ id: info.lastInsertRowid });
}));

app.delete('/api/income/:id', asyncRoute((req, res) => {
  db.prepare('DELETE FROM income WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Dashboard ----------
app.get('/api/dashboard', asyncRoute((req, res) => {
  const month = req.query.month; // optional YYYY-MM

  const monthFilter = (col) => (month ? `WHERE strftime('%Y-%m', ${col}) = ?` : '');
  const p = (v) => (month ? [v] : []);

  const totalIncome = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS v FROM income ${monthFilter('income_date')}`
  ).get(...p(month)).v;

  const totalExpenses = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS v FROM expenses ${monthFilter('expense_date')}`
  ).get(...p(month)).v;

  const laborCost = db.prepare(`
    SELECT COALESCE(SUM(t.hours * e.hourly_rate),0) AS v
    FROM time_entries t JOIN employees e ON e.id = t.employee_id
    ${monthFilter('t.work_date')}
  `).get(...p(month)).v;

  const totalHours = db.prepare(
    `SELECT COALESCE(SUM(hours),0) AS v FROM time_entries ${monthFilter('work_date')}`
  ).get(...p(month)).v;

  // Expenses by category
  const byCategory = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) AS total
    FROM expenses ${monthFilter('expense_date')}
    GROUP BY category ORDER BY total DESC
  `).all(...p(month));

  // Hours per employee
  const hoursByEmployee = db.prepare(`
    SELECT e.name, COALESCE(SUM(t.hours),0) AS hours,
           COALESCE(SUM(t.hours * e.hourly_rate),0) AS cost
    FROM employees e
    LEFT JOIN time_entries t ON t.employee_id = e.id
    ${month ? "AND strftime('%Y-%m', t.work_date) = ?" : ''}
    GROUP BY e.id HAVING hours > 0 ORDER BY hours DESC
  `).all(...p(month));

  // Monthly trend (last 6 months) — always all-time based
  const trend = db.prepare(`
    WITH months AS (
      SELECT strftime('%Y-%m', 'now', '-' || n || ' months') AS m
      FROM (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5)
    )
    SELECT m,
      (SELECT COALESCE(SUM(amount),0) FROM income WHERE strftime('%Y-%m', income_date) = m) AS income,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE strftime('%Y-%m', expense_date) = m) AS expenses
    FROM months ORDER BY m
  `).all();

  res.json({
    month: month || 'all',
    totalIncome,
    totalExpenses,
    laborCost,
    totalHours,
    // Net profit = income - (direct expenses + labor cost)
    netProfit: totalIncome - totalExpenses - laborCost,
    byCategory,
    hoursByEmployee,
    trend,
  });
}));

// Fallback to SPA
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ניהול משרד רץ על http://localhost:${PORT}`);
});
