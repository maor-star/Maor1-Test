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
const money2 = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(Number(n) || 0);
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : s; };
const todayISO = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { month: '' }; // '' = all time
const monthParam = (extra = '') => {
  const q = [];
  if (state.month) q.push('month=' + state.month);
  if (extra) q.push(extra);
  return q.length ? '?' + q.join('&') : '';
};

// אזורים נפוצים בבית לשימוש חוזר (datalist)
const AREAS = ['מטבח', 'סלון', 'פינת אוכל', 'חדר הורים', 'חדר רחצה הורים', 'חדר ילדים', 'חדר אורחים',
  'שירותי אורחים', 'חדר כביסה', 'מרתף', 'מחסן', 'מוסך', 'חצר', 'גינה', 'בריכה', 'מרפסת', 'גג',
  'כניסה', 'פרוזדור', 'משרד / חדר עבודה', 'ממ״ד'];
const SYSTEMS = ['מים ואינסטלציה', 'חשמל', 'מיזוג אוויר', 'בריכה', 'גינה והשקיה', 'מבנה ואיטום',
  'מכשירי חשמל', 'אבטחה ומיגון', 'דוד שמש / סולארי', 'כללי'];
const TRADES = ['חשמלאי', 'אינסטלטור (שרברב)', 'גנן', 'טכנאי מיזוג', 'טכנאי בריכה', 'שיפוצניק',
  'נגר', 'צבע', 'טכנאי מכשירי חשמל', 'מנעולן', 'זגג', 'טכנאי דוד שמש', 'מדביר', 'טכנאי אזעקה/מצלמות', 'אלומיניום'];
const BULB_BASES = ['E27', 'E14', 'GU10', 'G9', 'GU5.3 (MR16)', 'B22', 'צינור T8', 'צינור T5', 'LED מובנה', 'אחר'];
const BULB_TYPES = ['LED', 'הלוגן', 'פלואורסנט', 'להט', 'חכמה (Smart)'];

const datalist = (id, items) => `<datalist id="${id}">${items.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => (t.className = 'toast'), 2600);
}

// סטטוס לפי ימים שנותרו
function statusPill(days, { soon = 30 } = {}) {
  if (days === null || days === undefined) return '<span class="pill status-none">לא הוגדר</span>';
  if (days < 0) return `<span class="pill status-late">באיחור ${Math.abs(days)} ימים</span>`;
  if (days <= soon) return `<span class="pill status-soon">בעוד ${days} ימים</span>`;
  return `<span class="pill status-ok">בעוד ${days} ימים</span>`;
}
const stars = (n) => `<span class="stars">${[1, 2, 3, 4, 5].map(i => i <= n ? '★' : '<span class="off">★</span>').join('')}</span>`;

// ---------------- Modal ----------------
function openModal(title, fieldsHTML, onSubmit, { wide = false, submitLabel = 'שמירה' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-header">${title}</div>
      <form class="modal-form">
        <div class="modal-body">${fieldsHTML}</div>
        <div class="modal-footer">
          <button type="submit" class="btn">${submitLabel}</button>
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
    try { await onSubmit(fd); close(); }
    catch (err) { toast(err.message, true); }
  });
  backdrop.querySelector('input, select, textarea')?.focus();
  return { close, backdrop };
}

async function confirmDelete(msg, fn) {
  if (!confirm(msg)) return;
  try { await fn(); } catch (err) { toast(err.message, true); }
}

// select של קטגוריות
function categoryOptions(cats, selectedId, kind) {
  const list = kind ? cats.filter(c => c.kind === kind) : cats;
  return `<option value="">— ללא —</option>` + list.map(c =>
    `<option value="${c.id}" ${c.id == selectedId ? 'selected' : ''}>${esc(c.name)}${c.kind === 'income' ? ' (הכנסה)' : ''}</option>`).join('');
}
function professionalOptions(pros, selectedId) {
  return `<option value="">— ללא —</option>` + pros.map(p =>
    `<option value="${p.id}" ${p.id == selectedId ? 'selected' : ''}>${esc(p.name)}${p.trade ? ' · ' + esc(p.trade) : ''}</option>`).join('');
}

// ---------------- Views ----------------
const views = {};
const MONTH_VIEWS = new Set(['dashboard', 'transactions', 'review']);

// ===== Dashboard =====
views.dashboard = async () => {
  const d = await api('/dashboard' + monthParam());
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card expense">
        <div class="label">🏡 עלות אחזקת הבית</div>
        <div class="value">${money(d.homeExpenses)}</div>
        <div class="sub">${state.month ? 'בחודש הנבחר' : 'סך הכל'}</div>
      </div>
      <div class="stat-card neutral">
        <div class="label">🔁 הוצאות קבועות (חודשי)</div>
        <div class="value">${money(d.recurringMonthly)}</div>
        <div class="sub">תחזית שנתית: ${money(d.annualProjection)}</div>
      </div>
      <div class="stat-card expense">
        <div class="label">💳 סך כל ההוצאות</div>
        <div class="value">${money(d.totalExpenses)}</div>
        <div class="sub">כולל הוצאות שאינן בית</div>
      </div>
      <div class="stat-card ${d.uncategorized ? 'warn' : 'neutral'}">
        <div class="label">🏷️ עסקאות ללא סיווג</div>
        <div class="value">${d.uncategorized}</div>
        <div class="sub">${d.uncategorized ? '<a class="link" href="#/review">סווג עכשיו ←</a>' : 'הכל מסווג ✔'}</div>
      </div>
    </div>
    <div class="panels">
      <div class="panel">
        <h3>מגמת עלות אחזקת הבית (6 חודשים)</h3>
        <div id="trend-chart"></div>
      </div>
      <div class="panel">
        <h3>עלות אחזקת הבית לפי קטגוריה</h3>
        <div>${barsHTML(d.byCategory.map(c => ({ label: c.name, value: c.total, color: c.color })), money)}</div>
      </div>
      <div class="panel">
        <h3>🛠️ תחזוקה קרובה</h3>
        ${d.upcomingMaintenance.length ? d.upcomingMaintenance.map(m => `
          <div class="bar-row" style="justify-content:space-between">
            <div><strong>${esc(m.name)}</strong> <span class="muted">${esc(m.area || m.system)}</span></div>
            ${statusPill(m.days_left)}
          </div>`).join('') : '<div class="empty">אין תחזוקה קרובה 🎉</div>'}
      </div>
      <div class="panel">
        <h3>📜 אחריות שעומדת לפוג</h3>
        ${d.expiringWarranties.length ? d.expiringWarranties.map(w => `
          <div class="bar-row" style="justify-content:space-between">
            <div><strong>${esc(w.item_name)}</strong> <span class="muted">${esc(w.brand || '')}</span></div>
            ${statusPill(w.days_left, { soon: 90 })}
          </div>`).join('') : '<div class="empty">אין אחריות שעומדת לפוג</div>'}
      </div>
    </div>`;
  el.querySelector('#trend-chart').innerHTML = trendChart(d.trend);
  return el;
};

