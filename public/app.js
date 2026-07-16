// ---------------- API helper ----------------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה בשרת');
  return data;
}

// ---------------- Utils ----------------
const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const money = (n) => ILS.format(Number(n) || 0);
const fmtHours = (n) => (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 1 });
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { month: '' }; // '' = all time

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => (t.className = 'toast'), 2600);
}

function monthParam() {
  return state.month ? `?month=${state.month}` : '';
}

// ---------------- Modal ----------------
function openModal(title, fieldsHTML, onSubmit) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">${title}</div>
      <form class="modal-form">
        <div class="modal-body">${fieldsHTML}</div>
        <div class="modal-footer">
          <button type="submit" class="btn">שמירה</button>
          <button type="button" class="btn-ghost" data-close>ביטול</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.hasAttribute('data-close')) close(); });
  backdrop.querySelector('.modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await onSubmit(fd);
      close();
    } catch (err) {
      toast(err.message, true);
    }
  });
  backdrop.querySelector('input, select, textarea')?.focus();
}

async function confirmDelete(msg, fn) {
  if (!confirm(msg)) return;
  try { await fn(); } catch (err) { toast(err.message, true); }
}

// ---------------- Views ----------------
const views = {};

// ===== Dashboard =====
views.dashboard = async () => {
  const d = await api('/dashboard' + monthParam());
  const profitClass = d.netProfit >= 0 ? 'pos' : 'neg';

  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card income">
        <div class="label">💰 סך הכנסות</div>
        <div class="value">${money(d.totalIncome)}</div>
      </div>
      <div class="stat-card expense">
        <div class="label">💸 הוצאות ישירות</div>
        <div class="value">${money(d.totalExpenses)}</div>
      </div>
      <div class="stat-card expense">
        <div class="label">👥 עלות שכר (${fmtHours(d.totalHours)} ש')</div>
        <div class="value">${money(d.laborCost)}</div>
      </div>
      <div class="stat-card profit">
        <div class="label">📈 רווח נקי</div>
        <div class="value ${profitClass}">${money(d.netProfit)}</div>
      </div>
    </div>
    <div class="panels">
      <div class="panel">
        <h3>מגמת הכנסות מול הוצאות (6 חודשים אחרונים)</h3>
        <div id="trend-chart"></div>
      </div>
      <div class="panel">
        <h3>הוצאות לפי קטגוריה</h3>
        <div id="cat-bars">${barsHTML(d.byCategory.map(c => ({ label: c.category, value: c.total })), money)}</div>
      </div>
      <div class="panel">
        <h3>שעות עבודה לפי עובד</h3>
        <div id="emp-bars">${barsHTML(d.hoursByEmployee.map(e => ({ label: e.name, value: e.hours })), (v) => fmtHours(v) + ' ש\\'')}</div>
      </div>
      <div class="panel">
        <h3>עלות שכר לפי עובד</h3>
        <div id="empcost-bars">${barsHTML(d.hoursByEmployee.map(e => ({ label: e.name, value: e.cost })), money)}</div>
      </div>
    </div>
  `;
  el.querySelector('#trend-chart').innerHTML = trendChart(d.trend);
  return el;
};

function barsHTML(items, fmt) {
  if (!items.length) return '<div class="empty">אין נתונים</div>';
  const max = Math.max(...items.map(i => i.value), 1);
  return items.map(i => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(i.label)}">${esc(i.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(i.value / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-value">${fmt(i.value)}</div>
    </div>`).join('');
}

function trendChart(trend) {
  if (!trend.length) return '<div class="empty">אין נתונים</div>';
  const W = 460, H = 200, pad = 34;
  const max = Math.max(...trend.flatMap(t => [t.income, t.expenses]), 1);
  const n = trend.length;
  const bw = (W - pad * 2) / n;
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  // RTL: reverse x so newest month is on the left
  const x = (i) => W - pad - bw * (i + 0.5);

  const line = (key, color) => {
    const pts = trend.map((t, i) => `${x(i)},${y(t[key])}`).join(' ');
    const dots = trend.map((t, i) => `<circle cx="${x(i)}" cy="${y(t[key])}" r="3.5" fill="${color}"/>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}`;
  };
  const labels = trend.map((t, i) => {
    const [yy, mm] = t.m.split('-');
    return `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#6b7280">${mm}/${yy.slice(2)}</text>`;
  }).join('');

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#e5e7eb"/>
      ${line('expenses', '#dc2626')}
      ${line('income', '#16a34a')}
      ${labels}
    </svg>
    <div class="legend">
      <span><span class="dot" style="background:#16a34a"></span> הכנסות</span>
      <span><span class="dot" style="background:#dc2626"></span> הוצאות</span>
    </div>`;
}

// ===== Employees =====
views.employees = async () => {
  const rows = await api('/employees');
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>עובדים</h2>
        <button class="btn" id="add">+ עובד חדש</button>
      </div>
      ${rows.length ? `
      <table>
        <thead><tr><th>שם</th><th>תפקיד</th><th>שכר לשעה</th><th>סטטוס</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td>${esc(r.role) || '<span class="muted">—</span>'}</td>
              <td>${money(r.hourly_rate)}</td>
              <td><span class="badge ${r.active ? '' : 'off'}">${r.active ? 'פעיל' : 'לא פעיל'}</span></td>
              <td style="text-align:left; white-space:nowrap">
                <button class="icon-btn" data-edit="${r.id}" title="עריכה">✏️</button>
                <button class="btn-danger" data-del="${r.id}" title="מחיקה">🗑</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty">אין עובדים עדיין. הוסיפו את העובד הראשון.</div>'}
    </div>`;

  const form = (r = {}) => `
    <div class="field"><label>שם מלא *</label><input name="name" value="${esc(r.name || '')}" required /></div>
    <div class="field"><label>תפקיד</label><input name="role" value="${esc(r.role || '')}" placeholder="למשל: מתכנת, הנה\"ח" /></div>
    <div class="field"><label>שכר לשעה (₪)</label><input name="hourly_rate" type="number" step="0.01" min="0" value="${r.hourly_rate ?? ''}" /></div>
    <div class="field"><label><input type="checkbox" name="active" ${r.active === 0 ? '' : 'checked'} /> עובד פעיל</label></div>`;

  el.querySelector('#add').onclick = () => openModal('עובד חדש', form(), async (fd) => {
    await api('/employees', { method: 'POST', body: { ...fd, active: fd.active === 'on' } });
    toast('העובד נוסף'); render();
  });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const r = rows.find(x => x.id == b.dataset.edit);
    openModal('עריכת עובד', form(r), async (fd) => {
      await api('/employees/' + r.id, { method: 'PUT', body: { ...fd, active: fd.active === 'on' } });
      toast('העובד עודכן'); render();
    });
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete(
    'למחוק את העובד? כל רישומי השעות שלו יימחקו גם.',
    async () => { await api('/employees/' + b.dataset.del, { method: 'DELETE' }); toast('העובד נמחק'); render(); }
  ));
  return el;
};

// ===== Hours =====
views.hours = async () => {
  const [rows, employees] = await Promise.all([
    api('/time-entries' + monthParam()),
    api('/employees'),
  ]);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);

  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">⏱️ סך שעות</div><div class="value">${fmtHours(totalHours)}</div></div>
      <div class="stat-card expense"><div class="label">💵 עלות שכר כוללת</div><div class="value">${money(totalCost)}</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>רישום שעות</h2>
        <button class="btn" id="add">+ רישום שעות</button>
      </div>
      ${rows.length ? `
      <table>
        <thead><tr><th>תאריך</th><th>עובד</th><th>שעות</th><th>תיאור</th><th>עלות</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${fmtDate(r.work_date)}</td>
              <td><strong>${esc(r.employee_name)}</strong></td>
              <td>${fmtHours(r.hours)}</td>
              <td>${esc(r.description) || '<span class="muted">—</span>'}</td>
              <td>${money(r.cost)}</td>
              <td style="text-align:left"><button class="btn-danger" data-del="${r.id}">🗑</button></td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty">אין רישומי שעות בתקופה זו.</div>'}
    </div>`;

  const form = () => `
    <div class="field"><label>עובד *</label>
      <select name="employee_id" required>
        <option value="">בחר עובד…</option>
        ${employees.filter(e => e.active).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label>תאריך *</label><input name="work_date" type="date" value="${todayISO()}" required /></div>
      <div class="field"><label>שעות *</label><input name="hours" type="number" step="0.25" min="0" required /></div>
    </div>
    <div class="field"><label>תיאור</label><input name="description" placeholder="על מה עבדת" /></div>`;

  el.querySelector('#add').onclick = () => {
    if (!employees.some(e => e.active)) return toast('צריך להוסיף עובד פעיל קודם', true);
    openModal('רישום שעות', form(), async (fd) => {
      await api('/time-entries', { method: 'POST', body: fd });
      toast('השעות נרשמו'); render();
    });
  };
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete(
    'למחוק רישום שעות זה?',
    async () => { await api('/time-entries/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }
  ));
  return el;
};

// ===== Expenses =====
const EXPENSE_CATEGORIES = ['שכירות', 'חשמל ומים', 'ארנונה', 'ציוד', 'תוכנה ומנויים', 'שיווק ופרסום', 'רכב ונסיעות', 'משכורות', 'ספקים', 'ביטוח', 'אחר'];

views.expenses = async () => {
  const rows = await api('/expenses' + monthParam());
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card expense"><div class="label">💸 סך הוצאות בתקופה</div><div class="value">${money(total)}</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>הוצאות</h2>
        <button class="btn" id="add">+ הוצאה חדשה</button>
      </div>
      ${rows.length ? `
      <table>
        <thead><tr><th>תאריך</th><th>קטגוריה</th><th>ספק</th><th>תיאור</th><th>סכום</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${fmtDate(r.expense_date)}</td>
              <td><span class="badge">${esc(r.category)}</span></td>
              <td>${esc(r.vendor) || '<span class="muted">—</span>'}</td>
              <td>${esc(r.description) || '<span class="muted">—</span>'}</td>
              <td class="amount-neg">${money(r.amount)}</td>
              <td style="text-align:left"><button class="btn-danger" data-del="${r.id}">🗑</button></td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty">אין הוצאות בתקופה זו.</div>'}
    </div>`;

  const form = () => `
    <div class="field-row">
      <div class="field"><label>תאריך *</label><input name="expense_date" type="date" value="${todayISO()}" required /></div>
      <div class="field"><label>סכום (₪) *</label><input name="amount" type="number" step="0.01" min="0" required /></div>
    </div>
    <div class="field"><label>קטגוריה</label>
      <select name="category">${EXPENSE_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select>
    </div>
    <div class="field"><label>ספק</label><input name="vendor" placeholder="שם הספק / בית העסק" /></div>
    <div class="field"><label>תיאור</label><input name="description" /></div>`;

  el.querySelector('#add').onclick = () => openModal('הוצאה חדשה', form(), async (fd) => {
    await api('/expenses', { method: 'POST', body: fd });
    toast('ההוצאה נוספה'); render();
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete(
    'למחוק הוצאה זו?',
    async () => { await api('/expenses/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }
  ));
  return el;
};

// ===== Income =====
views.income = async () => {
  const rows = await api('/income' + monthParam());
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card income"><div class="label">💰 סך הכנסות בתקופה</div><div class="value">${money(total)}</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>הכנסות</h2>
        <button class="btn" id="add">+ הכנסה חדשה</button>
      </div>
      ${rows.length ? `
      <table>
        <thead><tr><th>תאריך</th><th>לקוח</th><th>תיאור</th><th>סכום</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${fmtDate(r.income_date)}</td>
              <td><strong>${esc(r.client) || '<span class="muted">—</span>'}</strong></td>
              <td>${esc(r.description) || '<span class="muted">—</span>'}</td>
              <td class="amount-pos">${money(r.amount)}</td>
              <td style="text-align:left"><button class="btn-danger" data-del="${r.id}">🗑</button></td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty">אין הכנסות בתקופה זו.</div>'}
    </div>`;

  const form = () => `
    <div class="field-row">
      <div class="field"><label>תאריך *</label><input name="income_date" type="date" value="${todayISO()}" required /></div>
      <div class="field"><label>סכום (₪) *</label><input name="amount" type="number" step="0.01" min="0" required /></div>
    </div>
    <div class="field"><label>לקוח</label><input name="client" placeholder="שם הלקוח" /></div>
    <div class="field"><label>תיאור</label><input name="description" placeholder="מספר חשבונית / פירוט" /></div>`;

  el.querySelector('#add').onclick = () => openModal('הכנסה חדשה', form(), async (fd) => {
    await api('/income', { method: 'POST', body: fd });
    toast('ההכנסה נוספה'); render();
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete(
    'למחוק הכנסה זו?',
    async () => { await api('/income/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }
  ));
  return el;
};

// ---------------- Router ----------------
const TITLES = { dashboard: 'דשבורד', employees: 'עובדים', hours: 'שעות עבודה', expenses: 'הוצאות', income: 'הכנסות' };

function currentView() {
  const hash = location.hash.replace('#/', '') || 'dashboard';
  return views[hash] ? hash : 'dashboard';
}

async function render() {
  const name = currentView();
  document.getElementById('page-title').textContent = TITLES[name];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  const container = document.getElementById('view');
  container.innerHTML = '<div class="empty">טוען…</div>';
  try {
    const el = await views[name]();
    container.innerHTML = '';
    container.appendChild(el);
  } catch (err) {
    container.innerHTML = `<div class="empty">שגיאה: ${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', render);

document.getElementById('month-filter').addEventListener('change', (e) => {
  state.month = e.target.value;
  render();
});
document.getElementById('clear-month').addEventListener('click', () => {
  state.month = '';
  document.getElementById('month-filter').value = '';
  render();
});

if (!location.hash) location.hash = '#/dashboard';
render();
