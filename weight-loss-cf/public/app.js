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
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
const shortDate = (s) => {
  const [, m, d] = String(s).slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}`;
};
const ltr = (text) => `<bdi dir="ltr">${text}</bdi>`;
const nf = (n, digits = 0) => (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: digits });
const todayISO = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const pct = (value, goal) => (goal > 0 ? Math.round((value / goal) * 100) : 0);

const state = { me: null, view: '' };

// ---------------- Lucide-style icons ----------------
const ICONS = {
  dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
  drumstick: '<path d="M15.45 15.4c-2.13.65-4.3.32-5.7-1.1-2.29-2.27-1.76-6.5 1.17-9.42 2.93-2.93 7.15-3.46 9.42-1.17 1.42 1.41 1.75 3.57 1.1 5.7"/><path d="m8.5 16.5-5.14 5.14a2 2 0 1 1-2.83-2.83L5.68 13.6"/><circle cx="8.5" cy="15.5" r="2.5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
};
const icon = (name, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.award}</svg>`;

// ---------------- Toast & celebrations ----------------
let toastTimer;
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
}

function confetti(count = 70) {
  const layer = document.getElementById('confetti');
  const colors = ['#2f9e6e', '#58d09a', '#ff8a3d', '#7c5cff', '#ffd166', '#4ea8ff'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 260}px`);
    piece.style.setProperty('--spin', `${Math.random() * 900 - 450}deg`);
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), 3000);
  }
}

/** Animates a number from its previous value to the new one. */
function countUp(el, to, { from = 0, duration = 900, digits = 0 } = {}) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = nf(from + (to - from) * eased, digits);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------- Modal ----------------
function openModal(title, fieldsHTML, onSubmit, submitLabel = 'שמירה') {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
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
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.hasAttribute('data-close')) close();
  });
  backdrop.querySelector('.modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(e.target).entries()), e.target);
      close();
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
  backdrop.querySelector('input, textarea, select')?.focus();
  return backdrop;
}

function confirmAction(message, onConfirm) {
  openModal('אישור פעולה', `<p style="line-height:1.7">${esc(message)}</p>`, onConfirm, 'אישור');
}

// ---------------- Charts (inline SVG) ----------------
function lineChart(points, { color = '#2f9e6e', unit = '', digits = 1 } = {}) {
  if (points.length < 2) {
    return '<div class="empty"><span class="empty-ico">📈</span>צריך לפחות שתי מדידות כדי להציג גרף</div>';
  }
  const W = 640, H = 240, padX = 44, padY = 26;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;
  const x = (i) => padX + (i * (W - padX * 2)) / (points.length - 1);
  const y = (v) => H - padY - ((v - lo) / (hi - lo)) * (H - padY * 2);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${H - padY} L${padX},${H - padY} Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelEvery = Math.ceil(points.length / 7);

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity=".28"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${ticks.map((t) => `
        <line class="grid-line" x1="${padX}" y1="${y(t).toFixed(1)}" x2="${W - padX}" y2="${y(t).toFixed(1)}"/>
        <text class="label" x="${W - padX + 6}" y="${(y(t) + 3).toFixed(1)}">${nf(t, digits)}</text>`).join('')}
      <path d="${area}" fill="url(#areaFill)"/>
      <path class="line" d="${path}" stroke="${color}"/>
      ${points.map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="${color}"><title>${esc(p.label)}: ${nf(p.value, digits)}${unit}</title></circle>`).join('')}
      ${points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1)
        ? `<text class="label" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(p.short)}</text>` : '').join('')}
    </svg>`;
}

function barChart(items, { goal = 0, color = '#2f9e6e', goalColor = '#dc2626', unit = '', goodWhen = 'above' } = {}) {
  if (!items.length) {
    return '<div class="empty"><span class="empty-ico">📊</span>אין עדיין דיווחים להצגה</div>';
  }
  const W = 640, H = 220, padX = 40, padY = 24;
  const max = Math.max(goal, ...items.map((i) => i.value)) * 1.12 || 1;
  const slot = (W - padX * 2) / items.length;
  const barW = Math.min(30, slot * 0.62);
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const labelEvery = Math.ceil(items.length / 8);

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      <line class="axis" x1="${padX}" y1="${H - padY}" x2="${W - padX}" y2="${H - padY}"/>
      ${goal > 0 ? `
        <line x1="${padX}" y1="${y(goal).toFixed(1)}" x2="${W - padX}" y2="${y(goal).toFixed(1)}"
              stroke="${goalColor}" stroke-width="1.5" stroke-dasharray="5 4"/>
        <text class="label" x="${W - padX + 4}" y="${(y(goal) + 3).toFixed(1)}">יעד</text>` : ''}
      ${items.map((item, i) => {
        const cx = padX + slot * i + slot / 2;
        const height = Math.max(2, H - padY - y(item.value));
        const met = goal > 0 && (goodWhen === 'below' ? item.value <= goal : item.value >= goal);
        const fill = met ? color : '#c7d2de';
        return `<rect class="bar-rect" x="${(cx - barW / 2).toFixed(1)}" y="${y(item.value).toFixed(1)}"
                  width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="4" fill="${fill}">
                  <title>${esc(item.label)}: ${nf(item.value)}${unit}</title></rect>
                ${i % labelEvery === 0 || i === items.length - 1
                  ? `<text class="label" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(item.short)}</text>` : ''}`;
      }).join('')}
    </svg>`;
}

