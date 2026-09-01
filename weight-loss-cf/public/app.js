// ---------------- API ----------------
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
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, digits = 0) => (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: digits });
const ltr = (text) => `<bdi dir="ltr">${text}</bdi>`;
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};
const shortDate = (s) => {
  const [, m, d] = String(s).slice(0, 10).split('-');
  return `${Number(d)}.${Number(m)}`;
};
const todayISO = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const pct = (value, goal) => (goal > 0 ? Math.round((value / goal) * 100) : 0);
const signed = (n, digits = 1) => `${n > 0 ? '+' : ''}${nf(n, digits)}`;

/** The four registration marks every framed object in this system wears. */
const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';

const state = { me: null };

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3000);
}

// ---------------- Charts ----------------
/** Weight over time: a thin steel line on a hairline grid, per the design system. */
function lineChart(points, { unit = '', digits = 1 } = {}) {
  if (points.length < 2) {
    return '<div class="empty">צריך לפחות שתי שקילות כדי להציג מגמה</div>';
  }
  const W = 660, H = 260, padX = 46, padY = 30;
  const values = points.map((p) => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.2, hi = max + span * 0.2;
  const x = (i) => padX + (i * (W - padX * 2)) / (points.length - 1);
  const y = (v) => H - padY - ((v - lo) / (hi - lo)) * (H - padY * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const every = Math.ceil(points.length / 7);

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="מגמת משקל לאורך ${points.length} שקילות">
      ${[lo, (lo + hi) / 2, hi].map((t) => `
        <line class="grid-line" x1="${padX}" y1="${y(t).toFixed(1)}" x2="${W - padX}" y2="${y(t).toFixed(1)}"/>
        <text class="lbl" x="${W - padX + 7}" y="${(y(t) + 3).toFixed(1)}">${nf(t, digits)}</text>`).join('')}
      <path class="line" d="${path}"/>
      ${points.map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5"><title>${esc(p.label)}: ${nf(p.value, digits)}${unit}</title></circle>`).join('')}
      ${points.map((p, i) => (i % every === 0 || i === points.length - 1)
        ? `<text class="lbl" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(p.short)}</text>` : '').join('')}
    </svg>`;
}

function barChart(items, { goal = 0, unit = '', goodWhen = 'above' } = {}) {
  if (!items.length) return '<div class="empty">אין עדיין דיווחים להצגה</div>';
  const W = 660, H = 210, padX = 40, padY = 26;
  const max = Math.max(goal, ...items.map((i) => i.value)) * 1.15 || 1;
  const slot = (W - padX * 2) / items.length;
  const barW = Math.min(26, slot * 0.6);
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const every = Math.ceil(items.length / 8);

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      ${goal > 0 ? `<line class="goal-line" x1="${padX}" y1="${y(goal).toFixed(1)}" x2="${W - padX}" y2="${y(goal).toFixed(1)}"/>
        <text class="lbl" x="${W - padX + 6}" y="${(y(goal) + 3).toFixed(1)}">יעד</text>` : ''}
      ${items.map((item, i) => {
        const cx = padX + slot * i + slot / 2;
        const met = goal > 0 && (goodWhen === 'below' ? item.value <= goal : item.value >= goal);
        return `<rect class="bar-rect ${met ? 'met' : ''}" x="${(cx - barW / 2).toFixed(1)}" y="${y(item.value).toFixed(1)}"
                  width="${barW.toFixed(1)}" height="${Math.max(2, H - padY - y(item.value)).toFixed(1)}">
                  <title>${esc(item.label)}: ${nf(item.value)}${unit}</title></rect>
                ${i % every === 0 || i === items.length - 1
                  ? `<text class="lbl" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(item.short)}</text>` : ''}`;
      }).join('')}
    </svg>`;
}

// ---------------- Shared fragments ----------------
function goalRow(name, value, goal, { unit = '', goodWhen = 'above' } = {}) {
  const met = goal > 0 && (goodWhen === 'below' ? value <= goal : value >= goal);
  return `
    <div class="goal">
      <div class="goal-top">
        <span class="goal-name">${esc(name)}</span>
        <span class="goal-val">${ltr(`${nf(value)} / ${nf(goal)}${unit}`)}</span>
      </div>
      <div class="bar ${met ? 'met' : ''}"><span style="width:${Math.min(100, pct(value, goal))}%"></span></div>
    </div>`;
}

function statBlock(cells, { framed = true } = {}) {
  return `<div class="statgrid ${framed ? 'bp' : ''}">${framed ? corners() : ''}
    ${cells.map((c) => `<div><div class="val ${c.accent ? 'accent' : ''}">${c.value}</div><div class="cap">${esc(c.cap)}</div></div>`).join('')}
  </div>`;
}

// ---------------- Dialog ----------------
/** Built on the design system's .dialog classes: square, hairline, no rounding. */
function openModal(title, fieldsHTML, onSubmit, submitLabel = 'שמירה') {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.innerHTML = `
    <div class="dialog bp" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      ${corners()}
      <div class="dialog-title">${esc(title)}</div>
      <form class="dialog-form">
        <div class="dialog-body">${fieldsHTML}</div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-close>ביטול</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.hasAttribute('data-close')) close();
  });

  backdrop.querySelector('.dialog-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(e.target).entries()), e.target);
      close();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });

  backdrop.querySelector('input, textarea, select')?.focus();
  return backdrop;
}

function confirmAction(message, onConfirm) {
  return openModal('אישור', `<p style="margin:0; line-height:1.7">${esc(message)}</p>`, onConfirm, 'אישור');
}

// ---------------- Dashboard ----------------
/** Filled from /api/tips on first use so the editor's changes show up. */
let tipsCache = null;
async function loadTips() {
  if (!tipsCache) tipsCache = await api('/tips');
  return tipsCache;
}

/**
 * One rule of thumb at a time, swapped every few seconds. Which one shows first
 * follows the day, so two people opening the app together see the same line.
 */
function tipRotator(tips) {
  if (!tips.length) return '<div class="empty">אין עדיין כללי אצבע</div>';
  const start = Math.floor(Date.parse(todayISO()) / 86400000) % tips.length;
  return `
    <div class="rules" id="tip-rotator" data-index="${start}">
      ${tips.map((t, i) => `<div class="rule ${i === start ? 'is-shown' : ''}">${esc(t.text)}</div>`).join('')}
      <div class="rule-ticks">${tips.map((_, i) => `<i class="${i === start ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
}

/** Starts the swap once the markup is on the page. Honours reduced-motion by standing still. */
let tipTimer;
function startTipRotation() {
  clearInterval(tipTimer);
  const box = document.getElementById('tip-rotator');
  if (!box) return;
  const rules = [...box.querySelectorAll('.rule')];
  const ticks = [...box.querySelectorAll('.rule-ticks i')];
  if (rules.length < 2) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const show = (next) => {
    rules.forEach((r, i) => r.classList.toggle('is-shown', i === next));
    ticks.forEach((t, i) => t.classList.toggle('on', i === next));
    box.dataset.index = String(next);
  };
  tipTimer = setInterval(() => show((Number(box.dataset.index) + 1) % rules.length), 7000);

  // Clicking a tick jumps straight to that rule and stops the automatic swap.
  ticks.forEach((tick, i) => tick.addEventListener('click', () => { clearInterval(tipTimer); show(i); }));
}

async function viewDashboard(el) {
  const [me, stats, tips] = await Promise.all([api('/me'), api('/stats'), loadTips()]);
  state.me = me;
  const today = stats.logs.find((l) => l.date === stats.today);
  const calories = today ? today.calories_consumed : 0;
  const protein = today ? today.protein_consumed : 0;

  el.innerHTML = `
    <section class="hero bp">
      ${corners()}
      <div>
        <div class="label">מבוסס מדע · שינוי הרכב גוף</div>
        <h1>${esc(me.full_name)}</h1>
        <p>לא נשקלים כל בוקר. עומדים בשלושה יעדים יומיים — קלוריות, חלבון ואימון כוח —
           וסופרים את הימים שבהם עמדת בהם. הגוף עושה את השאר.</p>
      </div>
      ${statBlock([
        { value: nf(me.current_streak), cap: 'ימי רצף' },
        { value: `רמה ${me.level.level}`, cap: esc(me.level.title) },
        { value: nf(me.total_points), cap: 'נקודות', accent: true },
        { value: ltr(`${stats.workouts_this_week} / ${stats.weekly_workouts_goal}`), cap: 'אימוני כוח השבוע' },
      ], { framed: false })}
    </section>

    <div class="split">
      <div class="panel bp">
        ${corners()}
        <header>
          <h3>דיווח יומי</h3>
          <span class="when">${fmtDate(stats.today)}</span>
        </header>
        <form id="checkin-form">
          <div class="field">
            <label for="cal">סך קלוריות היום</label>
            <input class="input" id="cal" type="number" name="calories_consumed" min="0" max="20000"
                   value="${today ? today.calories_consumed : ''}" placeholder="${me.daily_calories_goal}" required />
          </div>
          <div class="field" style="margin-top:10px">
            <label for="prot">חלבון (גרם)</label>
            <input class="input" id="prot" type="number" name="protein_consumed" min="0" max="1000"
                   value="${today ? today.protein_consumed : ''}" placeholder="${me.daily_protein_goal}" required />
          </div>
          <label class="check">
            <input type="checkbox" name="strength_workout_done" ${today && today.strength_workout_done ? 'checked' : ''} />
            <span>עשיתי היום אימון כוח</span>
            <span class="xp">${ltr('+50 XP')}</span>
          </label>
          <button type="submit" class="btn btn-primary btn-block">${today ? 'עדכון הדיווח' : 'שמור דיווח'}</button>
        </form>
      </div>

      <div style="display:grid; gap:var(--space-8)">
        <div>
          <div class="sec" style="margin-bottom:var(--space-4)">
            <h2>היעדים של היום</h2>
            <p>שלוש שורות. זה כל מה שנמדד.</p>
          </div>
          <div class="goals">
            ${goalRow('קלוריות', calories, me.daily_calories_goal, { goodWhen: 'below' })}
            ${goalRow('חלבון', protein, me.daily_protein_goal, { unit: ' ג׳' })}
            ${goalRow('אימוני כוח בשבוע', stats.workouts_this_week, stats.weekly_workouts_goal)}
          </div>
        </div>

        <div>
          <div class="label">כלל האצבע</div>
          ${tipRotator(tips)}
        </div>
      </div>
    </div>

    ${me.badges.length ? `
      <div>
        <div class="sec" style="margin-bottom:var(--space-4)">
          <div class="kicker">הישגים</div>
          <h2>התגים שצברת</h2>
        </div>
        <div class="badges">${me.badges.map(badgeCard).join('')}</div>
      </div>` : ''}`;

  startTipRotation();

  el.querySelector('#checkin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button[type=submit]');
    button.disabled = true;
    const form = new FormData(e.target);
    try {
      const result = await api('/logs', {
        method: 'PUT',
        body: {
          calories_consumed: form.get('calories_consumed'),
          protein_consumed: form.get('protein_consumed'),
          strength_workout_done: form.get('strength_workout_done') === 'on',
        },
      });
      state.me = result.profile;
      announce(result);
      renderChrome();
      render();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });
}

/** Reward feedback shared by the daily log and the weigh-in. */
function announce(result) {
  if (result.points_gained > 0) toast(`נשמר · ${nf(result.points_gained)} נקודות`);
  else toast('הדיווח עודכן');
  (result.new_badges || []).forEach((badge, i) => {
    setTimeout(() => toast(`תג חדש — ${badge.name}`), 1600 * (i + 1));
  });
}

function badgeCard(badge) {
  const earned = !!badge.earned_at;
  return `
    <div class="badge bp ${earned ? '' : 'locked'}">
      ${corners()}
      <div class="label">${earned ? `הושג ${fmtDate(badge.earned_at)}` : 'נעול'}</div>
      <h4>${esc(badge.name)}</h4>
      <p>${esc(badge.description)}</p>
      <div class="label" style="color:var(--color-accent-700)">${ltr(`+${badge.points_reward} XP`)}</div>
    </div>`;
}

// ---------------- Progress ----------------
function readImageAsDataURL(file, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא הצלחנו לקרוא את הקובץ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('הקובץ אינו תמונה תקינה'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function viewProgress(el) {
  const [me, stats, badges] = await Promise.all([api('/me'), api('/stats'), api('/badges')]);
  state.me = me;
  const weighIns = [...stats.weigh_ins];
  const latest = weighIns[weighIns.length - 1];
  const points = weighIns.map((w) => ({ value: w.weight, label: fmtDate(w.date), short: shortDate(w.date) }));
  const rows = [...weighIns].reverse();

  el.innerHTML = `
    <div class="sec">
      <div class="kicker">${stats.weeks_in_program} שבועות בתוכנית</div>
      <h2>ההתקדמות שלך</h2>
      <p>המשקל הוא מדד אחד מתוך כמה. כשמסת השריר עולה במקביל, המשקל יורד לאט יותר — וזו בדיוק המטרה.</p>
    </div>

    <div class="split split-wide">
      <div>
        <div class="label">
          משקל · ק״ג${stats.weight_change !== null
            ? ` — ${ltr(`${nf(stats.weight_start, 1)} → ${nf(stats.weight_latest, 1)} · ${signed(stats.weight_change)}`)}` : ''}
        </div>
        ${lineChart(points, { unit: ' ק״ג' })}
      </div>

      <div class="panel bp">
        ${corners()}
        <header><h3>שקילה שבועית</h3></header>
        <form id="weigh-form">
          <div class="form-row">
            <div class="field">
              <label for="w-weight">משקל נוכחי (ק״ג)</label>
              <input class="input" id="w-weight" type="number" name="weight" min="20" max="400" step="0.1"
                     value="${latest ? latest.weight : ''}" required />
            </div>
            <div class="field">
              <label for="w-waist">היקף מותניים (ס״מ)</label>
              <input class="input" id="w-waist" type="number" name="waist" min="30" max="250" step="0.1"
                     value="${latest && latest.waist != null ? latest.waist : ''}" />
            </div>
          </div>
          <div class="field" style="margin-top:10px">
            <label for="w-date">תאריך</label>
            <input class="input" id="w-date" type="date" name="date" value="${todayISO()}" max="${todayISO()}" required />
          </div>
          <div class="field" style="margin-top:10px">
            <label for="w-photo">תמונת התקדמות (רשות · פרטית)</label>
            <input class="input" id="w-photo" type="file" name="photo" accept="image/png,image/jpeg,image/webp" />
          </div>
          <button type="submit" class="btn btn-primary btn-block">שמור שקילה · ${ltr('+100 XP')}</button>
        </form>
      </div>
    </div>

    <div class="statrow bp">
      ${corners()}
      <div><div class="val accent">${nf(stats.total_workouts)}</div><div class="cap">אימוני כוח שהושלמו</div></div>
      <div><div class="val">${nf(stats.protein_goal_days_30)}</div><div class="cap">ימים ביעד החלבון · 30 יום</div></div>
      <div><div class="val">${nf(stats.logged_days_30)}</div><div class="cap">ימי דיווח · 30 יום</div></div>
      <div><div class="val">${stats.waist_change === null ? '—' : signed(stats.waist_change)}</div><div class="cap">שינוי בהיקף המותניים · ס״מ</div></div>
    </div>

    <div class="split">
      <div>
        <div class="label">קלוריות · 30 יום</div>
        ${barChart(stats.logs.map((l) => ({ value: l.calories_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
          { goal: me.daily_calories_goal, goodWhen: 'below' })}
      </div>
      <div>
        <div class="label">חלבון · 30 יום</div>
        ${barChart(stats.logs.map((l) => ({ value: l.protein_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
          { goal: me.daily_protein_goal, unit: ' ג׳' })}
      </div>
    </div>

    <div>
      <div class="label">שקילות</div>
      ${rows.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>שבוע</th><th>משקל</th><th>שינוי</th><th>מותניים</th><th>תמונה</th></tr></thead>
            <tbody>
              ${rows.map((w, i) => {
                const previous = rows[i + 1];
                const diff = previous ? w.weight - previous.weight : null;
                return `<tr>
                  <td>${fmtDate(w.date)}</td>
                  <td>${ltr(nf(w.weight, 1))}</td>
                  <td>${diff === null ? '—' : ltr(signed(diff))}</td>
                  <td>${w.waist == null ? '—' : ltr(nf(w.waist, 1))}</td>
                  <td>${w.photo_url ? `<a href="/api/weigh-ins/${w.id}/photo" target="_blank" rel="noopener">צפייה</a>` : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : '<div class="empty">עוד לא נרשמה שקילה</div>'}
    </div>

    <div>
      <div class="sec" style="margin-bottom:var(--space-4)">
        <div class="kicker">הישגים</div>
        <h2>תגים</h2>
      </div>
      <div class="badges">${badges.map(badgeCard).join('')}</div>
    </div>`;

  el.querySelector('#weigh-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button[type=submit]');
    button.disabled = true;
    const form = new FormData(e.target);
    try {
      const file = form.get('photo');
      const body = { date: form.get('date'), weight: form.get('weight'), waist: form.get('waist') };
      if (file && file.size) body.photo = await readImageAsDataURL(file);
      const result = await api('/weigh-ins', { method: 'POST', body });
      state.me = result.profile;
      announce(result);
      renderChrome();
      render();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });
}

// ---------------- The group ----------------
async function viewGroup(el) {
  const group = await api('/group');
  let selected = group.members[0];

  const panel = (member) => {
    if (!member) return '<div class="empty">אין עדיין חברים בקבוצה</div>';
    return `
      <div class="panel bp">
        ${corners()}
        <div class="label">אזור אישי</div>
        <h3 style="margin:0; font-size:26px">${esc(member.full_name)}</h3>
        ${statBlock([
          { value: member.weight_change === null ? '—' : signed(member.weight_change), cap: 'ק״ג מאז ההתחלה', accent: true },
          { value: nf(member.current_streak), cap: 'ימי רצף' },
          { value: nf(member.total_points), cap: 'נקודות' },
          { value: nf(member.weeks_in_program), cap: 'שבועות בתוכנית' },
        ], { framed: false })}
        <div class="goal">
          <div class="goal-top">
            <span class="goal-name">אימוני כוח השבוע</span>
            <span class="goal-val">${ltr(`${member.workouts_this_week} / ${member.weekly_workouts_goal}`)}</span>
          </div>
          <div class="bar ${member.workouts_this_week >= member.weekly_workouts_goal ? 'met' : ''}">
            <span style="width:${Math.min(100, pct(member.workouts_this_week, member.weekly_workouts_goal))}%"></span>
          </div>
        </div>
        <p class="note-line">
          ${member.logged_days_30} ימי דיווח ו-${member.protein_goal_days_30} ימים ביעד החלבון ב-30 הימים האחרונים.
        </p>
      </div>`;
  };

  el.innerHTML = `
    <div class="sec">
      <div class="kicker">קבוצה וחברים</div>
      <h2>כמה ירדנו יחד</h2>
      <p>הסכום של כל החברים בקבוצה, מאז היום הראשון. לכל אחד יש אזור אישי משלו — לחיצה על שם פותחת אותו.</p>
    </div>

    <div class="statrow bp">
      ${corners()}
      <div>
        <div class="val big">${nf(group.total_kg_lost, 1)}<span style="font-size:.4em"> ק״ג</span></div>
        <div class="cap">ירידה מצטברת של הקבוצה</div>
      </div>
      <div>
        <div class="val accent">${nf(group.goal_kg)}<span style="font-size:.5em"> ק״ג</span></div>
        <div class="cap">היעד הקבוצתי</div>
      </div>
      <div><div class="val">${nf(group.member_count)}</div><div class="cap">חברים פעילים</div></div>
      <div><div class="val">${nf(group.workouts_this_week)}</div><div class="cap">אימוני כוח השבוע</div></div>
      <div><div class="val">${nf(group.longest_streak)}</div><div class="cap">הרצף הארוך בקבוצה</div></div>
    </div>

    <div>
      <div class="goal">
        <div class="goal-top">
          <span class="goal-name">בדרך ל-${nf(group.goal_kg)} ק״ג</span>
          <span class="goal-val">${ltr(`${nf(group.total_kg_lost, 1)} / ${nf(group.goal_kg)}`)} · ${group.goal_progress_pct}%</span>
        </div>
        <div class="bar ${group.goal_progress_pct >= 100 ? 'met' : ''}">
          <span style="width:${group.goal_progress_pct}%"></span>
        </div>
        <p class="note-line" style="margin-top:6px">
          ${group.goal_progress_pct >= 100
            ? 'היעד הושג. הגיע הזמן לקבוע חדש.'
            : `נותרו ${nf(group.goal_remaining_kg, 1)} ק״ג ליעד.`}
        </p>
      </div>
    </div>

    <div class="split split-wide">
      <div>
        <div class="label">החברים</div>
        <div class="members" id="members">
          ${group.members.map((m) => `
            <button class="member ${m.id === selected?.id ? 'active' : ''}" data-id="${m.id}" type="button">
              <span>
                <span class="who">${esc(m.full_name)}</span>
                <span class="facts">
                  <span>${ltr(`${m.weeks_in_program} שב׳`)}</span>
                  <span>${ltr(`${m.current_streak} רצף`)}</span>
                  <span>${ltr(`${nf(m.total_points)} XP`)}</span>
                </span>
              </span>
              <span class="kg">${m.weight_change === null ? '—' : ltr(`${signed(m.weight_change)} ק״ג`)}</span>
            </button>`).join('')}
        </div>
      </div>
      <div id="member-panel">${panel(selected)}</div>
    </div>

    <p class="disclaimer">
      חברי הקבוצה רואים זה את זה רק את המספרים שלמעלה. הדיווחים היומיים, השקילות והתמונות נשארים פרטיים.
    </p>`;

  el.querySelectorAll('.member').forEach((button) => {
    button.addEventListener('click', () => {
      selected = group.members.find((m) => m.id === Number(button.dataset.id));
      el.querySelectorAll('.member').forEach((b) => b.classList.toggle('active', b === button));
      document.getElementById('member-panel').innerHTML = panel(selected);
    });
  });
}

// ---------------- The science ----------------
const MECHANISMS = [
  {
    title: 'גירעון קלורי קובע את הכיוון',
    body: 'ירידה במשקל דורשת צריכה נמוכה מההוצאה. גודל הגירעון קובע את הקצב, אבל לא את ההרכב — כמה מהירידה תגיע משומן וכמה משריר נקבע בשני המנגנונים הבאים.',
  },
  {
    title: 'חלבון שומר על מסת השריר',
    body: 'צריכת חלבון גבוהה בזמן גירעון מצמצמת את איבוד המסה הרזה ומגדילה את השובע. זו הסיבה שיעד החלבון היומי הוא מדד נפרד, ולא חלק מיעד הקלוריות.',
  },
  {
    title: 'אימון כוח הוא האות לגוף',
    body: 'אימון התנגדות מספק את הגירוי שמכוון את הגוף לשמר — ובתנאים מסוימים גם להוסיף — רקמת שריר תוך כדי ירידה בשומן. בלעדיו, חלק מהירידה יבוא מהשריר.',
  },
];

const REFERENCES = [
  { cite: 'Longland TM et al.', body: 'גירעון קלורי עם 2.4 ג׳/ק״ג חלבון לעומת 1.2 ג׳/ק״ג, בשילוב אימוני התנגדות: הקבוצה עם החלבון הגבוה הוסיפה מסה רזה.' },
  { cite: 'Morton RW et al.', body: 'מטא־אנליזה: תוספת חלבון מעל צריכת בסיס מגדילה את הרווח במסה ובכוח באימוני התנגדות, עד רמת רוויה.' },
  { cite: 'Leidy HJ et al.', body: 'סקירה על תפקיד החלבון בירידה במשקל ובשמירה עליו, כולל השפעתו על שובע ועל שימור מסה רזה.' },
  { cite: 'Burke LE et al.', body: 'סקירה שיטתית: ניטור עצמי של תזונה קשור באופן עקבי לתוצאות טובות יותר בירידה במשקל.' },
];

async function viewScience(el) {
  el.innerHTML = `
    <div class="sec">
      <div class="kicker">המדע מאחורי זה</div>
      <h2>שלושה מנגנונים, בסדר הזה</h2>
      <p>המערכת עוקבת אחרי שלושה משתנים בלבד, כי אלה השלושה שהספרות מזהה כמכריעים בשינוי הרכב הגוף.</p>
    </div>

    <div class="mechanisms">
      ${MECHANISMS.map((m, i) => `
        <div class="mechanism">
          <div class="num">${String(i + 1).padStart(2, '0')}</div>
          <h3>${esc(m.title)}</h3>
          <p>${esc(m.body)}</p>
        </div>`).join('')}
    </div>

    <div class="split">
      <div class="sec sec-sub">
        <h2>למה לא נשקלים כל יום</h2>
        <p>משקל יומי מושפע ממלח, פחמימות, מים ושינה, ותנודות של קילו וחצי הן שגרה.
           שקילה שבועית אחת מסננת את הרעש ומשאירה מגמה.</p>
        <p>לכן הדיווח היומי במערכת עוסק במה שבשליטתך — קלוריות, חלבון ואימון —
           והשקילה נשארת מדד מגמה שבועי.</p>
      </div>

      <div>
        <div class="label">הפניות</div>
        <div class="refs">
          ${REFERENCES.map((r) => `<div class="ref"><b>${esc(r.cite)}</b><p>${esc(r.body)}</p></div>`).join('')}
        </div>
      </div>
    </div>

    <p class="disclaimer">המידע כאן הוא חינוכי ואינו מחליף ייעוץ רפואי או תזונתי אישי.</p>`;
}

// ---------------- Articles ----------------
async function viewArticles(el) {
  const posts = await api('/posts');
  el.innerHTML = `
    <div class="sec">
      <div class="kicker">מאמרים</div>
      <h2>קריאה קצרה לכל שלב בדרך</h2>
    </div>
    ${posts.length ? `
      <div class="articles">
        ${posts.map((p) => `
          <a class="article bp" href="#/articles/${encodeURIComponent(p.slug)}">
            ${corners()}
            <span class="tag tag-accent">${esc(p.category)}</span>
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.excerpt)}</p>
            <span class="meta">${p.read_minutes} דקות קריאה</span>
          </a>`).join('')}
      </div>` : '<div class="empty">עוד לא פורסמו מאמרים</div>'}`;
}

/** Renders the seeded article body: blank lines split paragraphs, **bold** lines are sub-headings. */
async function viewArticle(el, slug) {
  const post = await api('/posts/' + encodeURIComponent(slug));
  const blocks = post.content.split('\n\n').map((block) => {
    const heading = /^\*\*(.+)\*\*$/.exec(block.trim());
    return heading ? `<h4>${esc(heading[1])}</h4>` : `<p>${esc(block.trim())}</p>`;
  }).join('');

  el.innerHTML = `
    <div>
      <a class="btn btn-ghost" href="#/articles">→ כל המאמרים</a>
    </div>
    <div class="sec">
      <span class="tag tag-accent" style="justify-self:start">${esc(post.category)}</span>
      <h2>${esc(post.title)}</h2>
      <p>${esc(post.excerpt)} · ${post.read_minutes} דקות קריאה</p>
    </div>
    <article class="article-body">${blocks}</article>`;
}

// ---------------- Settings ----------------
async function viewSettings(el) {
  const me = await api('/me');
  state.me = me;

  el.innerHTML = `
    <div class="sec">
      <div class="kicker">הגדרות</div>
      <h2>היעדים שלך</h2>
      <p>שלושת המספרים שהמערכת מודדת מולם. אפשר לשנות אותם בכל שלב —
         עדיף יעד שאפשר לעמוד בו ברציפות מאשר יעד שאפתני שנשבר כל שבוע.</p>
    </div>

    <div class="split">
      <div class="panel bp">
        ${corners()}
        <header><h3>יעדים</h3></header>
        <form id="goals-form">
          <div class="field">
            <label for="g-name">שם מלא</label>
            <input class="input" id="g-name" type="text" name="full_name" value="${esc(me.full_name)}" required />
          </div>
          <div class="form-row" style="margin-top:10px">
            <div class="field">
              <label for="g-cal">יעד קלוריות יומי</label>
              <input class="input" id="g-cal" type="number" name="daily_calories_goal" min="500" max="10000"
                     value="${me.daily_calories_goal}" required />
            </div>
            <div class="field">
              <label for="g-prot">יעד חלבון יומי (ג׳)</label>
              <input class="input" id="g-prot" type="number" name="daily_protein_goal" min="10" max="500"
                     value="${me.daily_protein_goal}" required />
            </div>
          </div>
          <div class="field" style="margin-top:10px">
            <label for="g-work">אימוני כוח בשבוע</label>
            <input class="input" id="g-work" type="number" name="weekly_workouts_goal" min="0" max="14"
                   value="${me.weekly_workouts_goal}" required />
          </div>
          <button type="submit" class="btn btn-primary btn-block">שמירת היעדים</button>
        </form>
      </div>

      <div class="panel bp">
        ${corners()}
        <header><h3>סיסמה</h3></header>
        <form id="password-form">
          <div class="field">
            <label for="p-cur">סיסמה נוכחית</label>
            <input class="input" id="p-cur" type="password" name="current_password" required />
          </div>
          <div class="field" style="margin-top:10px">
            <label for="p-new">סיסמה חדשה</label>
            <input class="input" id="p-new" type="password" name="new_password" minlength="6" required />
          </div>
          <button type="submit" class="btn btn-secondary btn-block">עדכון הסיסמה</button>
        </form>
        <p class="note-line">
          החשבון רשום לכתובת ${esc(me.email)}.
        </p>
      </div>
    </div>`;

  el.querySelector('#goals-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.me = await api('/me/goals', { method: 'PUT', body: Object.fromEntries(new FormData(e.target).entries()) });
      renderChrome();
      toast('היעדים עודכנו');
    } catch (err) {
      toast(err.message, true);
    }
  });

  el.querySelector('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target).entries()) });
      e.target.reset();
      toast('הסיסמה עודכנה');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------- Welcome (visitors) ----------------
/** What the site is, before anyone has handed over an email address. */
async function viewHome(el) {
  const [summary, posts, group] = await Promise.all([
    api('/public/summary'), api('/posts'), api('/public/goal'),
  ]);

  // The same framed two-column hero a member sees, with the group's public
  // numbers standing in for the personal ones. Below the privacy floor there
  // are no group numbers to show, so the programme's own shape fills the block.
  const cells = summary.totals_visible
    ? [
        { value: nf(summary.total_kg_lost, 1), cap: 'ק״ג ירדו יחד', accent: true },
        { value: nf(summary.member_count), cap: 'חברים פעילים' },
        { value: nf(summary.workouts_this_week), cap: 'אימוני כוח השבוע' },
        { value: nf(summary.longest_streak), cap: 'הרצף הארוך בקבוצה' },
      ]
    : [
        { value: '3', cap: 'יעדים יומיים', accent: true },
        { value: '1', cap: 'שקילה בשבוע' },
        { value: nf(summary.post_count), cap: 'מאמרים פתוחים' },
        { value: '0', cap: 'עלות בשקלים' },
      ];

  el.innerHTML = `
    <section class="hero bp">
      ${corners()}
      <div>
        <div class="label">מבוסס מדע · שינוי הרכב גוף</div>
        <h1>יחד נוריד ${nf(group.goal_kg)} קילו שומן</h1>
        <p class="slogan-sub">הדרך הקלה לירידה במשקל</p>
        <p>לא נשקלים כל בוקר. עומדים בשלושה יעדים יומיים — קלוריות, חלבון ואימון כוח —
           וסופרים את הימים שבהם עמדת בהם. הגוף עושה את השאר.</p>
        <div class="gate-actions">
          <button class="btn btn-primary" data-auth="register" type="button">הצטרפות לקבוצה</button>
          <a class="btn btn-secondary" href="#/science">קודם כל, המדע</a>
        </div>
        <p class="hero-note">הקריאה פתוחה לכולם. חשבון נדרש רק כדי להצטרף לקבוצה ולרשום משקלים.</p>
      </div>
      ${statBlock(cells, { framed: false })}
    </section>

    <div class="sec">
      <div class="kicker">איך זה עובד</div>
      <h2>שלושה מספרים ביום, שקילה אחת בשבוע</h2>
    </div>

    <div class="mechanisms">
      ${[
        { title: 'מדווחים שלושה מספרים', body: 'קלוריות, חלבון והאם היה אימון כוח. דיווח אחד ביום, פחות מחצי דקה.' },
        { title: 'נשקלים פעם בשבוע', body: 'משקל יומי מושפע ממלח, מים ושינה. שקילה שבועית מסננת את הרעש ומשאירה מגמה.' },
        { title: 'רואים את הקבוצה', body: 'החברים רואים זה את זה — זה מה שמחזיק את הרצף כשהמוטיבציה נגמרת.' },
      ].map((m, i) => `
        <div class="mechanism">
          <div class="num">${String(i + 1).padStart(2, '0')}</div>
          <h3>${esc(m.title)}</h3>
          <p>${esc(m.body)}</p>
        </div>`).join('')}
    </div>

    ${posts.length ? `
      <div class="sec">
        <div class="kicker">מאמרים · פתוח לכולם</div>
        <h2>קריאה קצרה לכל שלב בדרך</h2>
        <p>אין צורך בחשבון כדי לקרוא — כל המאמרים פתוחים.</p>
      </div>
      <div class="articles">
        ${posts.slice(0, 3).map((p) => `
          <a class="article bp" href="#/articles/${encodeURIComponent(p.slug)}">
            ${corners()}
            <span class="tag tag-accent">${esc(p.category)}</span>
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.excerpt)}</p>
            <span class="meta">${p.read_minutes} דקות קריאה</span>
          </a>`).join('')}
      </div>
      ${posts.length > 3 ? '<div><a class="btn btn-ghost" href="#/articles">כל המאמרים →</a></div>' : ''}` : ''}

    <p class="disclaimer">המידע כאן הוא חינוכי ואינו מחליף ייעוץ רפואי או תזונתי אישי.</p>`;
}

/** Why this particular screen needs an account, said in its own terms. */
const GATES = {
  dashboard: {
    title: 'הדיווח היומי נשמר בחשבון',
    body: 'הדאשבורד עוקב אחרי הקלוריות, החלבון והאימונים שלך יום אחרי יום — ולכן הוא צריך מקום לשמור אותם.',
  },
  progress: {
    title: 'ההתקדמות מתחילה בשקילה הראשונה',
    body: 'הגרפים כאן נבנים מהשקילות השבועיות שלך. בלי חשבון אין מה לצייר.',
  },
  group: {
    title: 'הקבוצה פתוחה לחברים רשומים',
    body: 'חברי הקבוצה רואים את המספרים הראשיים אחד של השני — זה מה שמחזיק את המחויבות. הדיווחים היומיים, התמונות והאימייל נשארים פרטיים לחלוטין.',
  },
  settings: {
    title: 'היעדים נשמרים בחשבון',
    body: 'יעד קלוריות, חלבון ואימונים הם הגדרות אישיות, ולכן הם דורשים חשבון.',
  },
};

function renderGate(el, route) {
  const gate = GATES[route.path] || { title: 'החלק הזה דורש חשבון', body: '' };
  el.innerHTML = `
    <div class="sec">
      <div class="kicker">${esc(route.title)}</div>
      <h2>${esc(gate.title)}</h2>
      <p>${esc(gate.body)}</p>
    </div>

    <div class="panel bp">
      ${corners()}
      <header><h3>הרשמה</h3></header>
      <p class="note-line" style="font-size:15px">
        שם, אימייל וסיסמה — פחות מדקה, בלי עלות.
      </p>
      <div class="gate-actions">
        <button class="btn btn-primary" data-auth="register" type="button">הרשמה והצטרפות לקבוצה</button>
        <button class="btn btn-secondary" data-auth="login" type="button">כבר יש לי חשבון</button>
      </div>
    </div>

    <p class="disclaimer">
      <a href="#/articles">המאמרים</a> ו<a href="#/science">המדע</a> פתוחים לכולם, בלי הרשמה ובלי חשבון.
    </p>`;
}

// ---------------- Routing ----------------
// ---------------- Editor ----------------
const CATEGORIES = ['תזונה', 'אימונים', 'מנטלי', 'כללי'];

async function viewEditor(el) {
  const [posts, tips] = await Promise.all([api('/editor/posts'), api('/tips')]);

  el.innerHTML = `
    <div class="sec">
      <div class="kicker">עריכה</div>
      <h2>תוכן ויעדים</h2>
      <p>מה שנכתב כאן מופיע מיד באתר. אין שלב פרסום נפרד.</p>
    </div>

    <div>
      <div class="sec-row" style="margin-bottom:var(--space-6)">
        <div class="sec">
          <div class="kicker">ספריית התוכן</div>
          <h2>מאמרים</h2>
          <p>${posts.length} מאמרים באתר. עריכה נכנסת לתוקף מיד.</p>
        </div>
        <button class="btn btn-primary" id="new-post" type="button">מאמר חדש</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>כותרת</th><th>קטגוריה</th><th>קריאה</th><th>פורסם</th><th></th></tr></thead>
          <tbody>
            ${posts.map((p) => `
              <tr data-post="${p.id}">
                <td>${esc(p.title)}</td>
                <td><span class="tag tag-accent">${esc(p.category)}</span></td>
                <td>${p.read_minutes} דק׳</td>
                <td>${fmtDate(p.published_at)}</td>
                <td>
                  <span class="row-actions">
                    <button class="btn btn-secondary btn-sm" data-edit-post type="button">עריכה</button>
                    <button class="btn btn-secondary btn-sm" data-del-post type="button">מחיקה</button>
                  </span>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="sec" style="margin-bottom:var(--space-6)">
        <div class="kicker">כלל האצבע</div>
        <h2>כללי אצבע</h2>
        <p>שורה אחת כל אחד. מופיעים בדאשבורד של כל חבר בקבוצה.</p>
      </div>
      <div class="rowlist" id="tip-list">
        ${tips.map((t) => `
          <div class="row" data-tip="${t.id}">
            <span class="row-text">${esc(t.text)}</span>
            <span class="row-actions">
              <button class="btn btn-secondary btn-sm" data-edit-tip type="button">עריכה</button>
              <button class="btn btn-secondary btn-sm" data-del-tip type="button">מחיקה</button>
            </span>
          </div>`).join('')}
      </div>
      <form id="tip-form" class="add-row">
        <input class="input" name="text" maxlength="200" placeholder="כלל אצבע חדש — שורה אחת" required />
        <button type="submit" class="btn btn-primary">הוספה</button>
      </form>
    </div>`;

  const reload = () => { tipsCache = null; render(); };

  el.querySelector('#tip-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/tips', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) });
      toast('הטיפ נוסף');
      reload();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelectorAll('[data-edit-tip]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('[data-tip]');
      const tip = tips.find((t) => t.id === Number(row.dataset.tip));
      openModal('עריכת כלל אצבע', `
        <div class="field"><label>הטקסט</label>
          <input class="input" name="text" maxlength="200" value="${esc(tip.text)}" required /></div>`,
        async (form) => {
          await api('/tips/' + tip.id, { method: 'PUT', body: form });
          toast('הטיפ עודכן');
          reload();
        });
    });
  });

  el.querySelectorAll('[data-del-tip]').forEach((button) => {
    button.addEventListener('click', () => {
      const tip = tips.find((t) => t.id === Number(button.closest('[data-tip]').dataset.tip));
      confirmAction(`למחוק את הכלל "${tip.text}"?`, async () => {
        await api('/tips/' + tip.id, { method: 'DELETE' });
        toast('נמחק');
        reload();
      });
    });
  });

  const postFields = (post = {}) => `
    <div class="field"><label>כותרת</label>
      <input class="input" name="title" value="${esc(post.title || '')}" required /></div>
    <div class="field" style="margin-top:10px"><label>קטגוריה</label>
      <select class="input" name="category">
        ${CATEGORIES.map((c) => `<option ${post.category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select></div>
    <div class="field" style="margin-top:10px"><label>תקציר — השורה שמופיעה בכרטיס</label>
      <input class="input" name="excerpt" value="${esc(post.excerpt || '')}" /></div>
    <div class="field" style="margin-top:10px"><label>זמן קריאה בדקות — ריק לחישוב אוטומטי</label>
      <input class="input" type="number" name="read_minutes" min="1" max="90" value="${post.read_minutes || ''}" /></div>
    <div class="field" style="margin-top:10px"><label>תוכן — שורה ריקה מפרידה פסקאות, ו-**כותרת** יוצרת כותרת משנה</label>
      <textarea class="input" name="content" rows="14" required>${esc(post.content || '')}</textarea></div>`;

  el.querySelector('#new-post').addEventListener('click', () => {
    openModal('מאמר חדש', postFields(), async (form) => {
      await api('/posts', { method: 'POST', body: form });
      toast('המאמר פורסם');
      render();
    }, 'פרסום');
  });

  el.querySelectorAll('[data-edit-post]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = posts.find((p) => p.id === Number(button.closest('[data-post]').dataset.post));
      openModal('עריכת מאמר', postFields(post), async (form) => {
        await api('/posts/' + post.id, { method: 'PUT', body: form });
        toast('המאמר עודכן');
        render();
      });
    });
  });

  el.querySelectorAll('[data-del-post]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = posts.find((p) => p.id === Number(button.closest('[data-post]').dataset.post));
      confirmAction(`למחוק את "${post.title}"?`, async () => {
        await api('/posts/' + post.id, { method: 'DELETE' });
        toast('נמחק');
        render();
      });
    });
  });
}

const ROUTES = [
  { path: 'home', title: 'ראשי', render: viewHome, open: true, guestOnly: true },
  { path: 'dashboard', title: 'דאשבורד', render: viewDashboard },
  { path: 'progress', title: 'התקדמות', render: viewProgress },
  { path: 'group', title: 'הקבוצה', render: viewGroup },
  { path: 'science', title: 'המדע', render: viewScience, open: true },
  { path: 'articles', title: 'מאמרים', render: viewArticles, open: true },
  { path: 'settings', title: 'הגדרות', render: viewSettings },
  { path: 'editor', title: 'עריכה', render: viewEditor, editorOnly: true },
];

const homePath = () => (state.me ? 'dashboard' : 'home');
const currentPath = () => location.hash.replace(/^#\/?/, '') || homePath();

function renderChrome() {
  const path = currentPath();
  const signedIn = !!state.me;

  // Visitors get the tabs that work without an account; members lose the welcome tab.
  document.getElementById('tabs').innerHTML = ROUTES
    .filter((r) => (signedIn ? !r.guestOnly : r.open))
    .filter((r) => !r.editorOnly || state.me?.is_editor)
    .map((r) => `<a href="#/${r.path}" class="${path === r.path || path.startsWith(r.path + '/') ? 'active' : ''}">${r.title}</a>`)
    .join('');

  // On a narrow screen the strip scrolls, so bring the current tab into view.
  document.querySelector('#tabs a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });

  document.getElementById('readout-member').classList.toggle('hidden', !signedIn);
  document.getElementById('readout-guest').classList.toggle('hidden', signedIn);
  if (signedIn) {
    document.getElementById('xp-readout').textContent = nf(state.me.total_points);
    document.getElementById('streak-readout').textContent = nf(state.me.current_streak);
  }
}

async function render() {
  const path = currentPath();
  const el = document.getElementById('view');
  const article = /^articles\/(.+)$/.exec(path);
  const route = ROUTES.find((r) => r.path === path);

  renderChrome();
  el.className = 'screen';
  el.innerHTML = '<div class="empty">טוען…</div>';
  try {
    if (article) await viewArticle(el, decodeURIComponent(article[1]));
    else if (!route || (route.guestOnly && state.me)) { location.hash = '#/' + homePath(); return; }
    // The editor tab is not just hidden from members — the route itself is closed.
    else if (route.editorOnly && !state.me?.is_editor) { location.hash = '#/' + homePath(); return; }
    else if (!route.open && !state.me) renderGate(el, route);
    else await route.render(el);
    renderChrome();
  } catch (err) {
    if (/התחברות/.test(err.message)) return boot();
    el.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

// ---------------- Auth overlay ----------------
/** The sign-in card sits over the site rather than in front of it — closing it returns you to what you were reading. */
let authMode = 'login';

function applyAuthMode() {
  const form = document.getElementById('auth-form');
  const submit = document.getElementById('auth-submit');
  document.querySelectorAll('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === authMode));
  document.querySelectorAll('.register-only').forEach((node) => node.classList.toggle('hidden', authMode !== 'register'));
  form.full_name.required = authMode === 'register';
  form.password.autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
  submit.textContent = authMode === 'register' ? 'יצירת חשבון' : 'התחברות';
  document.getElementById('auth-error').textContent = '';
}

function openAuth(mode = 'login') {
  authMode = mode;
  applyAuthMode();
  document.getElementById('auth').classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById(mode === 'register' ? 'af-name' : 'af-email').focus();
}

function closeAuth() {
  document.getElementById('auth').classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function setupAuthScreen() {
  const form = document.getElementById('auth-form');
  const error = document.getElementById('auth-error');
  const submit = document.getElementById('auth-submit');

  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => { authMode = tab.dataset.mode; applyAuthMode(); });
  });

  document.getElementById('auth-close').addEventListener('click', closeAuth);
  document.getElementById('auth').addEventListener('mousedown', (e) => {
    if (e.target.id === 'auth') closeAuth();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('auth').classList.contains('hidden')) closeAuth();
  });

  // Every "register" / "login" button on any screen opens this same card.
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-auth]');
    if (trigger) openAuth(trigger.dataset.auth);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      state.me = await api('/auth/' + authMode, { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) });
      form.reset();
      closeAuth();
      // Stay where you were: render() now resolves the same route as a member, so
      // signing up from a gated screen drops you straight into it. The welcome tab
      // is the one exception, and render() redirects that to the dashboard itself.
      render();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  applyAuthMode();
}

function showApp() {
  document.getElementById('app').classList.remove('hidden');
}

// ---------------- Boot ----------------
async function boot() {
  try {
    state.me = await api('/me');
  } catch {
    state.me = null;
  }
  closeAuth();
  showApp();
  render();
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  state.me = null;
  if (location.hash === '#/home' || !location.hash) render();
  else location.hash = '#/home';
});

window.addEventListener('hashchange', render);

setupAuthScreen();
boot();