function barsHTML(items, fmt) {
  if (!items.length) return '<div class="empty">אין נתונים</div>';
  const max = Math.max(...items.map(i => i.value), 1);
  return items.map(i => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(i.label)}">${esc(i.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(i.value / max * 100).toFixed(1)}%;${i.color ? 'background:' + esc(i.color) : ''}"></div></div>
      <div class="bar-value">${fmt(i.value)}</div>
    </div>`).join('');
}

function trendChart(trend) {
  if (!trend.length) return '<div class="empty">אין נתונים</div>';
  const W = 460, H = 200, pad = 34;
  const max = Math.max(...trend.flatMap(t => [t.expenses, t.income]), 1);
  const n = trend.length;
  const bw = (W - pad * 2) / n;
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const x = (i) => W - pad - bw * (i + 0.5); // RTL: החודש האחרון משמאל
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
      ${line('expenses', '#dc2626')}${line('income', '#16a34a')}${labels}
    </svg>
    <div class="legend">
      <span><span class="dot" style="background:#dc2626"></span> הוצאות בית</span>
      <span><span class="dot" style="background:#16a34a"></span> הכנסות</span>
    </div>`;
}

// ===== Transactions =====
views.transactions = async () => {
  const [rows, cats] = await Promise.all([api('/transactions' + monthParam()), api('/categories')]);
  const totalExp = rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.amount, 0);
  const totalInc = rows.filter(r => r.kind === 'income').reduce((s, r) => s + r.amount, 0);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card expense"><div class="label">💸 הוצאות בתקופה</div><div class="value">${money(totalExp)}</div></div>
      <div class="stat-card income"><div class="label">💰 הכנסות בתקופה</div><div class="value">${money(totalInc)}</div></div>
      <div class="stat-card neutral"><div class="label">🧾 מספר עסקאות</div><div class="value">${rows.length}</div></div>
    </div>
    <div class="toolbar">
      <select id="f-cat"><option value="">כל הקטגוריות</option>
        <option value="__none">— ללא סיווג —</option>
        ${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
      <select id="f-src"><option value="">כל המקורות</option>
        <option value="credit_card">כרטיס אשראי</option><option value="bank">חשבון בנק</option><option value="manual">ידני</option>
      </select>
      <input id="f-txt" placeholder="חיפוש בית עסק / תיאור…" />
      <div class="spacer"></div>
      <button class="btn" id="add">+ עסקה ידנית</button>
    </div>
    <div class="card"><div id="tx-table"></div></div>`;

  const renderTable = () => {
    const fc = el.querySelector('#f-cat').value, fs = el.querySelector('#f-src').value, ft = el.querySelector('#f-txt').value.trim().toLowerCase();
    const filtered = rows.filter(r =>
      (!fc || (fc === '__none' ? !r.category_id : r.category_id == fc)) &&
      (!fs || r.source === fs) &&
      (!ft || (r.merchant + ' ' + r.description).toLowerCase().includes(ft)));
    el.querySelector('#tx-table').innerHTML = filtered.length ? `
      <table>
        <thead><tr><th>תאריך</th><th>בית עסק</th><th>מקור</th><th>קטגוריה</th><th>סכום</th><th></th></tr></thead>
        <tbody>${filtered.map(r => `
          <tr>
            <td>${fmtDate(r.tx_date)}</td>
            <td><strong>${esc(r.merchant || r.description) || '—'}</strong>${r.merchant && r.description && r.merchant !== r.description ? `<div class="hint">${esc(r.description)}</div>` : ''}</td>
            <td><span class="muted">${srcLabel(r.source)}</span></td>
            <td>${r.category_name ? `<span class="badge" style="background:${esc(r.category_color)}22;color:${esc(r.category_color)}">${esc(r.category_name)}</span>` : '<span class="pill status-none">ללא סיווג</span>'}</td>
            <td class="${r.kind === 'income' ? 'amount-pos' : 'amount-neg'}">${r.kind === 'income' ? '+' : '−'}${money2(r.amount)}</td>
            <td style="text-align:left;white-space:nowrap">
              <button class="icon-btn" data-edit="${r.id}" title="עריכה">✏️</button>
              <button class="btn-danger" data-del="${r.id}">🗑</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">אין עסקאות תואמות. ייבאו תדפיס או הוסיפו עסקה ידנית.</div>';
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editTx(rows.find(x => x.id == b.dataset.edit), cats));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete('למחוק עסקה זו?',
      async () => { await api('/transactions/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }));
  };

  ['#f-cat', '#f-src'].forEach(s => el.querySelector(s).onchange = renderTable);
  el.querySelector('#f-txt').oninput = renderTable;
  el.querySelector('#add').onclick = () => {
    const f = `
      <div class="field-row">
        <div class="field"><label>תאריך *</label><input name="tx_date" type="date" value="${todayISO()}" required /></div>
        <div class="field"><label>סכום (₪) *</label><input name="amount" type="number" step="0.01" min="0" required /></div>
      </div>
      <div class="field"><label>בית עסק / תיאור</label><input name="merchant" /></div>
      <div class="field-row">
        <div class="field"><label>סוג</label><select name="kind"><option value="expense">הוצאה</option><option value="income">הכנסה</option></select></div>
        <div class="field"><label>קטגוריה</label><select name="category_id">${categoryOptions(cats)}</select></div>
      </div>
      <div class="field"><label>הערות</label><input name="notes" /></div>`;
    openModal('עסקה ידנית', f, async (fd) => { await api('/transactions', { method: 'POST', body: { ...fd, source: 'manual' } }); toast('נוסף'); render(); });
  };
  renderTable();
  return el;
};

const srcLabel = (s) => ({ credit_card: '💳 אשראי', bank: '🏦 בנק', manual: '✍️ ידני' }[s] || s);

function editTx(r, cats) {
  const f = `
    <div class="field-row">
      <div class="field"><label>תאריך</label><input name="tx_date" type="date" value="${esc(r.tx_date)}" /></div>
      <div class="field"><label>סכום (₪)</label><input name="amount" type="number" step="0.01" min="0" value="${r.amount}" /></div>
    </div>
    <div class="field"><label>בית עסק</label><input name="merchant" value="${esc(r.merchant || '')}" /></div>
    <div class="field"><label>תיאור מקורי</label><input name="description" value="${esc(r.description || '')}" /></div>
    <div class="field-row">
      <div class="field"><label>סוג</label><select name="kind"><option value="expense" ${r.kind === 'expense' ? 'selected' : ''}>הוצאה</option><option value="income" ${r.kind === 'income' ? 'selected' : ''}>הכנסה</option></select></div>
      <div class="field"><label>קטגוריה</label><select name="category_id">${categoryOptions(cats, r.category_id)}</select></div>
    </div>
    <div class="field"><label>הערות</label><input name="notes" value="${esc(r.notes || '')}" /></div>`;
  openModal('עריכת עסקה', f, async (fd) => { await api('/transactions/' + r.id, { method: 'PATCH', body: fd }); toast('עודכן'); render(); });
}

// ===== Review (interactive categorization) =====
views.review = async () => {
  const [rows, cats] = await Promise.all([
    api('/transactions' + monthParam('status=uncategorized')), api('/categories'),
  ]);
  const expenseRows = rows.filter(r => r.kind === 'expense');
  const el = document.createElement('div');
  if (!expenseRows.length) {
    el.innerHTML = '<div class="card"><div class="empty">🎉 כל העסקאות מסווגות! ייבאו תדפיס חדש כדי להמשיך.</div></div>';
    return el;
  }
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card warn"><div class="label">🏷️ ממתינות לסיווג</div><div class="value" id="left-count">${expenseRows.length}</div></div>
    </div>
    <p class="hint" style="margin-bottom:16px">לחצו על הקטגוריה המתאימה לכל עסקה. סמנו «זכור» כדי שהמערכת תסווג אוטומטית עסקאות דומות בעתיד.</p>
    <div id="review-list"></div>`;

  const cheap = cats.filter(c => c.kind === 'expense');
  const listEl = el.querySelector('#review-list');
  listEl.innerHTML = expenseRows.map(r => `
    <div class="review-card" data-id="${r.id}">
      <div class="review-head">
        <div>
          <div class="review-merchant">${esc(r.merchant || r.description) || 'ללא תיאור'}</div>
          <div class="review-meta">${fmtDate(r.tx_date)} · ${srcLabel(r.source)}${r.account ? ' · ' + esc(r.account) : ''}</div>
        </div>
        <div class="review-amount">${money2(r.amount)}</div>
      </div>
      <div class="cat-chips">
        ${cheap.map(c => `<button class="cat-chip" data-cat="${c.id}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('')}
      </div>
      <div class="review-actions">
        <label class="chk"><input type="checkbox" class="remember" checked /> זכור סיווג לבית עסק זה</label>
        <span class="spacer"></span>
        <button class="btn-danger" data-skip>דלג / התעלם</button>
      </div>
    </div>`).join('');

  const decrement = () => {
    const c = el.querySelector('#left-count');
    const n = Math.max(0, parseInt(c.textContent, 10) - 1);
    c.textContent = n;
    if (n === 0) setTimeout(render, 400);
  };
  listEl.querySelectorAll('.review-card').forEach(card => {
    const id = card.dataset.id;
    const r = expenseRows.find(x => x.id == id);
    card.querySelectorAll('[data-cat]').forEach(btn => btn.onclick = async () => {
      const remember = card.querySelector('.remember').checked;
      try {
        await api('/transactions/' + id, { method: 'PATCH', body: {
          category_id: btn.dataset.cat, make_rule: remember, rule_text: r.merchant || r.description,
        }});
        card.style.transition = '.25s'; card.style.opacity = '0'; card.style.transform = 'translateX(-20px)';
        setTimeout(() => card.remove(), 250);
        toast('סווג'); decrement();
      } catch (err) { toast(err.message, true); }
    });
    card.querySelector('[data-skip]').onclick = () => confirmDelete('להסיר עסקה זו מהרשימה? (תימחק)',
      async () => { await api('/transactions/' + id, { method: 'DELETE' }); card.remove(); decrement(); });
  });
  return el;
};

// ===== Import =====
views.import = async () => {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="card" style="padding:24px">
      <h2 style="margin-bottom:8px">📥 ייבוא תדפיס אשראי / בנק</h2>
      <p class="hint" style="margin-bottom:16px">גררו לכאן קובץ CSV שהורדתם מאתר חברת האשראי או הבנק (ניתן לייצא כ‑CSV/אקסל), או לחצו לבחירה. לאחר הטעינה נזהה את העמודות ותאשרו את הייבוא. עסקאות כפולות יסוננו אוטומטית.</p>
      <div class="field-row" style="margin-bottom:14px">
        <div class="field"><label>מקור</label>
          <select id="imp-source"><option value="credit_card">💳 כרטיס אשראי</option><option value="bank">🏦 חשבון בנק</option></select>
        </div>
        <div class="field"><label>שם הכרטיס / החשבון</label><input id="imp-account" placeholder="לדוגמה: ויזה לאומי / עו״ש הפועלים" /></div>
      </div>
      <div class="drop" id="drop">📄 גררו קובץ CSV לכאן או לחצו לבחירה
        <input type="file" id="file" accept=".csv,text/csv,.txt" hidden />
      </div>
      <div id="mapper"></div>
    </div>`;

  const drop = el.querySelector('#drop');
  const fileInput = el.querySelector('#file');
  drop.onclick = () => fileInput.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); };
  fileInput.onchange = () => fileInput.files[0] && handleFile(fileInput.files[0]);

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => { try { showMapper(parseCSV(reader.result)); } catch (err) { toast(err.message, true); } };
    reader.readAsText(file, 'utf-8');
  }

  function showMapper({ headers, rows }) {
    if (!rows.length) return toast('הקובץ ריק', true);
    const mapper = el.querySelector('#mapper');
    const guess = guessColumns(headers);
    const opts = (sel) => headers.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || 'עמודה ' + (i + 1))}</option>`).join('');
    mapper.innerHTML = `
      <div class="section-title">התאמת עמודות · נמצאו ${rows.length} שורות</div>
      <div class="map-grid">
        <div class="field"><label>תאריך</label><select id="m-date">${opts(guess.date)}</select></div>
        <div class="field"><label>תיאור / בית עסק</label><select id="m-desc">${opts(guess.desc)}</select></div>
        <div class="field"><label>סכום</label><select id="m-amount">${opts(guess.amount)}</select></div>
      </div>
      <label class="chk" style="margin-bottom:12px"><input type="checkbox" id="m-allexp" checked /> ההוצאות בקובץ הן חיוב (הוצאה). בטלו אם עמודת הסכום כוללת גם זיכויים בסימן ±</label>
      <div class="preview-table"><table>
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 6).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn" id="do-import">ייבוא ${rows.length} שורות</button>
      </div>`;

    mapper.querySelector('#do-import').onclick = async () => {
      const di = +mapper.querySelector('#m-date').value;
      const de = +mapper.querySelector('#m-desc').value;
      const am = +mapper.querySelector('#m-amount').value;
      const allExpense = mapper.querySelector('#m-allexp').checked;
      const source = el.querySelector('#imp-source').value;
      const account = el.querySelector('#imp-account').value.trim();
      const parsed = rows.map(r => {
        const rawAmount = parseAmount(r[am]);
        let amount = rawAmount, kind = 'expense';
        if (!allExpense) { kind = rawAmount >= 0 ? (source === 'bank' ? 'income' : 'expense') : 'expense'; amount = Math.abs(rawAmount); }
        else { amount = Math.abs(rawAmount); kind = 'expense'; }
        return { date: normDate(r[di]), description: (r[de] || '').trim(), merchant: (r[de] || '').trim(), amount, kind };
      }).filter(r => r.date && r.amount > 0);
      if (!parsed.length) return toast('לא זוהו שורות תקינות — בדקו את התאמת העמודות', true);
      try {
        const res = await api('/transactions/import', { method: 'POST', body: { source, account, rows: parsed } });
        toast(`יובאו ${res.added} עסקאות (${res.autoCategorized} סווגו אוטומטית, ${res.skipped} כפולות/דולגו)`);
        mapper.innerHTML = `<div class="empty" style="margin-top:20px">✔ הושלם. <a class="link" href="#/review">עברו לסיווג העסקאות ←</a></div>`;
      } catch (err) { toast(err.message, true); }
    };
  }
  return el;
};

// CSV parser (תומך בפסיק/טאב/נקודה-פסיק וגרשיים)
function parseCSV(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.slice(0, text.indexOf('\n') > -1 ? text.indexOf('\n') : text.length);
  const delim = [['\t', (firstLine.match(/\t/g) || []).length], [';', (firstLine.match(/;/g) || []).length], [',', (firstLine.match(/,/g) || []).length]]
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // דילוג על שורות ריקות בראש הקובץ (חלק מהתדפיסים כוללים כותרת)
  const data = rows.filter(r => r.some(c => c && c.trim()));
  if (!data.length) return { headers: [], rows: [] };
  // מציאת שורת הכותרת: הראשונה עם 2+ תאים לא ריקים
  let hIdx = data.findIndex(r => r.filter(c => c && c.trim()).length >= 2);
  if (hIdx < 0) hIdx = 0;
  return { headers: data[hIdx].map(h => h.trim()), rows: data.slice(hIdx + 1) };
}

function guessColumns(headers) {
  const find = (words, def) => {
    const i = headers.findIndex(h => words.some(w => h && h.includes(w)));
    return i >= 0 ? i : def;
  };
  return {
    date: find(['תאריך', 'date', 'יום'], 0),
    desc: find(['תיאור', 'בית עסק', 'שם בית', 'פירוט', 'merchant', 'description', 'עסק'], 1),
    amount: find(['סכום', 'חיוב', 'סכום חיוב', 'amount', 'זכות', 'חובה', 'ש"ח', '₪'], headers.length - 1),
  };
}

function parseAmount(v) {
  if (v === undefined || v === null) return 0;
  let s = String(v).replace(/[₪,\s]/g, '').replace(/["']/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.includes('-')) { neg = true; s = s.replace(/-/g, ''); }
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

function normDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let y = m[3]; if (y.length === 2) y = '20' + y;
    return `${y}-${p2(m[2])}-${p2(m[1])}`;
  }
  return '';
}
const p2 = (n) => String(n).padStart(2, '0');

// ===== Recurring bills =====
views.recurring = async () => {
  const [rows, cats, pros] = await Promise.all([api('/recurring'), api('/categories'), api('/professionals')]);
  const FREQ = { monthly: 'חודשי', bimonthly: 'דו‑חודשי', quarterly: 'רבעוני', yearly: 'שנתי' };
  const perMonth = { monthly: 1, bimonthly: 0.5, quarterly: 1 / 3, yearly: 1 / 12 };
  const monthlyTotal = rows.filter(r => r.active).reduce((s, r) => s + r.amount * perMonth[r.frequency], 0);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card expense"><div class="label">🔁 סך חודשי משוער</div><div class="value">${money(monthlyTotal)}</div></div>
      <div class="stat-card neutral"><div class="label">📅 תחזית שנתית</div><div class="value">${money(monthlyTotal * 12)}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>הוצאות קבועות</h2><button class="btn" id="add">+ הוצאה קבועה</button></div>
      ${rows.length ? `<table>
        <thead><tr><th>שם</th><th>ספק</th><th>קטגוריה</th><th>סכום</th><th>תדירות</th><th>נורמל לחודש</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr style="${r.active ? '' : 'opacity:.5'}">
          <td><strong>${esc(r.name)}</strong>${r.due_day ? `<div class="hint">חיוב ב‑${r.due_day} לחודש</div>` : ''}</td>
          <td>${esc(r.provider) || '—'}</td>
          <td>${r.category_name ? `<span class="badge">${esc(r.category_name)}</span>` : '—'}</td>
          <td class="amount-neg">${money2(r.amount)}</td>
          <td>${FREQ[r.frequency]}</td>
          <td>${money(r.amount * perMonth[r.frequency])}</td>
          <td style="text-align:left;white-space:nowrap"><button class="icon-btn" data-edit="${r.id}">✏️</button><button class="btn-danger" data-del="${r.id}">🗑</button></td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">אין הוצאות קבועות. הוסיפו חשמל, מים, ארנונה, אינטרנט, גנן, בריכה וכו׳.</div>'}
    </div>`;
  const form = (r = {}) => `
    <div class="field"><label>שם *</label><input name="name" value="${esc(r.name || '')}" placeholder="חשמל / ארנונה / גנן…" required /></div>
    <div class="field-row">
      <div class="field"><label>ספק</label><input name="provider" value="${esc(r.provider || '')}" /></div>
      <div class="field"><label>סכום (₪)</label><input name="amount" type="number" step="0.01" min="0" value="${r.amount ?? ''}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>תדירות</label><select name="frequency">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${r.frequency === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>יום חיוב בחודש</label><input name="due_day" type="number" min="1" max="31" value="${r.due_day ?? ''}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>קטגוריה</label><select name="category_id">${categoryOptions(cats, r.category_id, 'expense')}</select></div>
      <div class="field"><label>בעל מקצוע קשור</label><select name="professional_id">${professionalOptions(pros, r.professional_id)}</select></div>
    </div>
    <div class="field"><label><input type="checkbox" name="active" ${r.active === 0 ? '' : 'checked'} /> פעיל</label></div>
    <div class="field"><label>הערות</label><input name="notes" value="${esc(r.notes || '')}" /></div>`;
  el.querySelector('#add').onclick = () => openModal('הוצאה קבועה', form(), async (fd) =>
    { await api('/recurring', { method: 'POST', body: { ...fd, active: fd.active === 'on' } }); toast('נוסף'); render(); });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const r = rows.find(x => x.id == b.dataset.edit);
    openModal('עריכת הוצאה קבועה', form(r), async (fd) => { await api('/recurring/' + r.id, { method: 'PUT', body: { ...fd, active: fd.active === 'on' } }); toast('עודכן'); render(); }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete('למחוק?', async () => { await api('/recurring/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }));
  return el;
};

// ===== Maintenance / components =====
views.maintenance = async () => {
  const [rows, pros] = await Promise.all([api('/components'), api('/professionals')]);
  const late = rows.filter(r => r.days_left !== null && r.days_left < 0).length;
  const soon = rows.filter(r => r.days_left !== null && r.days_left >= 0 && r.days_left <= 30).length;
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card ${late ? 'expense' : 'neutral'}"><div class="label">⏰ באיחור</div><div class="value">${late}</div></div>
      <div class="stat-card ${soon ? 'warn' : 'neutral'}"><div class="label">🔜 בחודש הקרוב</div><div class="value">${soon}</div></div>
      <div class="stat-card neutral"><div class="label">🧩 סה״כ רכיבים</div><div class="value">${rows.length}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>רכיבי בית ותחזוקה תקופתית</h2><button class="btn" id="add">+ רכיב חדש</button></div>
      ${rows.length ? `<table>
        <thead><tr><th>רכיב</th><th>מערכת</th><th>מיקום</th><th>הוחלף לאחרונה</th><th>תדירות</th><th>הבא</th><th>בעל מקצוע</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><strong>${esc(r.name)}</strong></td>
          <td><span class="muted">${esc(r.system)}</span></td>
          <td>${esc(r.area) || '—'}</td>
          <td>${r.last_replaced ? fmtDate(r.last_replaced) : '<span class="muted">—</span>'}</td>
          <td>${r.interval_months} ח׳</td>
          <td>${r.next_due ? statusPill(r.days_left) : '<span class="pill status-none">—</span>'}</td>
          <td>${r.professional_name ? `${esc(r.professional_name)}${r.professional_phone ? ` <a class="link" href="tel:${esc(r.professional_phone)}">📞</a>` : ''}` : '—'}</td>
          <td style="text-align:left;white-space:nowrap">
            <button class="icon-btn" data-done="${r.id}" title="סמן שטופל">✅</button>
            <button class="icon-btn" data-log="${r.id}" title="היסטוריה">📖</button>
            <button class="icon-btn" data-edit="${r.id}">✏️</button>
            <button class="btn-danger" data-del="${r.id}">🗑</button>
          </td></tr>`).join('')}</tbody></table>` :
        '<div class="empty">אין רכיבים. הוסיפו מסנני מים, מזגנים, משאבת בריכה, ראשי המטרה, גלאי עשן וכו׳.</div>'}
    </div>${datalist('areas', AREAS)}${datalist('systems', SYSTEMS)}`;

  const form = (r = {}) => `
    <div class="field"><label>שם הרכיב *</label><input name="name" value="${esc(r.name || '')}" placeholder="מסנן מים למטבח / פילטר בריכה…" required /></div>
    <div class="field-row">
      <div class="field"><label>מערכת</label><input name="system" list="systems" value="${esc(r.system || 'כללי')}" /></div>
      <div class="field"><label>מיקום</label><input name="area" list="areas" value="${esc(r.area || '')}" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>הוחלף לאחרונה</label><input name="last_replaced" type="date" value="${esc(r.last_replaced || '')}" /></div>
      <div class="field"><label>כל כמה חודשים</label><input name="interval_months" type="number" min="1" value="${r.interval_months ?? 12}" /></div>
      <div class="field"><label>עלות משוערת (₪)</label><input name="cost_estimate" type="number" step="0.01" min="0" value="${r.cost_estimate ?? ''}" /></div>
    </div>
    <div class="field"><label>בעל מקצוע</label><select name="professional_id">${professionalOptions(pros, r.professional_id)}</select></div>
    <div class="field"><label>הערות</label><input name="notes" value="${esc(r.notes || '')}" /></div>`;

  el.querySelector('#add').onclick = () => openModal('רכיב חדש', form(), async (fd) => { await api('/components', { method: 'POST', body: fd }); toast('נוסף'); render(); }, { wide: true });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const r = rows.find(x => x.id == b.dataset.edit);
    openModal('עריכת רכיב', form(r), async (fd) => { await api('/components/' + r.id, { method: 'PUT', body: fd }); toast('עודכן'); render(); }, { wide: true }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete('למחוק רכיב זה וכל ההיסטוריה שלו?', async () => { await api('/components/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }));
  el.querySelectorAll('[data-done]').forEach(b => b.onclick = () => { const r = rows.find(x => x.id == b.dataset.done);
    const f = `<p class="hint">רישום החלפה/טיפול יעדכן את תאריך ההחלפה האחרון ואת המועד הבא.</p>
      <div class="field-row"><div class="field"><label>תאריך</label><input name="service_date" type="date" value="${todayISO()}" /></div>
      <div class="field"><label>עלות (₪)</label><input name="cost" type="number" step="0.01" min="0" value="${r.cost_estimate || ''}" /></div></div>
      <div class="field"><label>תיאור</label><input name="description" value="החלפה" /></div>
      <div class="field"><label>בעל מקצוע</label><select name="professional_id">${professionalOptions(pros, r.professional_id)}</select></div>`;
    openModal(`טיפול: ${esc(r.name)}`, f, async (fd) => { await api('/components/' + r.id + '/service', { method: 'POST', body: fd }); toast('נרשם טיפול'); render(); }, { submitLabel: 'רישום טיפול' }); });
  el.querySelectorAll('[data-log]').forEach(b => b.onclick = async () => { const r = rows.find(x => x.id == b.dataset.log);
    const log = await api('/components/' + r.id + '/log');
    const body = log.length ? `<table style="width:100%"><thead><tr><th>תאריך</th><th>תיאור</th><th>עלות</th><th>מי</th></tr></thead>
      <tbody>${log.map(l => `<tr><td>${fmtDate(l.service_date)}</td><td>${esc(l.description)}</td><td>${money2(l.cost)}</td><td>${esc(l.professional_name || '—')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">אין היסטוריית טיפולים עדיין.</div>';
    openModal(`היסטוריה: ${esc(r.name)}`, body, async () => {}, { wide: true, submitLabel: 'סגירה' }); });
  return el;
};

// ===== Warranties =====
views.warranties = async () => {
  const [rows, pros] = await Promise.all([api('/warranties'), api('/professionals')]);
  const active = rows.filter(r => r.days_left === null || r.days_left >= 0).length;
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card neutral"><div class="label">📜 תעודות</div><div class="value">${rows.length}</div></div>
      <div class="stat-card income"><div class="label">✅ בתוקף</div><div class="value">${active}</div></div>
      <div class="stat-card expense"><div class="label">⌛ פגו</div><div class="value">${rows.length - active}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>תעודות אחריות</h2><button class="btn" id="add">+ תעודה חדשה</button></div>
      ${rows.length ? `<table>
        <thead><tr><th>פריט</th><th>יצרן/דגם</th><th>מיקום</th><th>נרכש</th><th>תוקף עד</th><th>סטטוס</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><strong>${esc(r.item_name)}</strong>${r.serial ? `<div class="hint">מק״ט: ${esc(r.serial)}</div>` : ''}</td>
          <td>${esc([r.brand, r.model].filter(Boolean).join(' '))|| '—'}</td>
          <td>${esc(r.area) || '—'}</td>
          <td>${r.purchase_date ? fmtDate(r.purchase_date) : '—'}</td>
          <td>${r.effective_expiry ? fmtDate(r.effective_expiry) : '—'}</td>
          <td>${statusPill(r.days_left, { soon: 90 })}</td>
          <td style="text-align:left;white-space:nowrap">${r.doc_url ? `<a class="icon-btn" href="${esc(r.doc_url)}" target="_blank" title="תעודה">📎</a>` : ''}<button class="icon-btn" data-edit="${r.id}">✏️</button><button class="btn-danger" data-del="${r.id}">🗑</button></td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">אין תעודות. הוסיפו מקרר, תנור, מזגנים, דוד שמש, מכונת כביסה, טלוויזיה וכו׳.</div>'}
    </div>${datalist('areas', AREAS)}`;
  const form = (r = {}) => `
    <div class="field-row">
      <div class="field"><label>שם הפריט *</label><input name="item_name" value="${esc(r.item_name || '')}" required /></div>
      <div class="field"><label>סוג/קטגוריה</label><input name="category" value="${esc(r.category || '')}" placeholder="מקרר, מזגן…" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>יצרן</label><input name="brand" value="${esc(r.brand || '')}" /></div>
      <div class="field"><label>דגם</label><input name="model" value="${esc(r.model || '')}" /></div>
      <div class="field"><label>מק״ט/סריאלי</label><input name="serial" value="${esc(r.serial || '')}" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>מיקום</label><input name="area" list="areas" value="${esc(r.area || '')}" /></div>
      <div class="field"><label>נקנה מ‑</label><input name="vendor" value="${esc(r.vendor || '')}" /></div>
      <div class="field"><label>עלות (₪)</label><input name="cost" type="number" step="0.01" min="0" value="${r.cost ?? ''}" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>תאריך רכישה</label><input name="purchase_date" type="date" value="${esc(r.purchase_date || '')}" /></div>
      <div class="field"><label>אחריות (חודשים)</label><input name="warranty_months" type="number" min="0" value="${r.warranty_months ?? 12}" /></div>
      <div class="field"><label>או תוקף עד (ידני)</label><input name="expiry_date" type="date" value="${esc(r.expiry_date || '')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>בעל מקצוע / שירות</label><select name="professional_id">${professionalOptions(pros, r.professional_id)}</select></div>
      <div class="field"><label>קישור לסריקת התעודה</label><input name="doc_url" value="${esc(r.doc_url || '')}" placeholder="https://…" /></div>
    </div>
    <div class="field"><label>הערות</label><input name="notes" value="${esc(r.notes || '')}" /></div>`;
  el.querySelector('#add').onclick = () => openModal('תעודת אחריות', form(), async (fd) => { await api('/warranties', { method: 'POST', body: fd }); toast('נוסף'); render(); }, { wide: true });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const r = rows.find(x => x.id == b.dataset.edit);
    openModal('עריכת תעודה', form(r), async (fd) => { await api('/warranties/' + r.id, { method: 'PUT', body: fd }); toast('עודכן'); render(); }, { wide: true }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete('למחוק תעודה זו?', async () => { await api('/warranties/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }));
  return el;
};

// ===== Professionals =====
views.professionals = async () => {
  const rows = await api('/professionals');
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="card-header" style="border:none;padding:0 0 16px">
      <h2>בעלי מקצוע</h2><button class="btn" id="add">+ בעל מקצוע</button>
    </div>
    ${rows.length ? `<div class="grid-cards">${rows.map(r => `
      <div class="mini-card">
        <h4>${esc(r.name)} ${r.rating ? stars(r.rating) : ''}</h4>
        <div class="row">🔧 ${esc(r.trade) || '—'}${r.company ? ' · ' + esc(r.company) : ''}</div>
        ${r.phone ? `<div class="row">📞 ${esc(r.phone)}</div>` : ''}
        ${r.email ? `<div class="row">✉️ ${esc(r.email)}</div>` : ''}
        <div class="row">🧩 ${r.components_count} רכיבים · 📜 ${r.warranties_count} תעודות</div>
        ${r.notes ? `<div class="row">${esc(r.notes)}</div>` : ''}
        <div class="contact-actions">
          ${r.phone ? `<a class="btn-ghost" href="tel:${esc(r.phone)}">חיוג</a>
          <a class="btn-ghost" href="https://wa.me/972${esc(r.phone.replace(/\D/g, '').replace(/^0/, ''))}" target="_blank">וואטסאפ</a>` : ''}
          <span class="spacer"></span>
          <button class="icon-btn" data-edit="${r.id}">✏️</button>
          <button class="btn-danger" data-del="${r.id}">🗑</button>
        </div>
      </div>`).join('')}</div>` : '<div class="card"><div class="empty">אין בעלי מקצוע. הוסיפו חשמלאי, אינסטלטור, גנן, טכנאי בריכה וכו׳.</div></div>'}
    ${datalist('trades', TRADES)}`;
  const form = (r = {}) => `
    <div class="field-row">
      <div class="field"><label>שם *</label><input name="name" value="${esc(r.name || '')}" required /></div>
      <div class="field"><label>תחום</label><input name="trade" list="trades" value="${esc(r.trade || '')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>חברה</label><input name="company" value="${esc(r.company || '')}" /></div>
      <div class="field"><label>טלפון</label><input name="phone" value="${esc(r.phone || '')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>אימייל</label><input name="email" type="email" value="${esc(r.email || '')}" /></div>
      <div class="field"><label>דירוג (0‑5)</label><input name="rating" type="number" min="0" max="5" value="${r.rating ?? 0}" /></div>
    </div>
    <div class="field"><label>הערות</label><input name="notes" value="${esc(r.notes || '')}" /></div>`;
  el.querySelector('#add').onclick = () => openModal('בעל מקצוע', form(), async (fd) => { await api('/professionals', { method: 'POST', body: fd }); toast('נוסף'); render(); });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const r = rows.find(x => x.id == b.dataset.edit);
    openModal('עריכת בעל מקצוע', form(r), async (fd) => { await api('/professionals/' + r.id, { method: 'PUT', body: fd }); toast('עודכן'); render(); }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete('למחוק בעל מקצוע זה?', async () => { await api('/professionals/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }));
  return el;
};

// ===== Lighting =====
views.lighting = async () => {
  const rows = await api('/lighting');
  const totalBulbs = rows.reduce((s, r) => s + (r.quantity || 0), 0);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card neutral"><div class="label">💡 סה״כ נורות</div><div class="value">${totalBulbs}</div></div>
      <div class="stat-card neutral"><div class="label">🔩 סוגי בתי מנורה</div><div class="value">${new Set(rows.map(r => r.base).filter(Boolean)).size}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>תאורה ונורות</h2><button class="btn" id="add">+ נורה / מנורה</button></div>
      ${rows.length ? `<table>
        <thead><tr><th>חדר</th><th>מנורה</th><th>סוג</th><th>בית נורה</th><th>הספק</th><th>גוון</th><th>כמות</th><th>הוחלף</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><strong>${esc(r.area) || '—'}</strong></td>
          <td>${esc(r.fixture) || '—'}</td>
          <td>${esc(r.bulb_type)}</td>
          <td>${esc(r.base) || '—'}</td>
          <td>${r.wattage ? r.wattage + 'W' : '—'}</td>
          <td>${esc(r.color_temp) || '—'}</td>
          <td>${r.quantity}</td>
          <td>${r.last_replaced ? fmtDate(r.last_replaced) : '—'}</td>
          <td style="text-align:left;white-space:nowrap"><button class="icon-btn" data-edit="${r.id}">✏️</button><button class="btn-danger" data-del="${r.id}">🗑</button></td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">אין נורות עדיין. תעדו את סוגי הנורות בכל חדר כדי לדעת מה לקנות בהחלפה.</div>'}
    </div>${datalist('areas', AREAS)}${datalist('bases', BULB_BASES)}`;
  const form = (r = {}) => `
    <div class="field-row">
      <div class="field"><label>חדר / אזור</label><input name="area" list="areas" value="${esc(r.area || '')}" /></div>
      <div class="field"><label>שם המנורה / גוף תאורה</label><input name="fixture" value="${esc(r.fixture || '')}" placeholder="נברשת סלון / ספוט…" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>סוג נורה</label><select name="bulb_type">${BULB_TYPES.map(t => `<option ${r.bulb_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>בית נורה</label><input name="base" list="bases" value="${esc(r.base || '')}" /></div>
      <div class="field"><label>הספק (W)</label><input name="wattage" type="number" step="0.5" min="0" value="${r.wattage ?? ''}" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>גוון (K)</label><input name="color_temp" value="${esc(r.color_temp || '')}" placeholder="3000K / חם…" /></div>
      <div class="field"><label>כמות</label><input name="quantity" type="number" min="1" value="${r.quantity ?? 1}" /></div>
      <div class="field"><label>הוחלף לאחרונה</label><input name="last_replaced" type="date" value="${esc(r.last_replaced || '')}" /></div>
    </div>
    <div class="field"><label>הערות</label><input name="notes" value="${esc(r.notes || '')}" /></div>`;
  el.querySelector('#add').onclick = () => openModal('נורה / מנורה', form(), async (fd) => { await api('/lighting', { method: 'POST', body: fd }); toast('נוסף'); render(); }, { wide: true });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const r = rows.find(x => x.id == b.dataset.edit);
    openModal('עריכת נורה', form(r), async (fd) => { await api('/lighting/' + r.id, { method: 'PUT', body: fd }); toast('עודכן'); render(); }, { wide: true }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete('למחוק?', async () => { await api('/lighting/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }));
  return el;
};

// ===== Categories & rules =====
views.categories = async () => {
  const [cats, rules] = await Promise.all([api('/categories'), api('/rules')]);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="card" style="margin-bottom:22px">
      <div class="card-header"><h2>קטגוריות</h2><button class="btn" id="add-cat">+ קטגוריה</button></div>
      <table>
        <thead><tr><th>שם</th><th>סוג</th><th>אחזקת בית?</th><th>תקציב חודשי</th><th></th></tr></thead>
        <tbody>${cats.map(c => `<tr>
          <td><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(c.color)};margin-left:6px"></span><strong>${esc(c.name)}</strong></td>
          <td>${c.kind === 'income' ? 'הכנסה' : 'הוצאה'}</td>
          <td>${c.is_home ? '✔' : '—'}</td>
          <td>${c.monthly_budget ? money(c.monthly_budget) : '—'}</td>
          <td style="text-align:left;white-space:nowrap"><button class="icon-btn" data-edit="${c.id}">✏️</button><button class="btn-danger" data-del="${c.id}">🗑</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-header"><h2>כללי סיווג אוטומטי</h2><button class="btn" id="add-rule">+ כלל</button></div>
      <p class="hint" style="padding:0 20px">כשמופיע הטקסט בתיאור עסקה מיובאת, היא תסווג אוטומטית לקטגוריה. נוצרים גם אוטומטית כשמסמנים «זכור» במסך הסיווג.</p>
      ${rules.length ? `<table>
        <thead><tr><th>טקסט לזיהוי</th><th>קטגוריה</th><th></th></tr></thead>
        <tbody>${rules.map(r => `<tr><td><code>${esc(r.match_text)}</code></td>
          <td><span class="badge" style="background:${esc(r.color)}22;color:${esc(r.color)}">${esc(r.category_name)}</span></td>
          <td style="text-align:left"><button class="btn-danger" data-delrule="${r.id}">🗑</button></td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">אין כללים עדיין.</div>'}
    </div>`;
  const catForm = (c = {}) => `
    <div class="field-row">
      <div class="field"><label>שם *</label><input name="name" value="${esc(c.name || '')}" required /></div>
      <div class="field"><label>צבע</label><input name="color" type="color" value="${esc(c.color || '#3f6fff')}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>סוג</label><select name="kind"><option value="expense" ${c.kind !== 'income' ? 'selected' : ''}>הוצאה</option><option value="income" ${c.kind === 'income' ? 'selected' : ''}>הכנסה</option></select></div>
      <div class="field"><label>תקציב חודשי (₪)</label><input name="monthly_budget" type="number" step="0.01" min="0" value="${c.monthly_budget ?? ''}" /></div>
    </div>
    <div class="field"><label><input type="checkbox" name="is_home" ${c.is_home === 0 ? '' : 'checked'} /> נספר בעלות אחזקת הבית</label></div>`;
  el.querySelector('#add-cat').onclick = () => openModal('קטגוריה', catForm(), async (fd) => { await api('/categories', { method: 'POST', body: { ...fd, is_home: fd.is_home === 'on' } }); toast('נוסף'); render(); });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const c = cats.find(x => x.id == b.dataset.edit);
    openModal('עריכת קטגוריה', catForm(c), async (fd) => { await api('/categories/' + c.id, { method: 'PUT', body: { ...fd, is_home: fd.is_home === 'on' } }); toast('עודכן'); render(); }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmDelete('למחוק קטגוריה? עסקאות שסווגו אליה יישארו ללא סיווג.', async () => { await api('/categories/' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(); }));
  el.querySelector('#add-rule').onclick = () => openModal('כלל סיווג', `
    <div class="field"><label>טקסט לזיהוי בעסקה *</label><input name="match_text" required placeholder="לדוגמה: רמי לוי / חברת חשמל" /></div>
    <div class="field"><label>קטגוריה *</label><select name="category_id">${categoryOptions(cats)}</select></div>`,
    async (fd) => { await api('/rules', { method: 'POST', body: fd }); toast('נוסף'); render(); });
  el.querySelectorAll('[data-delrule]').forEach(b => b.onclick = () => confirmDelete('למחוק כלל זה?', async () => { await api('/rules/' + b.dataset.delrule, { method: 'DELETE' }); toast('נמחק'); render(); }));
  return el;
};

// ---------------- Router ----------------
const TITLES = {
  dashboard: 'דשבורד', transactions: 'עסקאות', review: 'סיווג עסקאות', import: 'ייבוא תדפיסים',
  recurring: 'הוצאות קבועות', maintenance: 'תחזוקה ורכיבים', warranties: 'תעודות אחריות',
  professionals: 'בעלי מקצוע', lighting: 'תאורה ונורות', categories: 'קטגוריות וכללים',
};

function currentView() {
  const hash = location.hash.replace('#/', '') || 'dashboard';
  return views[hash] ? hash : 'dashboard';
}

async function render() {
  const name = currentView();
  document.getElementById('page-title').textContent = TITLES[name];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  document.getElementById('month-wrap').style.visibility = MONTH_VIEWS.has(name) ? 'visible' : 'hidden';
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
document.getElementById('month-filter').addEventListener('change', (e) => { state.month = e.target.value; render(); });
document.getElementById('clear-month').addEventListener('click', () => { state.month = ''; document.getElementById('month-filter').value = ''; render(); });

if (!location.hash) location.hash = '#/dashboard';
render();