// ---------------- Gamification header ----------------
function heroHTML(me, streak) {
  const R = 62;
  const circumference = 2 * Math.PI * R;
  return `
    <section class="hero rise">
      <div class="hero-gauge">
        <svg viewBox="0 0 150 150">
          <defs>
            <linearGradient id="xpGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#58d09a"/>
              <stop offset="100%" stop-color="#ff8a3d"/>
            </linearGradient>
          </defs>
          <circle class="track" cx="75" cy="75" r="${R}"/>
          <circle class="fill" id="xp-arc" cx="75" cy="75" r="${R}"
                  stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${circumference.toFixed(1)}"/>
        </svg>
        <div class="gauge-label">
          <div class="xp" id="xp-value">0</div>
          <div class="xp-unit">XP</div>
        </div>
      </div>
      <div class="hero-main">
        <h2>שלום, ${esc(me.full_name)} 👋</h2>
        <div class="hero-sub">רמה ${me.level.level} · ${esc(me.level.title)} — עוד ${ltr(nf(me.level.points_for_next_level - me.level.points_into_level) + ' XP')} לרמה הבאה</div>
        <div class="hero-stats">
          <div class="hero-chip ${streak > 0 ? 'streak-live' : ''}">
            <span class="chip-ico">🔥</span>
            <span><span class="chip-val">${nf(streak)}</span><span class="chip-cap"> ימי רצף</span></span>
          </div>
          <div class="hero-chip">
            <span class="chip-ico">🏅</span>
            <span><span class="chip-val">${nf(me.badges.length)}</span><span class="chip-cap"> תגים</span></span>
          </div>
          <div class="hero-chip">
            <span class="chip-ico">⭐</span>
            <span><span class="chip-val">${nf(me.level.progress_pct)}%</span><span class="chip-cap"> לרמה הבאה</span></span>
          </div>
        </div>
      </div>
    </section>`;
}

/** Runs the arc + count-up animation once the hero markup is in the DOM. */
function animateHero(me) {
  const arc = document.getElementById('xp-arc');
  const value = document.getElementById('xp-value');
  if (!arc || !value) return;
  const circumference = 2 * Math.PI * 62;
  requestAnimationFrame(() => {
    arc.style.strokeDashoffset = (circumference * (1 - me.level.progress_pct / 100)).toFixed(1);
  });
  countUp(value, me.total_points, { from: Math.max(0, me.total_points - 200) });
}

function goalBar(name, value, goal, { unit = '', variant = '', overIsBad = false } = {}) {
  const percent = pct(value, goal);
  const over = goal > 0 && value > goal;
  const met = goal > 0 && value >= goal;
  let note = '';
  if (goal <= 0) note = '';
  else if (overIsBad && over) note = `<div class="goal-note warn">חריגה של ${nf(value - goal)}${unit} מהיעד</div>`;
  else if (met) note = `<div class="goal-note good">היעד הושג! 🎯</div>`;
  else note = `<div class="goal-note">נותרו ${nf(goal - value)}${unit}</div>`;

  return `
    <div class="goal">
      <div class="goal-top">
        <span class="goal-name">${esc(name)}</span>
        <span class="goal-val">${nf(value)}${unit} מתוך ${nf(goal)}${unit} · ${percent}%</span>
      </div>
      <div class="bar ${variant} ${overIsBad && over ? 'over' : ''}">
        <span style="width:${Math.min(100, percent)}%"></span>
      </div>
      ${note}
    </div>`;
}

// ---------------- Client: dashboard ----------------
async function viewDashboard(el) {
  const [me, stats] = await Promise.all([api('/me'), api('/stats')]);
  state.me = me;
  const today = stats.logs.find((l) => l.date === stats.today);
  const calories = today ? today.calories_consumed : 0;
  const protein = today ? today.protein_consumed : 0;

  const last14 = stats.logs.slice(-14);
  const weightPoints = stats.weigh_ins.map((w) => ({ value: w.weight, label: fmtDate(w.date), short: shortDate(w.date) }));

  el.innerHTML = `
    ${heroHTML(me, me.current_streak)}

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>היעדים של היום</h2>
            <div class="card-sub">${fmtDate(stats.today)}</div>
          </div>
          <a class="btn btn-sm" href="#/checkin">${today ? 'עדכון הדיווח' : 'דיווח יומי'}</a>
        </div>
        ${goalBar('קלוריות', calories, me.daily_calories_goal, { unit: '', overIsBad: true })}
        ${goalBar('חלבון', protein, me.daily_protein_goal, { unit: ' ג׳', variant: 'protein' })}
        <div class="goal">
          <div class="goal-top">
            <span class="goal-name">אימוני כוח השבוע</span>
            <span class="goal-val">${stats.workouts_this_week} מתוך ${stats.weekly_workouts_goal}</span>
          </div>
          <div class="bar"><span style="width:${Math.min(100, pct(stats.workouts_this_week, stats.weekly_workouts_goal))}%"></span></div>
          ${today && today.strength_workout_done
            ? '<div class="goal-note good">היום כבר התאמנת 💪</div>'
            : '<div class="goal-note">עוד לא סומן אימון להיום</div>'}
        </div>
      </div>

      <div class="card">
        <h2>מצב כללי</h2>
        <div class="card-sub">30 הימים האחרונים</div>
        <div class="grid grid-tight">
          <div class="stat">
            <div class="stat-cap">ימי דיווח</div>
            <div class="stat-val">${stats.logged_days_30}</div>
            <div class="stat-sub">מתוך 30</div>
          </div>
          <div class="stat">
            <div class="stat-cap">ימים ביעד חלבון</div>
            <div class="stat-val">${stats.protein_goal_days_30}</div>
            <div class="stat-sub">מתוך ${stats.logged_days_30} דיווחים</div>
          </div>
          <div class="stat ${stats.weight_change !== null && stats.weight_change <= 0 ? 'good' : ''}">
            <div class="stat-cap">שינוי במשקל</div>
            <div class="stat-val">${stats.weight_change === null ? '—' : `${stats.weight_change > 0 ? '+' : ''}${nf(stats.weight_change, 1)}`}</div>
            <div class="stat-sub">${stats.weight_latest ? `כרגע ${nf(stats.weight_latest, 1)} ק״ג` : 'אין שקילות'}</div>
          </div>
        </div>
        ${me.badges.length ? `
          <h2 style="margin-top:20px">התגים האחרונים</h2>
          <div class="badge-grid" style="margin-top:12px">
            ${me.badges.slice(0, 2).map(badgeHTML).join('')}
          </div>` : `
          <div class="empty" style="padding-top:26px">
            <span class="empty-ico">🏅</span>עוד לא זכית בתגים — הדיווח היומי הוא הצעד הראשון
          </div>`}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2>חלבון — 14 ימים אחרונים</h2>
        <div class="card-sub">עמודה ירוקה = יום שבו עמדת ביעד</div>
        ${barChart(last14.map((l) => ({ value: l.protein_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
          { goal: me.daily_protein_goal, color: '#7c5cff', unit: ' ג׳' })}
      </div>
      <div class="card">
        <h2>מגמת משקל</h2>
        <div class="card-sub">שקילה שבועית</div>
        ${lineChart(weightPoints, { color: '#2f9e6e', unit: ' ק״ג' })}
      </div>
    </div>`;

  animateHero(me);
}

// ---------------- Client: daily check-in ----------------
async function viewCheckin(el) {
  const date = todayISO();
  const [me, existing] = await Promise.all([api('/me'), api('/logs/' + date)]);
  state.me = me;

  el.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-head">
        <div>
          <h2>דיווח יומי</h2>
          <div class="card-sub">${fmtDate(date)}${existing ? ' · כבר דיווחת היום, אפשר לעדכן' : ''}</div>
        </div>
      </div>
      <form id="checkin-form">
        <div class="form-row">
          <label class="field">
            <span>סך קלוריות שנצרכו</span>
            <input type="number" name="calories_consumed" min="0" max="20000" step="1"
                   value="${existing ? existing.calories_consumed : ''}" placeholder="יעד: ${me.daily_calories_goal}" required />
          </label>
          <label class="field">
            <span>סך חלבון (גרם)</span>
            <input type="number" name="protein_consumed" min="0" max="1000" step="1"
                   value="${existing ? existing.protein_consumed : ''}" placeholder="יעד: ${me.daily_protein_goal}" required />
          </label>
        </div>
        <label class="check">
          <input type="checkbox" name="strength_workout_done" ${existing && existing.strength_workout_done ? 'checked' : ''} />
          <span>💪 עשיתי היום אימון כוח</span>
        </label>
        <button type="submit" class="btn btn-block">${existing ? 'עדכון הדיווח' : 'שליחת הדיווח'}</button>
      </form>
      <div class="card-sub" style="margin:16px 0 0">
        דיווח יומי ${ltr('+10 XP')} · עמידה ביעד החלבון ${ltr('+20 XP')} · אימון כוח ${ltr('+50 XP')}
      </div>
    </div>

    <div class="card">
      <h2>קלוריות — 14 ימים אחרונים</h2>
      <div class="card-sub">הקו המקווקו הוא יעד הקלוריות היומי</div>
      <div id="calorie-chart"></div>
    </div>`;

  const logs = await api('/logs');
  document.getElementById('calorie-chart').innerHTML = barChart(
    logs.slice(0, 14).reverse().map((l) => ({ value: l.calories_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
    { goal: me.daily_calories_goal, color: '#2f9e6e', goodWhen: 'below' }
  );

  el.querySelector('#checkin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button[type=submit]');
    button.disabled = true;
    const form = new FormData(e.target);
    try {
      const result = await api('/logs', {
        method: 'PUT',
        body: {
          date,
          calories_consumed: form.get('calories_consumed'),
          protein_consumed: form.get('protein_consumed'),
          strength_workout_done: form.get('strength_workout_done') === 'on',
        },
      });
      state.me = result.profile;
      celebrate(result);
      renderNav();
      location.hash = '#/dashboard';
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
}

/** Shared reward feedback for daily logs and weigh-ins. */
function celebrate(result) {
  if (result.workout_celebrated) confetti(90);
  if (result.points_gained > 0) {
    toast(`כל הכבוד! צברת ${nf(result.points_gained)} נקודות`, 'win');
  } else {
    toast('הדיווח עודכן');
  }
  (result.new_badges || []).forEach((badge, i) => {
    setTimeout(() => {
      confetti(60);
      toast(`תג חדש — ${badge.name}! ${badge.points_reward} נקודות בונוס`, 'win');
    }, 1400 * (i + 1));
  });
}

// ---------------- Client: weekly weigh-in ----------------
function readImageAsDataURL(file, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא הצלחנו לקרוא את הקובץ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('הקובץ אינו תמונה תקינה'));
      img.onload = () => {
        // Downscale in the browser so uploads stay small.
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

async function viewWeighIn(el) {
  const [me, weighIns] = await Promise.all([api('/me'), api('/weigh-ins')]);
  state.me = me;
  const latest = weighIns[0];
  const withPhotos = weighIns.filter((w) => w.photo_url);

  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>שקילה שבועית</h2>
            <div class="card-sub">שקילה אחת בשבוע — ${ltr('+100 XP')}</div>
          </div>
        </div>
        <form id="weigh-form">
          <div class="form-row">
            <label class="field">
              <span>תאריך</span>
              <input type="date" name="date" value="${todayISO()}" max="${todayISO()}" required />
            </label>
            <label class="field">
              <span>משקל נוכחי (ק״ג)</span>
              <input type="number" name="weight" min="20" max="400" step="0.1"
                     value="${latest ? latest.weight : ''}" required />
            </label>
          </div>
          <label class="field">
            <span>תמונת התקדמות (רשות)</span>
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" />
          </label>
          <button type="submit" class="btn btn-block">שמירת השקילה</button>
        </form>
      </div>

      <div class="card">
        <h2>היסטוריית שקילות</h2>
        <div class="card-sub">${weighIns.length} שקילות</div>
        ${weighIns.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>תאריך</th><th>משקל</th><th>שינוי</th><th>משוב המאמן</th></tr></thead>
              <tbody>
                ${weighIns.map((w, i) => {
                  const previous = weighIns[i + 1];
                  const diff = previous ? w.weight - previous.weight : null;
                  return `<tr>
                    <td>${fmtDate(w.date)}</td>
                    <td>${nf(w.weight, 1)} ק״ג</td>
                    <td>${diff === null ? '—' : `<span class="pill ${diff <= 0 ? 'ok' : 'warn'}">${diff > 0 ? '+' : ''}${nf(diff, 1)}</span>`}</td>
                    <td>${w.admin_feedback ? esc(w.admin_feedback) : '<span class="pill no">אין עדיין</span>'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>` : '<div class="empty"><span class="empty-ico">⚖️</span>עוד לא נרשמה שקילה</div>'}
      </div>
    </div>

    ${withPhotos.length ? `
      <div class="card">
        <h2>תמונות התקדמות</h2>
        <div class="card-sub">רק אתה והמאמן רואים אותן</div>
        <div class="photo-grid">
          ${withPhotos.map((w) => `
            <figure>
              <img src="/api/weigh-ins/${w.id}/photo" alt="תמונת התקדמות מ-${fmtDate(w.date)}" loading="lazy" />
              <figcaption>${fmtDate(w.date)} · ${nf(w.weight, 1)} ק״ג</figcaption>
            </figure>`).join('')}
        </div>
      </div>` : ''}`;

  el.querySelector('#weigh-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button[type=submit]');
    button.disabled = true;
    const form = new FormData(e.target);
    try {
      const file = form.get('photo');
      const body = { date: form.get('date'), weight: form.get('weight') };
      if (file && file.size) body.photo = await readImageAsDataURL(file);
      const result = await api('/weigh-ins', { method: 'POST', body });
      state.me = result.profile;
      if (result.points_gained > 0) confetti(80);
      celebrate(result);
      renderNav();
      render();
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
}

// ---------------- Client: progress ----------------
async function viewProgress(el) {
  const [me, stats] = await Promise.all([api('/me'), api('/stats')]);
  state.me = me;

  const weightPoints = stats.weigh_ins.map((w) => ({ value: w.weight, label: fmtDate(w.date), short: shortDate(w.date) }));
  const logs = stats.logs;

  el.innerHTML = `
    <div class="grid grid-4">
      <div class="stat">
        <div class="stat-cap">משקל התחלתי</div>
        <div class="stat-val">${stats.weight_start ? nf(stats.weight_start, 1) : '—'}</div>
        <div class="stat-sub">ק״ג</div>
      </div>
      <div class="stat">
        <div class="stat-cap">משקל נוכחי</div>
        <div class="stat-val">${stats.weight_latest ? nf(stats.weight_latest, 1) : '—'}</div>
        <div class="stat-sub">ק״ג</div>
      </div>
      <div class="stat ${stats.weight_change !== null && stats.weight_change <= 0 ? 'good' : 'warn'}">
        <div class="stat-cap">שינוי מצטבר</div>
        <div class="stat-val">${stats.weight_change === null ? '—' : `${stats.weight_change > 0 ? '+' : ''}${nf(stats.weight_change, 1)}`}</div>
        <div class="stat-sub">ק״ג מתחילת המעקב</div>
      </div>
      <div class="stat">
        <div class="stat-cap">סך נקודות</div>
        <div class="stat-val">${nf(me.total_points)}</div>
        <div class="stat-sub">רמה ${me.level.level} · ${esc(me.level.title)}</div>
      </div>
    </div>

    <div class="card">
      <h2>מגמת משקל</h2>
      <div class="card-sub">כל השקילות מתחילת המעקב</div>
      ${lineChart(weightPoints, { color: '#2f9e6e', unit: ' ק״ג' })}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2>קלוריות יומיות</h2>
        <div class="card-sub">30 הימים האחרונים</div>
        ${barChart(logs.map((l) => ({ value: l.calories_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
          { goal: me.daily_calories_goal, color: '#2f9e6e', goodWhen: 'below' })}
      </div>
      <div class="card">
        <h2>חלבון יומי</h2>
        <div class="card-sub">30 הימים האחרונים</div>
        ${barChart(logs.map((l) => ({ value: l.protein_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
          { goal: me.daily_protein_goal, color: '#7c5cff', unit: ' ג׳' })}
      </div>
    </div>

    <div class="card">
      <h2>יומן הדיווחים</h2>
      <div class="card-sub">30 הימים האחרונים</div>
      ${logs.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>תאריך</th><th>קלוריות</th><th>חלבון</th><th>אימון כוח</th><th>XP</th></tr></thead>
            <tbody>
              ${[...logs].reverse().map((l) => `
                <tr>
                  <td>${fmtDate(l.date)}</td>
                  <td>${nf(l.calories_consumed)}</td>
                  <td>${nf(l.protein_consumed)} ג׳ ${l.protein_consumed >= me.daily_protein_goal ? '<span class="pill ok">ביעד</span>' : ''}</td>
                  <td>${l.strength_workout_done ? '<span class="pill ok">כן</span>' : '<span class="pill no">לא</span>'}</td>
                  <td>${ltr('+' + l.points_awarded)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div class="empty"><span class="empty-ico">📋</span>אין עדיין דיווחים</div>'}
    </div>`;
}

// ---------------- Client: badges ----------------
function badgeHTML(badge) {
  const earned = !!badge.earned_at;
  return `
    <div class="badge ${earned ? '' : 'locked'}">
      <div class="badge-ico">${icon(badge.icon_name)}</div>
      <div>
        <h3>${esc(badge.name)}</h3>
        <p>${esc(badge.description)}</p>
        <div class="badge-meta">${earned ? `הושג ב-${fmtDate(badge.earned_at)} · ${ltr('+' + badge.points_reward + ' XP')}` : `נעול · שווה ${ltr(badge.points_reward + ' XP')}`}</div>
      </div>
    </div>`;
}

async function viewBadges(el) {
  const [me, badges] = await Promise.all([api('/me'), api('/badges')]);
  state.me = me;
  const earned = badges.filter((b) => b.earned_at).length;

  el.innerHTML = `
    ${heroHTML(me, me.current_streak)}
    <div class="card">
      <div class="card-head">
        <div>
          <h2>התגים שלי</h2>
          <div class="card-sub">${earned} מתוך ${badges.length} תגים הושגו</div>
        </div>
      </div>
      <div class="badge-grid">${badges.map(badgeHTML).join('')}</div>
    </div>

    <div class="card">
      <h2>איך צוברים נקודות</h2>
      <div class="card-sub">כל פעולה מזכה אותך ב-XP</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>פעולה</th><th>נקודות</th></tr></thead>
          <tbody>
            <tr><td>הזנת דיווח יומי</td><td>${ltr('+10 XP')}</td></tr>
            <tr><td>עמידה ביעד החלבון היומי</td><td>${ltr('+20 XP')}</td></tr>
            <tr><td>ביצוע אימון כוח</td><td>${ltr('+50 XP')}</td></tr>
            <tr><td>שקילה שבועית</td><td>${ltr('+100 XP')}</td></tr>
            <tr><td>${ltr('500 XP')} נצברים</td><td>רמה חדשה</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;

  animateHero(me);
}

// ---------------- Blog ----------------
async function viewBlog(el) {
  const posts = await api('/posts');
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>מאמרים וטיפים</h2>
          <div class="card-sub">תוכן מהמאמן — תזונה, אימוני כוח והצד המנטלי</div>
        </div>
      </div>
      ${posts.length ? posts.map((p) => `
        <article class="post">
          <h3>${esc(p.title)}</h3>
          <div class="post-meta">${fmtDate(p.published_at)}${p.author_name ? ' · ' + esc(p.author_name) : ''}</div>
          <div class="post-body">${esc(p.content)}</div>
        </article>`).join('')
      : '<div class="empty"><span class="empty-ico">📚</span>עוד לא פורסמו מאמרים</div>'}
    </div>`;
}

// ---------------- Admin: clients ----------------
function clientFormFields(client = {}) {
  return `
    <label class="field"><span>שם מלא</span>
      <input type="text" name="full_name" value="${esc(client.full_name || '')}" required /></label>
    ${client.id ? '' : `
    <label class="field"><span>אימייל</span>
      <input type="email" name="email" required /></label>
    <label class="field"><span>סיסמה ראשונית</span>
      <input type="password" name="password" minlength="6" required /></label>`}
    <div class="form-row">
      <label class="field"><span>יעד קלוריות יומי</span>
        <input type="number" name="daily_calories_goal" min="500" max="10000" value="${client.daily_calories_goal ?? 1800}" required /></label>
      <label class="field"><span>יעד חלבון יומי (ג׳)</span>
        <input type="number" name="daily_protein_goal" min="10" max="500" value="${client.daily_protein_goal ?? 130}" required /></label>
    </div>
    <label class="field"><span>אימוני כוח בשבוע</span>
      <input type="number" name="weekly_workouts_goal" min="0" max="14" value="${client.weekly_workouts_goal ?? 3}" required /></label>
    ${client.id ? `
    <label class="field"><span>סיסמה חדשה (רשות)</span>
      <input type="password" name="new_password" minlength="6" placeholder="להשאיר ריק כדי לא לשנות" /></label>
    <label class="check"><input type="checkbox" name="active" ${client.active ? 'checked' : ''} /><span>חשבון פעיל</span></label>` : ''}`;
}

async function viewAdminClients(el) {
  const clients = await api('/admin/clients');

  el.innerHTML = `
    <div class="grid grid-4">
      <div class="stat"><div class="stat-cap">לקוחות פעילים</div><div class="stat-val">${clients.filter((c) => c.active).length}</div></div>
      <div class="stat good"><div class="stat-cap">דיווחו היום</div><div class="stat-val">${clients.filter((c) => c.logged_today).length}</div><div class="stat-sub">מתוך ${clients.length}</div></div>
      <div class="stat"><div class="stat-cap">סך נקודות</div><div class="stat-val">${nf(clients.reduce((sum, c) => sum + c.total_points, 0))}</div></div>
      <div class="stat"><div class="stat-cap">תגים שחולקו</div><div class="stat-val">${nf(clients.reduce((sum, c) => sum + c.badge_count, 0))}</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2>הלקוחות שלי</h2>
          <div class="card-sub">יעדים אישיים, נקודות ורצף דיווח</div>
        </div>
        <button class="btn btn-sm" id="add-client">➕ לקוח חדש</button>
      </div>
      ${clients.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>שם</th><th>יעדים</th><th>רמה</th><th>רצף</th><th>דיווח אחרון</th><th>משקל</th><th>תגים</th><th></th></tr>
            </thead>
            <tbody>
              ${clients.map((c) => `
                <tr data-id="${c.id}">
                  <td>
                    <strong>${esc(c.full_name)}</strong>
                    ${c.active ? '' : '<span class="pill no">לא פעיל</span>'}
                    <div class="card-sub" style="margin:2px 0 0">${esc(c.email)}</div>
                  </td>
                  <td>
                    <bdi>${c.daily_calories_goal} קק״ל</bdi> · <bdi>${c.daily_protein_goal} ג׳ חלבון</bdi> · <bdi>${c.weekly_workouts_goal} אימונים</bdi>
                  </td>
                  <td>${c.level.level}<div class="card-sub">${ltr(nf(c.total_points) + ' XP')}</div></td>
                  <td>${c.current_streak > 0 ? `🔥 ${c.current_streak}` : '—'}</td>
                  <td>${c.last_log_date
                        ? `${fmtDate(c.last_log_date)} ${c.logged_today ? '<span class="pill ok">היום</span>' : ''}`
                        : '<span class="pill warn">מעולם לא</span>'}</td>
                  <td>${c.latest_weight ? nf(c.latest_weight, 1) + ' ק״ג' : '—'}</td>
                  <td>${c.badge_count}</td>
                  <td class="actions">
                    <a class="btn-ghost btn-sm" href="#/admin/client/${c.id}">פרטים</a>
                    <button class="btn-ghost btn-sm" data-edit>עריכה</button>
                    <button class="btn-ghost btn-sm btn-danger" data-delete>מחיקה</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div class="empty"><span class="empty-ico">👥</span>עוד לא נוספו לקוחות</div>'}
    </div>`;

  el.querySelector('#add-client').addEventListener('click', () => {
    openModal('לקוח חדש', clientFormFields(), async (form) => {
      await api('/admin/clients', { method: 'POST', body: form });
      toast('הלקוח נוסף');
      render();
    });
  });

  el.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const client = clients.find((c) => c.id === Number(button.closest('tr').dataset.id));
      openModal(`עריכת ${client.full_name}`, clientFormFields(client), async (form) => {
        await api('/admin/clients/' + client.id, {
          method: 'PUT',
          body: { ...form, active: form.active === 'on' },
        });
        toast('הפרטים עודכנו');
        render();
      });
    });
  });

  el.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const client = clients.find((c) => c.id === Number(button.closest('tr').dataset.id));
      confirmAction(`למחוק את ${client.full_name} ואת כל הנתונים שלו? הפעולה אינה הפיכה.`, async () => {
        await api('/admin/clients/' + client.id, { method: 'DELETE' });
        toast('הלקוח נמחק');
        render();
      });
    });
  });
}

async function viewAdminClient(el, id) {
  const { profile, stats, badges } = await api('/admin/clients/' + id);
  const weightPoints = stats.weigh_ins.map((w) => ({ value: w.weight, label: fmtDate(w.date), short: shortDate(w.date) }));

  el.innerHTML = `
    <div class="card-head">
      <a class="btn-ghost btn-sm" href="#/admin/clients">→ חזרה לרשימה</a>
    </div>

    <div class="grid grid-4">
      <div class="stat"><div class="stat-cap">רמה</div><div class="stat-val">${profile.level.level}</div><div class="stat-sub">${ltr(nf(profile.total_points) + ' XP')} · ${esc(profile.level.title)}</div></div>
      <div class="stat"><div class="stat-cap">רצף דיווח</div><div class="stat-val">${profile.current_streak}</div><div class="stat-sub">ימים</div></div>
      <div class="stat"><div class="stat-cap">אימונים השבוע</div><div class="stat-val">${stats.workouts_this_week}/${stats.weekly_workouts_goal}</div></div>
      <div class="stat ${stats.weight_change !== null && stats.weight_change <= 0 ? 'good' : ''}">
        <div class="stat-cap">שינוי במשקל</div>
        <div class="stat-val">${stats.weight_change === null ? '—' : `${stats.weight_change > 0 ? '+' : ''}${nf(stats.weight_change, 1)}`}</div>
        <div class="stat-sub">ק״ג</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2>קלוריות — 30 יום</h2>
        <div class="card-sub">יעד: ${profile.daily_calories_goal} קק״ל</div>
        ${barChart(stats.logs.map((l) => ({ value: l.calories_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
          { goal: profile.daily_calories_goal, color: '#2f9e6e', goodWhen: 'below' })}
      </div>
      <div class="card">
        <h2>חלבון — 30 יום</h2>
        <div class="card-sub">יעד: ${profile.daily_protein_goal} ג׳</div>
        ${barChart(stats.logs.map((l) => ({ value: l.protein_consumed, label: fmtDate(l.date), short: shortDate(l.date) })),
          { goal: profile.daily_protein_goal, color: '#7c5cff', unit: ' ג׳' })}
      </div>
    </div>

    <div class="card">
      <h2>מגמת משקל</h2>
      <div class="card-sub">${esc(profile.full_name)}</div>
      ${lineChart(weightPoints, { color: '#2f9e6e', unit: ' ק״ג' })}
    </div>

    <div class="card">
      <h2>שקילות ומשוב</h2>
      <div class="card-sub">אפשר לכתוב משוב אישי לכל שקילה</div>
      ${stats.weigh_ins.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>תאריך</th><th>משקל</th><th>תמונה</th><th>משוב</th><th></th></tr></thead>
            <tbody>
              ${[...stats.weigh_ins].reverse().map((w) => `
                <tr data-weigh="${w.id}">
                  <td>${fmtDate(w.date)}</td>
                  <td>${nf(w.weight, 1)} ק״ג</td>
                  <td>${w.photo_url ? `<a href="/api/weigh-ins/${w.id}/photo" target="_blank" rel="noopener">צפייה</a>` : '—'}</td>
                  <td>${w.admin_feedback ? esc(w.admin_feedback) : '<span class="pill no">אין</span>'}</td>
                  <td class="actions"><button class="btn-ghost btn-sm" data-feedback>משוב</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div class="empty"><span class="empty-ico">⚖️</span>אין שקילות</div>'}
    </div>

    <div class="card">
      <h2>תגים שהושגו</h2>
      <div class="card-sub">${badges.length} תגים</div>
      ${badges.length ? `<div class="badge-grid">${badges.map(badgeHTML).join('')}</div>`
        : '<div class="empty"><span class="empty-ico">🏅</span>עוד לא הושגו תגים</div>'}
    </div>`;

  el.querySelectorAll('[data-feedback]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('tr');
      const weighIn = stats.weigh_ins.find((w) => w.id === Number(row.dataset.weigh));
      openModal('משוב לשקילה', `
        <label class="field"><span>משוב ל-${esc(profile.full_name)} (${fmtDate(weighIn.date)})</span>
          <textarea name="admin_feedback" placeholder="מה עבד טוב השבוע? על מה כדאי לשים דגש?">${esc(weighIn.admin_feedback || '')}</textarea></label>
      `, async (form) => {
        await api(`/admin/weigh-ins/${weighIn.id}/feedback`, { method: 'PUT', body: form });
        toast('המשוב נשמר');
        render();
      });
    });
  });
}

// ---------------- Admin: blog ----------------
async function viewAdminBlog(el) {
  const posts = await api('/posts');

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>ניהול הבלוג</h2>
          <div class="card-sub">${posts.length} מאמרים מפורסמים</div>
        </div>
        <button class="btn btn-sm" id="add-post">➕ מאמר חדש</button>
      </div>
      ${posts.length ? posts.map((p) => `
        <article class="post" data-id="${p.id}">
          <div class="card-head" style="margin:0">
            <div>
              <h3>${esc(p.title)}</h3>
              <div class="post-meta">${fmtDate(p.published_at)}</div>
            </div>
            <div class="actions">
              <button class="btn-ghost btn-sm" data-edit>עריכה</button>
              <button class="btn-ghost btn-sm btn-danger" data-delete>מחיקה</button>
            </div>
          </div>
          <div class="post-body">${esc(p.content)}</div>
        </article>`).join('')
      : '<div class="empty"><span class="empty-ico">📝</span>עוד לא פורסמו מאמרים</div>'}
    </div>`;

  const postFields = (post = {}) => `
    <label class="field"><span>כותרת</span>
      <input type="text" name="title" value="${esc(post.title || '')}" required /></label>
    <label class="field"><span>תוכן</span>
      <textarea name="content" placeholder="כתוב כאן את המאמר...">${esc(post.content || '')}</textarea></label>`;

  el.querySelector('#add-post').addEventListener('click', () => {
    openModal('מאמר חדש', postFields(), async (form) => {
      await api('/posts', { method: 'POST', body: form });
      toast('המאמר פורסם');
      render();
    }, 'פרסום');
  });

  el.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = posts.find((p) => p.id === Number(button.closest('.post').dataset.id));
      openModal('עריכת מאמר', postFields(post), async (form) => {
        await api('/posts/' + post.id, { method: 'PUT', body: form });
        toast('המאמר עודכן');
        render();
      });
    });
  });

  el.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = posts.find((p) => p.id === Number(button.closest('.post').dataset.id));
      confirmAction(`למחוק את המאמר "${post.title}"?`, async () => {
        await api('/posts/' + post.id, { method: 'DELETE' });
        toast('המאמר נמחק');
        render();
      });
    });
  });
}

// ---------------- Settings ----------------
async function viewSettings(el) {
  const me = await api('/me');
  state.me = me;

  el.innerHTML = `
    <div class="card" style="max-width:520px">
      <h2>החשבון שלי</h2>
      <div class="card-sub">${esc(me.email)} · ${me.role === 'admin' ? 'מנהל' : 'לקוח'}</div>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><th>שם מלא</th><td>${esc(me.full_name)}</td></tr>
            <tr><th>יעד קלוריות יומי</th><td>${nf(me.daily_calories_goal)} קק״ל</td></tr>
            <tr><th>יעד חלבון יומי</th><td>${nf(me.daily_protein_goal)} ג׳</td></tr>
            <tr><th>אימוני כוח בשבוע</th><td>${me.weekly_workouts_goal}</td></tr>
          </tbody>
        </table>
      </div>
      ${me.role === 'client' ? '<div class="card-sub" style="margin-top:12px">שינוי היעדים נעשה דרך המאמן.</div>' : ''}
    </div>

    <div class="card" style="max-width:520px">
      <h2>שינוי סיסמה</h2>
      <div class="card-sub">לפחות 6 תווים</div>
      <form id="password-form">
        <label class="field"><span>סיסמה נוכחית</span>
          <input type="password" name="current_password" required /></label>
        <label class="field"><span>סיסמה חדשה</span>
          <input type="password" name="new_password" minlength="6" required /></label>
        <button type="submit" class="btn">עדכון הסיסמה</button>
      </form>
    </div>`;

  el.querySelector('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target).entries()) });
      e.target.reset();
      toast('הסיסמה עודכנה');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------------- Routing ----------------
const CLIENT_ROUTES = [
  { path: 'dashboard', title: 'דשבורד', ico: '🏠', render: viewDashboard },
  { path: 'checkin', title: 'דיווח יומי', ico: '📝', render: viewCheckin },
  { path: 'weighin', title: 'שקילה שבועית', ico: '⚖️', render: viewWeighIn },
  { path: 'progress', title: 'ההתקדמות שלי', ico: '📈', render: viewProgress },
  { path: 'badges', title: 'תגים ונקודות', ico: '🏅', render: viewBadges },
  { path: 'blog', title: 'מאמרים וטיפים', ico: '📚', render: viewBlog },
  { path: 'settings', title: 'החשבון שלי', ico: '⚙️', render: viewSettings },
];

const ADMIN_ROUTES = [
  { path: 'admin/clients', title: 'לקוחות', ico: '👥', render: viewAdminClients },
  { path: 'admin/blog', title: 'ניהול הבלוג', ico: '📝', render: viewAdminBlog },
  { path: 'blog', title: 'תצוגת הבלוג', ico: '📚', render: viewBlog },
  { path: 'settings', title: 'החשבון שלי', ico: '⚙️', render: viewSettings },
];

const routes = () => (state.me?.role === 'admin' ? ADMIN_ROUTES : CLIENT_ROUTES);
const homePath = () => (state.me?.role === 'admin' ? 'admin/clients' : 'dashboard');

function currentPath() {
  return location.hash.replace(/^#\/?/, '') || homePath();
}

function renderNav() {
  const path = currentPath();
  document.getElementById('nav').innerHTML = routes()
    .map((r) => `<a href="#/${r.path}" data-path="${r.path}" class="${path === r.path || path.startsWith(r.path + '/') ? 'active' : ''}">
        <span class="ico">${r.ico}</span> ${r.title}</a>`)
    .join('');

  document.getElementById('who').innerHTML = `
    <strong>${esc(state.me.full_name)}</strong>
    ${state.me.role === 'admin' ? 'מאמן / מנהל' : `רמה ${state.me.level.level} · ${ltr(nf(state.me.total_points) + ' XP')}`}`;
}

async function render() {
  const path = currentPath();
  const el = document.getElementById('view');
  const clientDetail = /^admin\/client\/(\d+)$/.exec(path);
  const route = routes().find((r) => r.path === path);

  document.getElementById('page-title').textContent =
    clientDetail ? 'כרטיס לקוח' : route ? route.title : 'לא נמצא';
  renderNav();

  el.innerHTML = '<div class="empty">טוען…</div>';
  try {
    if (clientDetail) {
      if (state.me.role !== 'admin') throw new Error('אין הרשאה');
      await viewAdminClient(el, clientDetail[1]);
    } else if (route) {
      await route.render(el);
    } else {
      location.hash = '#/' + homePath();
      return;
    }
    renderNav();
  } catch (err) {
    if (/התחברות/.test(err.message)) return boot();
    el.innerHTML = `<div class="card"><div class="empty"><span class="empty-ico">⚠️</span>${esc(err.message)}</div></div>`;
  }
}

// ---------------- Auth screen ----------------
function showAuth() {
  document.getElementById('auth').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function setupAuthScreen() {
  const form = document.getElementById('auth-form');
  const error = document.getElementById('auth-error');
  const submit = document.getElementById('auth-submit');
  let mode = 'login';

  const applyMode = () => {
    document.querySelectorAll('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
    document.querySelectorAll('.register-only').forEach((node) => node.classList.toggle('hidden', mode !== 'register'));
    form.full_name.required = mode === 'register';
    form.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    submit.textContent = mode === 'register' ? 'יצירת חשבון' : 'התחברות';
    error.textContent = '';
  };

  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => { mode = tab.dataset.mode; applyMode(); });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      state.me = await api('/auth/' + mode, { method: 'POST', body });
      form.reset();
      showApp();
      if (!location.hash) location.hash = '#/' + homePath();
      else render();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  applyMode();
}

// ---------------- Boot ----------------
async function boot() {
  try {
    state.me = await api('/me');
  } catch {
    state.me = null;
  }
  if (!state.me) {
    showAuth();
    return;
  }
  showApp();
  render();
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  state.me = null;
  location.hash = '';
  showAuth();
});

document.getElementById('menu-toggle').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
});

document.getElementById('nav').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.remove('open');
});

window.addEventListener('hashchange', () => { if (state.me) render(); });

setupAuthScreen();
boot();
