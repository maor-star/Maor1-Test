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
/** Midday avoids a daylight-saving shift landing the result on the neighbouring day. */
const shiftISO = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA').format(d);
};
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dayOf = (iso) => new Date(`${iso}T12:00:00`).getDay();
const pct = (value, goal) => (goal > 0 ? Math.round((value / goal) * 100) : 0);
const signed = (n, digits = 1) => `${n > 0 ? '+' : ''}${nf(n, digits)}`;

/** The four registration marks every framed object in this system wears. */
const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';

/** When the group starts together. */
const START_DATE = '1.9.26';

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
function lineChart(points, { unit = '', digits = 1, goal = null, compact = false } = {}) {
  if (!points.length) {
    return '<div class="empty">אחרי השקילה הראשונה יופיע כאן גרף הירידה</div>';
  }
  // A single weigh-in still says something when there is a target to read it against:
  // where you started and how far there is to go.
  if (points.length < 2 && !goal) {
    return '<div class="empty">צריך לפחות שתי שקילות כדי להציג מגמה</div>';
  }
  const W = 660, H = 260, padX = 46, padY = 30;
  const values = points.map((p) => p.value);
  // The target joins the scale so the line is always read against it, not in isolation.
  const scale = goal ? [...values, goal] : values;
  const min = Math.min(...scale), max = Math.max(...scale);
  const span = max - min || 1;
  const lo = min - span * 0.15, hi = max + span * 0.15;
  const x = (i) => (points.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (points.length - 1));
  const y = (v) => H - padY - ((v - lo) / (hi - lo)) * (H - padY * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const every = Math.ceil(points.length / 7);

  return `
    <svg class="chart ${compact ? 'chart-compact' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="מגמת משקל לאורך ${points.length} שקילות">
      ${[lo, (lo + hi) / 2, hi].map((t) => `
        <line class="grid-line" x1="${padX}" y1="${y(t).toFixed(1)}" x2="${W - padX}" y2="${y(t).toFixed(1)}"/>
        <text class="lbl" x="${W - padX + 7}" y="${(y(t) + 3).toFixed(1)}">${nf(t, digits)}</text>`).join('')}
      ${goal ? `
        <line class="goal-line" x1="${padX}" y1="${y(goal).toFixed(1)}" x2="${W - padX}" y2="${y(goal).toFixed(1)}"/>
        <text class="goal-lbl" x="${padX}" y="${(y(goal) - 8).toFixed(1)}">יעד ${nf(goal, digits)}${unit}</text>` : ''}
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
/**
 * The one time-sensitive thing on the page, so it sits at the top and says the date in
 * words rather than hiding it in a corner label. It writes into the slot it names, so
 * there is no second step and no wondering which week the number landed in.
 */
/**
 * The last seven days as one form. Reporting a day at a time meant a missed evening was
 * a hole nobody went back to fill; here the whole week is on screen, the gaps are visible
 * and one button saves them all. Tuesday is marked because that is weigh-in morning.
 */
function weekModel(stats) {
  // A Tuesday only carries the weigh-in mark if it is one of the programme's own, so a
  // Tuesday before the start is not labelled as a weigh-in day nobody is expected on.
  const slots = new Set((stats.schedule || []).map((r) => r.date));
  const dates = Array.from({ length: 7 }, (_, i) => shiftISO(stats.today, -i));
  const days = dates.map((date) => ({
    date,
    log: stats.logs.find((l) => l.date === date) || null,
    isToday: date === stats.today,
    isWeighIn: slots.has(date),
  }));
  const reported = days.filter((d) => d.log);
  const mean = (pick) => (reported.length
    ? Math.round(reported.reduce((sum, d) => sum + pick(d.log), 0) / reported.length) : 0);

  return {
    days,
    reported: reported.length,
    workouts: days.filter((d) => d.log?.strength_workout_done).length,
    avgProtein: mean((l) => l.protein_consumed),
    avgCalories: mean((l) => l.calories_consumed),
  };
}

function weekReport(week, me) {
  const from = week.days[week.days.length - 1].date;
  const goal = me.weekly_workouts_goal;

  return `
    <section class="panel bp week-panel">
      ${corners()}
      <header>
        <h3>הדיווח השבועי</h3>
        <span class="when">${ltr(`${shortDate(from)} - ${shortDate(week.days[0].date)}`)}</span>
      </header>

      <div class="week-summary">
        <div><div class="val accent">${ltr(`${nf(week.workouts)}/${nf(goal)}`)}</div><div class="cap">אימוני כוח · 7 ימים</div></div>
        <div><div class="val">${nf(week.avgProtein)}</div><div class="cap">ממוצע חלבון ליום · ג׳</div></div>
        <div><div class="val">${nf(week.avgCalories)}</div><div class="cap">ממוצע קלוריות ליום</div></div>
      </div>
      <p class="note-line">מחושב על ${nf(week.reported)} מתוך 7 הימים שדווחו.
        שורה לכל יום, אפשר להשלים ימים שפוספסו ולשמור הכול בבת אחת.</p>
      <div class="table-wrap">
        <table class="table week-table">
          <thead>
            <tr><th>יום</th><th>קלוריות</th><th>חלבון · ג׳</th><th>אימון כוח</th></tr>
          </thead>
          <tbody>
            ${week.days.map((d) => `
              <tr class="${d.isToday ? 'is-now' : ''} ${d.isWeighIn ? 'is-weighin' : ''}" data-day="${d.date}">
                <td class="week-day">
                  <span class="week-name">${DAY_NAMES[dayOf(d.date)]}</span>
                  <span class="week-date">${ltr(shortDate(d.date))}</span>
                  ${d.isWeighIn ? '<span class="tag tag-accent">שקילה</span>' : ''}
                </td>
                <td data-label="קלוריות">
                  <input class="input input-sm" type="number" min="0" max="20000" data-cal
                         value="${d.log ? d.log.calories_consumed : ''}" placeholder="${me.daily_calories_goal}"
                         aria-label="קלוריות ל-${fmtDate(d.date)}" />
                </td>
                <td data-label="חלבון · ג׳">
                  <input class="input input-sm" type="number" min="0" max="1000" data-prot
                         value="${d.log ? d.log.protein_consumed : ''}" placeholder="${me.daily_protein_goal}"
                         aria-label="חלבון ל-${fmtDate(d.date)}" />
                </td>
                <td class="week-check" data-label="אימון כוח">
                  <input type="checkbox" data-workout ${d.log?.strength_workout_done ? 'checked' : ''}
                         aria-label="אימון כוח ב-${fmtDate(d.date)}" />
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <button type="button" id="week-save" class="btn btn-primary btn-block">שמירת הדיווח</button>
      <p class="note-line" style="margin-top:var(--space-3)">
        יעד אימוני הכוח הוא מינימום ${goal} בשבעה ימים.
      </p>
    </section>`;
}

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
let tipsCache = {};
async function loadTips(kind = 'rule') {
  if (!tipsCache[kind]) tipsCache[kind] = await api('/tips?kind=' + kind);
  return tipsCache[kind];
}

/**
 * One rule of thumb at a time, swapped every few seconds. Which one shows first
 * follows the day, so two people opening the app together see the same line.
 */
function tipRotator(tips, goalKg, emptyText = 'אין עדיין כללי אצבע') {
  const lines = [
    ...(goalKg ? [{ text: `יעד לקבוצה: ${nf(goalKg)} קילו שומן`, isGoal: true }] : []),
    ...tips,
  ];
  if (!lines.length) return `<div class="empty">${esc(emptyText)}</div>`;
  const start = Math.floor(Date.parse(todayISO()) / 86400000) % lines.length;
  return `
    <div class="rules" data-index="${start}">
      ${lines.map((t, i) => `<div class="rule ${t.isGoal ? 'is-goal' : ''} ${i === start ? 'is-shown' : ''}">${esc(t.text)}</div>`).join('')}
      <div class="rule-ticks">${lines.map((_, i) => `<i class="${i === start ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
}

/** Starts the swap once the markup is on the page. Honours reduced-motion by standing still. */
let tipTimers = [];
function startTipRotation() {
  tipTimers.forEach(clearInterval);
  tipTimers = [];
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.querySelectorAll('.rules[data-index]').forEach((box) => {
    const rules = [...box.querySelectorAll('.rule')];
    const ticks = [...box.querySelectorAll('.rule-ticks i')];
    if (rules.length < 2) return;

    const show = (next) => {
      rules.forEach((r, i) => r.classList.toggle('is-shown', i === next));
      ticks.forEach((t, i) => t.classList.toggle('on', i === next));
      box.dataset.index = String(next);
    };
    const timer = setInterval(() => show((Number(box.dataset.index) + 1) % rules.length), 7000);
    tipTimers.push(timer);

    // Clicking a tick jumps straight to that line and stops the automatic swap.
    ticks.forEach((tick, i) => tick.addEventListener('click', () => { clearInterval(timer); show(i); }));
  });
}

async function viewDashboard(el) {
  const [me, stats, tips, goal, unread, recipes] = await Promise.all([
    api('/me'), api('/stats'), loadTips(), api('/public/goal'),
    api('/messages/unread'), api('/recipes'),
  ]);
  state.me = me;
  const week = weekModel(stats);
  const weightPoints = stats.weigh_ins.map((w) => ({ value: w.weight, label: fmtDate(w.date), short: shortDate(w.date) }));

  el.innerHTML = `
    <section class="hero bp">
      ${corners()}
      <div class="hero-id">
        ${photoSlot(me, stats)}
        <div>
          <div class="label">מבוסס מדע · שינוי הרכב גוף</div>
          <h1>${esc(me.full_name)}</h1>
          <p>שלושה יעדים יומיים, שקילה אחת בשבוע. הגוף עושה את השאר.</p>
        </div>
      </div>
      ${statBlock([
        { value: stats.weight_latest ? nf(stats.weight_latest, 1) : '-', cap: 'משקל נוכחי · ק״ג', accent: true },
        { value: stats.target_weight ? nf(stats.target_weight, 1) : '-', cap: 'יעד המשקל · ק״ג' },
        { value: stats.to_target === null ? '-' : nf(Math.max(0, stats.to_target), 1), cap: 'נותרו ליעד · ק״ג' },
        { value: stats.weight_change === null ? '-' : ltr(signed(stats.weight_change)), cap: 'ירדת עד כה · ק״ג' },
      ], { framed: false })}
      <p class="note-line">היעד אחיד לכל הקבוצה: ירידה של ${nf(stats.target_share * 100)}% ממשקל הפתיחה.
        ${stats.target_loss
          ? `במקרה שלך ${ltr(nf(stats.target_loss, 1))} ק״ג, מ-${ltr(nf(stats.weight_start, 1))} ל-${ltr(nf(stats.target_weight, 1))}.`
          : 'היעד שלך ייקבע מהשקילה הראשונה.'}</p>
    </section>

    ${stats.coach_note ? `
      <section class="panel bp note-card">
        ${corners()}
        <header><h3>הדגשים שלך</h3><span class="when">ממאור</span></header>
        <p class="coach-note">${esc(stats.coach_note)}</p>
      </section>` : ''}

    ${weighInPlan(stats)}

    ${weekReport(week, me)}

    <div class="sec">
      <div class="kicker">איפה אתה עומד</div>
      <h2>הירידה במשקל</h2>
    </div>

    <div class="split">
      <section class="panel bp">
        ${corners()}
        <header>
          <h3>מגמת המשקל</h3>
          <span class="when">${stats.weight_change === null ? '' : ltr(`${signed(stats.weight_change)} ק״ג`)}</span>
        </header>
        ${lineChart(weightPoints, { unit: ' ק״ג', goal: stats.target_weight, compact: true })}
      </section>
      <div>
        <div class="goals">
          ${goalRow('ממוצע קלוריות ליום', week.avgCalories, me.daily_calories_goal, { goodWhen: 'below' })}
          ${goalRow('ממוצע חלבון ליום', week.avgProtein, me.daily_protein_goal, { unit: ' ג׳' })}
          ${goalRow('אימוני כוח · 7 ימים', week.workouts, me.weekly_workouts_goal)}
        </div>
        <div class="label" style="margin-top:var(--space-6)">כלל האצבע</div>
        ${tipRotator(tips, goal.goal_kg)}
      </div>
    </div>

    <div class="sec">
      <div class="kicker">מסרים</div>
      <h2>הקו הישיר למאור</h2>
      <p>מה שתכתוב כאן מגיע רק אליו, והתשובה תופיע לך כאן ובחלון קופץ.</p>
    </div>
    <section class="panel bp" id="thread-panel">
      ${corners()}
      <div id="thread" class="thread"><div class="empty">טוען…</div></div>
      <form id="msg-form" class="add-row">
        <input class="input" name="body" maxlength="2000" placeholder="לכתוב למאור…" required />
        <button type="submit" class="btn btn-primary">שליחה</button>
      </form>
    </section>

    ${recipes.length ? `
      <div class="sec">
        <div class="kicker">מתכונים</div>
        <h2>מה לאכול</h2>
        <p>מתכונים שמאור שלח, אישית אליך או לכל הקבוצה.</p>
      </div>
      <div class="articles">
        ${recipes.map((r) => `
          <article class="article bp">
            ${corners()}
            <span class="tag ${r.user_id ? 'tag-accent' : 'tag-neutral'}">${r.user_id ? 'אישי' : 'לכל הקבוצה'}</span>
            <h3>${esc(r.title)}</h3>
            <p>${esc(r.body)}</p>
          </article>`).join('')}
      </div>` : ''}

    ${me.badges.length ? `
      <div class="sec">
        <div class="kicker">הישגים</div>
        <h2>התגים שצברת</h2>
      </div>
      <div class="badges">${me.badges.map(badgeCard).join('')}</div>` : ''}`;

  startTipRotation();
  loadThread();
  unread.forEach((m, i) => setTimeout(() => showCoachMessage(m), 400 + i * 300));

  el.querySelector('#week-save').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;

    // A row is saved only when it differs from what is stored, so pressing save after
    // filling one day does not rewrite the other six and re-award their points.
    const changed = [...el.querySelectorAll('[data-day]')].map((row) => {
      const date = row.dataset.day;
      const calories = row.querySelector('[data-cal]').value.trim();
      const protein = row.querySelector('[data-prot]').value.trim();
      const workout = row.querySelector('[data-workout]').checked;
      const before = week.days.find((d) => d.date === date).log;
      if (!calories && !protein && !workout) return null;
      const same = before
        && String(before.calories_consumed) === (calories || '0')
        && String(before.protein_consumed) === (protein || '0')
        && !!before.strength_workout_done === workout;
      return same ? null : {
        date,
        calories_consumed: calories || 0,
        protein_consumed: protein || 0,
        strength_workout_done: workout,
      };
    }).filter(Boolean);

    if (!changed.length) {
      toast('אין שינוי לשמור');
      button.disabled = false;
      return;
    }

    try {
      let gained = 0;
      let last = null;
      const badges = [];

      for (const body of changed) {
        last = await api('/logs', { method: 'PUT', body });
        gained += last.points_gained || 0;
        badges.push(...(last.new_badges || []));
      }

      state.me = last.profile;
      toast(`נשמרו ${nf(changed.length)} ימים${gained > 0 ? ` · ${nf(gained)} נקודות` : ''}`);
      badges.forEach((badge, i) => {
        setTimeout(() => toast(`תג חדש: ${badge.name}`), 1600 * (i + 1));
      });
      renderChrome();
      render();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });


  el.querySelector('#msg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input[name=body]');
    const body = input.value.trim();
    if (!body) return;
    try {
      await api('/messages', { method: 'POST', body: { body } });
      input.value = '';
      loadThread();
    } catch (err) {
      toast(err.message, true);
    }
  });

  el.querySelector('#start-weight-save')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await api('/me/start-weight', {
        method: 'PUT',
        body: { start_weight: el.querySelector('#start-weight').value.trim() },
      });
      toast('משקל ההתחלה נשמר');
      render();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });

  el.querySelectorAll('[data-plan-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('[data-slot]');
      const input = row.querySelector('[data-plan-weight]');
      const weight = input.value.trim();
      if (!weight) return toast('יש להזין משקל', true);
      // The date defaults to this row's Tuesday and may be moved, but only inside the
      // week: outside it the weigh-in would be filed against a different row.
      const picker = row.querySelector('[data-plan-date]');
      const date = picker.value || row.dataset.slot;
      if (date < picker.min || date > picker.max) {
        return toast('התאריך חייב להיות בתוך אותו שבוע', true);
      }
      button.disabled = true;
      try {
        await api('/weigh-ins', { method: 'POST', body: { date, weight } });
        toast('נשמר');
        render();
      } catch (err) {
        toast(err.message, true);
        button.disabled = false;
      }
    });
  });
  // Enter in the field saves that row, so the whole plan can be filled from the keyboard.
  el.querySelectorAll('[data-plan-weight]').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.closest('[data-slot]').querySelector('[data-plan-save]').click(); }
    });
  });

  el.querySelector('#photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await api('/me/photo', { method: 'POST', body: { photo: await readImageAsDataURL(file, 1000, 0.92) } });
      toast('התמונה עודכנה');
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/**
 * The thirteen weeks of the programme, dates already filled in. Every Tuesday morning
 * gets a row and the member only ever types a number into it.
 */
function weighInPlan(stats) {
  const rows = stats.schedule || [];
  if (!rows.length) return '';
  const done = rows.filter((r) => r.weight !== null).length;
  const first = rows[0];
  const next = rows.find((r) => r.weight === null && r.is_open) || rows.find((r) => r.weight === null);
  const startW = stats.weight_start;

  return `
    <div class="sec">
      <div class="kicker">יעדי השקילה</div>
      <h2>כל יום שלישי בבוקר, ${rows.length} שבועות</h2>
      <p>השקילה הראשונה ב-${fmtDate(first.date)}, ומשם כל יום שלישי עוקב.
         שוקלים בבוקר, לפני האוכל ואחרי השירותים, וממלאים את השורה.
         ${next ? `השורה המסומנת היא הבאה בתור: ${fmtDate(next.date)}.` : 'כל השקילות מולאו.'}
         אפשר להזיז את התאריך לכל יום באותו שבוע, ולהשלים שבוע שפוספס.</p>
    </div>

    <section class="panel bp start-weight">
      ${corners()}
      <div>
        <div class="label">משקל התחלתי</div>
        <p class="note-line">${stats.start_weight_set
          ? 'זה המשקל שממנו נמדד היעד שלך. אפשר לתקן אותו.'
          : 'המשקל שממנו התחלת. ממנו נגזר היעד של עשרה אחוזים, ולפיו נספרת הירידה.'}</p>
      </div>
      <div class="start-weight-form">
        <input class="input" id="start-weight" type="number" min="20" max="400" step="0.1"
               value="${startW ?? ''}" placeholder="ק״ג" aria-label="משקל התחלתי בקילוגרמים" />
        <button type="button" id="start-weight-save" class="btn btn-secondary">שמירה</button>
      </div>
      ${stats.target_weight ? `
        <p class="note-line start-weight-target">היעד שלך: ${ltr(nf(stats.target_weight, 1))} ק״ג,
          ירידה של ${ltr(nf(stats.target_loss, 1))} ק״ג.</p>` : ''}
    </section>

    <section class="panel bp">
      ${corners()}
      <header>
        <h3>לוח השקילות</h3>
        <span class="when">${ltr(`${done}/${rows.length}`)} מולאו</span>
      </header>
      <div class="table-wrap">
        <table class="table plan-table">
          <thead><tr><th>שבוע</th><th>תאריך השקילה</th><th>משקל · ק״ג</th><th>שינוי</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r, i) => {
              const prev = [...rows.slice(0, i)].reverse().find((x) => x.weight !== null);
              const diff = r.weight !== null && prev ? Number((r.weight - prev.weight).toFixed(1)) : null;
              const state = r.weight !== null ? 'is-done'
                : r.date === next?.date ? 'is-now'
                : r.is_past ? 'is-missed'
                : 'is-ahead';
              return `
                <tr class="${state}" data-slot="${r.date}">
                  <td class="plan-n">${r.n}</td>
                  <td class="plan-date">
                    <input class="input input-sm" type="date" value="${r.logged_date || r.date}"
                           min="${r.week_from}" max="${r.week_to}" data-plan-date
                           aria-label="תאריך השקילה לשבוע ${r.n}" ${r.is_open ? '' : 'disabled'} />
                    ${r.date === next?.date ? '<span class="tag tag-accent">הבאה</span>'
                      : r.is_current ? '<span class="tag tag-accent">השבוע</span>' : ''}
                  </td>
                  <td>
                    <input class="input input-sm" type="number" min="20" max="400" step="0.1"
                           value="${r.weight ?? ''}" placeholder="${r.is_open ? '-' : ''}"
                           aria-label="משקל ל-${fmtDate(r.date)}" data-plan-weight
                           ${r.is_open ? '' : 'disabled'} />
                  </td>
                  <td class="plan-diff">${diff === null ? '' : ltr(signed(diff))}</td>
                  <td>${r.is_open
                    ? '<button class="btn btn-secondary btn-sm" data-plan-save type="button">שמירה</button>'
                    : '<span class="plan-soon">עוד לא נפתח</span>'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="note-line" style="margin-top:var(--space-4)">
        אפשר למלא כל שבוע בכל זמן, כולל שקילה שפוספסה.
        שקילה שנרשמה ביום אחר באותו שבוע נכנסת לשורה של אותו שבוע.
      </p>
    </section>`;
}

/** The member's own picture, or the frame waiting for one. */
function photoSlot(me, stats) {
  return `
    <label class="photo-slot bp" title="החלפת תמונה">
      ${corners()}
      ${stats.has_photo
        ? `<img src="/api/members/${me.id}/photo?v=${Date.now()}" alt="התמונה של ${esc(me.full_name)}" width="120" height="120" />`
        : '<span class="photo-empty">הוספת<br />תמונה</span>'}
      <input type="file" id="photo-input" accept="image/png,image/jpeg,image/webp" hidden />
    </label>`;
}

/** The thread with the coach, loaded separately so the dashboard paints first. */
async function loadThread() {
  const box = document.getElementById('thread');
  if (!box) return;
  try {
    const messages = await api('/messages');
    box.innerHTML = messages.length
      ? messages.map((m) => `
          <div class="msg ${m.from_coach ? 'from-coach' : 'from-me'}">
            <div class="msg-who">${m.from_coach ? 'מאור' : 'אתה'} · ${fmtDate(m.created_at)}</div>
            <div class="msg-body">${esc(m.body)}</div>
          </div>`).join('')
      : '<div class="empty">עוד לא כתבתם. שאלה, קושי או ניצחון. הכל מתאים.</div>';
    box.scrollTop = box.scrollHeight;
  } catch {
    box.innerHTML = '<div class="empty">לא הצלחנו לטעון את המסרים</div>';
  }
}

/** A message from the coach the member has not seen yet. */
function showCoachMessage(message) {
  openModal('מסר ממאור', `
    <p class="coach-note" style="margin:0">${esc(message.body)}</p>
    <p class="note-line" style="margin-top:12px">${fmtDate(message.created_at)}</p>`,
    async () => {}, 'קראתי');
}

/** Reward feedback shared by the daily log and the weigh-in. */
function announce(result) {
  if (result.points_gained > 0) toast(`נשמר · ${nf(result.points_gained)} נקודות`);
  else toast('הדיווח עודכן');
  (result.new_badges || []).forEach((badge, i) => {
    setTimeout(() => toast(`תג חדש: ${badge.name}`), 1600 * (i + 1));
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
function readImageAsDataURL(file, maxSide = 1200, quality = 0.85) {
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
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
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
      <p>המשקל הוא מדד אחד מתוך כמה. כשמסת השריר עולה במקביל, המשקל יורד לאט יותר, וזו בדיוק המטרה.</p>
    </div>

    <div class="split split-wide">
      <div>
        <div class="label">
          משקל · ק״ג${stats.weight_change !== null
            ? `: ${ltr(`${nf(stats.weight_start, 1)} → ${nf(stats.weight_latest, 1)} · ${signed(stats.weight_change)}`)}` : ''}
        </div>
        ${lineChart(points, { unit: ' ק״ג' })}
      </div>

      <div class="panel bp">
        ${corners()}
        <header><h3>שקילה שבועית</h3></header>
        <form id="weigh-form">
          <div class="field">
            <label for="w-weight">משקל נוכחי (ק״ג)</label>
            <input class="input" id="w-weight" type="number" name="weight" min="20" max="400" step="0.1"
                   value="${latest ? latest.weight : ''}" required />
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
      <div><div class="val">${stats.weight_change === null ? '-' : ltr(signed(stats.weight_change))}</div><div class="cap">שינוי במשקל · ק״ג</div></div>
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
            <thead><tr><th>שבוע</th><th>משקל</th><th>שינוי</th><th>תמונה</th></tr></thead>
            <tbody>
              ${rows.map((w, i) => {
                const previous = rows[i + 1];
                const diff = previous ? w.weight - previous.weight : null;
                return `<tr>
                  <td>${fmtDate(w.date)}</td>
                  <td>${ltr(nf(w.weight, 1))}</td>
                  <td>${diff === null ? '-' : ltr(signed(diff))}</td>
                  <td>${w.photo_url ? `<a href="/api/weigh-ins/${w.id}/photo" target="_blank" rel="noopener">צפייה</a>` : '-'}</td>
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
      const body = { date: form.get('date'), weight: form.get('weight') };
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

// ---------------- The science ----------------
const MECHANISMS = [
  {
    title: 'גירעון קלורי קובע את הכיוון',
    body: 'ירידה במשקל דורשת צריכה נמוכה מההוצאה. גודל הגירעון קובע את הקצב, אבל לא את ההרכב. כמה מהירידה תגיע משומן וכמה משריר נקבע בשני המנגנונים הבאים.',
  },
  {
    title: 'חלבון שומר על מסת השריר',
    body: 'צריכת חלבון גבוהה בזמן גירעון מצמצמת את איבוד המסה הרזה ומגדילה את השובע. זו הסיבה שיעד החלבון היומי הוא מדד נפרד, ולא חלק מיעד הקלוריות.',
  },
  {
    title: 'אימון כוח הוא האות לגוף',
    body: 'אימון התנגדות מספק את הגירוי שמכוון את הגוף לשמר (ובתנאים מסוימים גם להוסיף) רקמת שריר תוך כדי ירידה בשומן. בלעדיו, חלק מהירידה יבוא מהשריר.',
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
        <p>לכן הדיווח היומי במערכת עוסק במה שבשליטתך: קלוריות, חלבון ואימון.
           השקילה נשארת מדד מגמה שבועי.</p>
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
          <a class="article bp ${p.image_url ? 'has-figure' : ''}" href="#/articles/${encodeURIComponent(p.slug)}">
            ${corners()}
            ${p.image_url ? `<span class="card-figure"><img src="/api/posts/${p.id}/image" alt="" loading="lazy" /></span>` : ''}
            <span class="tag tag-accent">${esc(p.category)}</span>
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.excerpt)}</p>
            <span class="meta">${esc(p.author || '')} · ${p.read_minutes} דקות קריאה</span>
          </a>`).join('')}
      </div>` : '<div class="empty">עוד לא פורסמו מאמרים</div>'}`;
}

/**
 * Some articles carry a drawn illustration rather than a photograph. It is rendered
 * inline rather than as an <img>, so it inherits the page's fonts and colour tokens
 * and stays sharp at any size. Keyed by slug; an uploaded photo takes precedence.
 */
const ARTICLE_FIGURES = {
  'choosing-meat': () => barFigure({
    kicker: 'גרם חלבון לכל 100 קלוריות',
    title: 'חזה עוף נותן פי שלושה מאנטרקוט',
    note: 'ערכים משוערים למאה גרם במצב חי. ככל שהעמודה ארוכה יותר, כך מקבלים יותר חלבון תמורת אותה קלוריה.',
    rows: [
      { label: 'טונה במים', value: 23 },
      { label: 'חזה הודו', value: 22 },
      { label: 'חזה עוף', value: 20, highlight: true },
      { label: 'טחון 5%', value: 15 },
      { label: 'סינטה נקייה', value: 12, highlight: true },
      { label: 'סלמון', value: 10 },
      { label: 'אנטרקוט', value: 6, warn: true },
      { label: 'נקניקייה', value: 4, warn: true },
    ],
  }),
};

/** A horizontal bar chart drawn in the same hairline language as the rest of the site. */
function barFigure({ kicker, title, note, rows }) {
  // The SVG scales as a whole, so a wide canvas on a narrow screen shrinks the type
  // to the point of being unreadable. A phone gets its own geometry instead.
  const narrow = window.innerWidth <= 720;
  const W = narrow ? 460 : 900;
  const rowH = narrow ? 30 : 34;
  const top = narrow ? 66 : 76;
  const padX = narrow ? 112 : 150;
  const right = narrow ? 34 : 60;
  const H = top + rows.length * rowH + 8;
  const max = Math.max(...rows.map((r) => r.value));
  const len = (v) => ((W - padX - right) * v) / max;

  return `
    <figure class="article-figure drawn">
      <svg class="chart figure-chart ${narrow ? 'compact' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
           role="img" aria-label="${esc(title)}. ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}">
        <text class="fig-kicker" x="${W - 24}" y="30" text-anchor="end">${esc(kicker)}</text>
        <text class="fig-title" x="${W - 24}" y="58" text-anchor="end">${esc(title)}</text>
        <line class="grid-line" x1="24" y1="${top - 16}" x2="${W - 24}" y2="${top - 16}"/>
        ${rows.map((r, i) => {
          const y = top + i * rowH;
          const cls = r.highlight ? 'good' : r.warn ? 'warn' : '';
          return `
            <text class="fig-label" x="${W - 24}" y="${y + 15}" text-anchor="end">${esc(r.label)}</text>
            <rect class="fig-bar ${cls}" x="${W - padX - len(r.value)}" y="${y + (narrow ? 3 : 4)}"
                  width="${len(r.value).toFixed(1)}" height="${narrow ? 13 : 14}"/>
            <text class="fig-value" x="${W - padX - len(r.value) - 10}" y="${y + 15}" text-anchor="end">${r.value}</text>`;
        }).join('')}
      </svg>
      <figcaption>${esc(note)}</figcaption>
    </figure>`;
}

/** Renders the seeded article body: blank lines split paragraphs, **bold** lines are sub-headings. */
async function viewArticle(el, slug) {
  const post = await api('/posts/' + encodeURIComponent(slug));
  // Escaping happens first, so the markup below can never be used to inject HTML.
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const blocks = post.content.split('\n\n').map((block) => {
    const heading = /^\*\*(.+)\*\*$/.exec(block.trim());
    return heading ? `<h4>${esc(heading[1])}</h4>` : `<p>${inline(block.trim())}</p>`;
  }).join('');

  el.innerHTML = `
    <div>
      <a class="btn btn-ghost" href="#/articles">→ כל המאמרים</a>
    </div>
    ${post.image_url ? `
      <figure class="article-figure">
        <img src="/api/posts/${post.id}/image" alt="" />
        <span class="watermark">מאור · הדרך הקלה לרדת במשקל</span>
      </figure>` : (ARTICLE_FIGURES[post.slug] ? ARTICLE_FIGURES[post.slug]() : '')}
    <div class="sec measure">
      <span class="tag tag-accent" style="justify-self:start">${esc(post.category)}</span>
      <h2>${esc(post.title)}</h2>
      <p>${esc(post.excerpt)}</p>
      <p class="byline">מאת ${esc(post.author || 'מאור דוידוביץ')} · ${post.read_minutes} דקות קריאה</p>
    </div>
    <article class="article-body measure">${blocks}</article>
    <p class="byline byline-end measure">נכתב על ידי ${esc(post.author || 'מאור דוידוביץ')}</p>`;
}

// ---------------- Settings ----------------
async function viewSettings(el) {
  const me = await api('/me');
  state.me = me;
  // The protein target is derived from body weight, not picked. The last weigh-in is
  // what turns the rule into this member's own number, right where they set it.
  const stats = await api('/stats').catch(() => null);
  const weight = stats?.weight_latest || null;
  const suggested = weight ? Math.round(weight * 1.8) : null;

  el.innerHTML = `
    <div class="sec">
      <div class="kicker">הגדרות</div>
      <h2>היעדים שלך</h2>
      <p>שלושת המספרים שהמערכת מודדת מולם. אפשר לשנות אותם בכל שלב.
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
          <p class="note-line" style="margin-top:8px">
            יעד החלבון הוא 1.8 גרם לכל קילו משקל גוף.
            ${suggested
              ? `לפי ${weight} ק״ג, זה <button type="button" class="linkish" id="use-protein">${suggested} גרם</button>.`
              : 'אחרי השקילה הראשונה נחשב לך את המספר המדויק.'}
          </p>
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

  el.querySelector('#use-protein')?.addEventListener('click', () => {
    el.querySelector('#g-prot').value = suggested;
  });

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
/**
 * Every member's cumulative loss on one set of axes, with the group's running
 * total drawn heavier on top. Same hairline grid and steel line as every other
 * chart in the app; members are separated by dash pattern rather than by colour,
 * because the system carries a single accent.
 */
/**
 * A member's face, or their initial when they have not uploaded one. Both render at
 * the same size, so a group of mixed members still lines up.
 */
function avatar(member, size = 'md') {
  const initial = (member.full_name || '?').trim().charAt(0);
  return member.has_photo
    ? `<img class="avatar avatar-${size}" src="/api/members/${member.id}/photo" alt="" loading="lazy" />`
    : `<span class="avatar avatar-${size} avatar-blank" aria-hidden="true">${esc(initial)}</span>`;
}

function groupChart(data) {
  const { dates, series, total } = data;
  if (!series.length || dates.length < 2) {
    return '<div class="empty">הגרף ייפתח כשיהיו לפחות שתי שקילות בקבוצה</div>';
  }
  const W = 900, H = 340, padX = 54, padTop = 26, padBottom = 46;
  const max = Math.max(...total, ...series.flatMap((s) => s.points.filter((p) => p !== null)), 1) * 1.12;
  const x = (i) => padX + (i * (W - padX * 2)) / (dates.length - 1);
  const y = (v) => H - padBottom - (v / max) * (H - padTop - padBottom);

  const line = (points) => points
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .map((pt, i) => `${i ? 'L' : 'M'}${pt}`)
    .join(' ');

  const dashes = ['4 3', '7 3', '2 3', '10 4', '5 2 2 2'];
  const ticks = [0, max / 2, max];
  const every = Math.ceil(dates.length / 8);

  return `
    <svg class="chart chart-group" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="ירידה מצטברת של ${series.length} חברים לאורך ${dates.length} שקילות">
      ${ticks.map((t) => `
        <line class="grid-line" x1="${padX}" y1="${y(t).toFixed(1)}" x2="${W - padX}" y2="${y(t).toFixed(1)}"/>
        <text class="lbl" x="${W - padX + 7}" y="${(y(t) + 3).toFixed(1)}">${nf(t, 0)}</text>`).join('')}

      ${series.map((s, i) => `
        <path class="line line-member" d="${line(s.points)}" stroke-dasharray="${dashes[i % dashes.length]}"/>`).join('')}

      <path class="line line-total" d="${line(total)}"/>
      ${total.map((v, i) => `<circle class="dot dot-total" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3"><title>${esc(dates[i])}: ${nf(v, 1)} ק״ג</title></circle>`).join('')}

      ${dates.map((d, i) => (i % every === 0 || i === dates.length - 1)
        ? `<text class="lbl" x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle">${esc(shortDate(d))}</text>` : '').join('')}
    </svg>

    <div class="chart-legend">
      <span class="key key-total">הקבוצה · ${nf(total[total.length - 1], 1)} ק״ג</span>
      ${series.map((s, i) => `
        <span class="key">
          <i style="border-top-style:dashed"></i>${esc(s.name)} · ${ltr(nf(s.points[s.points.length - 1] ?? 0, 1))}
        </span>`).join('')}
    </div>`;
}

async function viewHome(el) {
  const signedIn = !!state.me;
  const [summary, posts, goal, progress, group, slogans, hero, bot] = await Promise.all([
    api('/public/summary'), api('/posts'), api('/public/goal'), api('/public/progress'),
    signedIn ? api('/group') : Promise.resolve(null),
    loadTips('slogan'), api('/public/hero'), api('/public/bot'),
  ]);

  let selected = group?.members?.[0] ?? null;

  const cells = summary.totals_visible
    ? [
        { value: nf(summary.total_kg_lost, 1), cap: 'ק״ג ירדו יחד', accent: true },
        { value: nf(summary.member_count), cap: 'חברים פעילים' },
        { value: nf(summary.workouts_this_week), cap: 'אימוני כוח השבוע' },
        { value: nf(summary.post_count), cap: 'מאמרים פתוחים' },
      ]
    : [
        { value: '3', cap: 'יעדים יומיים', accent: true },
        { value: '1', cap: 'שקילה בשבוע' },
        { value: nf(summary.post_count), cap: 'מאמרים פתוחים' },
        { value: nf(goal.goal_kg), cap: 'ק״ג היעד' },
      ];

  el.innerHTML = `
    <section class="hero bp">
      ${corners()}
      <div>
        <div class="label">מבוסס מדע · שינוי הרכב גוף</div>
        <h1>יעד לקבוצה: ${nf(goal.goal_kg)} קילו שומן</h1>
        <p class="slogan-sub">הדרך הקלה לירידה במשקל · מתחילים ${esc(START_DATE)}</p>
        <p>לא נשקלים כל בוקר. עומדים בשלושה יעדים יומיים (קלוריות, חלבון ואימון כוח)
           וסופרים את הימים שבהם עמדת בהם. הגוף עושה את השאר.</p>
        ${signedIn ? `
          <div class="gate-actions">
            <a class="btn btn-primary" href="#/dashboard">לדאשבורד שלי</a>
            <a class="btn btn-secondary" href="#/progress">ההתקדמות שלי</a>
          </div>` : `
          <div class="gate-actions">
            <button class="btn btn-primary" data-auth="register" type="button">הצטרפות לקבוצה</button>
            <a class="btn btn-secondary" href="#/science">קודם כל, המדע</a>
          </div>
          <p class="hero-note">הקריאה פתוחה לכולם. חשבון נדרש רק כדי להצטרף לקבוצה ולרשום משקלים.</p>`}
      </div>
      <div class="hero-side">
        ${hero.has_photo ? `
          <figure class="portrait">
            <img src="/api/public/hero-photo" alt="${esc(hero.name || '')}" width="440" height="440" />
            <figcaption>${esc(hero.name || '')}</figcaption>
          </figure>` : ''}
        ${statBlock(cells, { framed: false })}
      </div>
    </section>

    ${slogans.length ? `
      <section class="slogans">
        <div class="label">אני מאמין שלי</div>
        ${tipRotator(slogans, 0, '')}
      </section>` : ''}

    <div class="sec">
      <div class="kicker">שאלו אותו הכל</div>
      <h2>הבוט של מאור ופיטר אטיה שיודע לענות לכם על כל השאלות</h2>
      <p>הוא קרא את כל המאמרים באתר ואת האני מאמין של מאור, והוא מכיר לעומק את העבודה של פיטר אטיה
         ואת המחקר של רפואת אריכות ימים. הקו של מאור מוביל, אטיה מסביר את המנגנון שמאחוריו.</p>
    </div>
    <section class="panel bp chat">
      ${corners()}
      ${signedIn ? `
        <div class="thread" id="chat-thread">
          <div class="msg from-coach">
            <div class="msg-who">הבוט</div>
            <div class="msg-body">שאלו אותי כל דבר על תזונה, אימוני כוח או בריאות מטבולית. אני עונה מתוך המאמרים של מאור, ומשלים מהמחקר של פיטר אטיה כשצריך.</div>
          </div>
        </div>
        <form id="chat-form" class="chat-form">
          <input class="input" id="chat-input" name="message" maxlength="800" autocomplete="off"
                 placeholder="למשל: כמה חלבון אני צריך ביום?" required />
          <button type="submit" class="btn btn-primary">שליחה</button>
        </form>
        <p class="note-line chat-note">המידע חינוכי ואינו ייעוץ רפואי. לבוט אין גישה לנתונים האישיים של אף חבר.</p>
      ` : `
        <div class="empty">
          הבוט פתוח לחברי הקבוצה.
          <div class="gate-actions" style="justify-content:center;margin-top:var(--space-4)">
            <button class="btn btn-primary" data-auth="login" type="button">התחברות</button>
            <button class="btn btn-secondary" data-auth="register" type="button">הצטרפות</button>
          </div>
        </div>`}
    </section>

    ${group ? (() => {
      // Everyone's contribution against the one shared target, largest first.
      const share = group.members
        .map((m) => ({ id: m.id, name: m.full_name, has_photo: m.has_photo, kg: m.weight_change < 0 ? -m.weight_change : 0 }))
        .sort((a, b) => b.kg - a.kg);
      const best = Math.max(...share.map((m) => m.kg), 0.1);
      return `
      <div class="sec">
        <div class="kicker">היעד המשותף</div>
        <h2>בדרך ל-${nf(group.goal_kg)} ק״ג</h2>
        <p>יעד אחד לכל הקבוצה. כל קילו שמישהו מוריד נספר לכולם.</p>
      </div>
      <section class="panel bp">
        ${corners()}
        <div class="goal">
          <div class="goal-top">
            <span class="goal-name">ירידה מצטברת · ${nf(group.member_count)} חברים</span>
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

        <div class="share">
          <div class="label">מי תרם כמה</div>
          ${share.map((m) => `
            <div class="share-row">
              <span class="share-name">${avatar({ id: m.id, full_name: m.name, has_photo: m.has_photo }, 'sm')}${esc(m.name)}</span>
              <span class="share-bar"><i style="width:${Math.round((m.kg / best) * 100)}%"></i></span>
              <span class="share-kg">${ltr(`${nf(m.kg, 1)} ק״ג`)}</span>
            </div>`).join('')}
        </div>
      </section>`;
    })() : ''}

    ${progress.visible ? `
      <div class="sec">
        <div class="kicker">שבוע אחרי שבוע</div>
        <h2>הירידה של כולם</h2>
        <p>הקו המלא הוא הסכום של כל החברים. כל קו מקווקו הוא חבר אחד.</p>
      </div>
      <section class="panel bp">
        ${corners()}
        ${groupChart(progress)}
      </section>` : ''}

    ${group ? `
      <div class="sec">
        <div class="kicker">החברים</div>
        <h2>מי בקבוצה</h2>
        <p>לחיצה על שם פותחת את האזור האישי שלו כאן, מתחת לרשימה.</p>
      </div>
      <div class="split split-wide">
        <div class="members" id="members">
          ${group.members.map((m) => `
            <button class="member ${m.id === selected?.id ? 'active' : ''}" data-id="${m.id}" type="button">
              ${avatar(m)}
              <span>
                <span class="who">${esc(m.full_name)}</span>
                <span class="facts">
                  <span>${ltr(`${m.weeks_in_program} שב׳`)}</span>
                  <span>${ltr(`${nf(m.total_points)} XP`)}</span>
                </span>
              </span>
              <span class="kg">${m.weight_change === null ? '-' : ltr(`${signed(m.weight_change)} ק״ג`)}</span>
            </button>`).join('')}
        </div>
        <div id="member-panel">${memberPanel(selected)}</div>
      </div>
      <p class="disclaimer">
        חברי הקבוצה רואים זה את זה רק את המספרים שלמעלה. הדיווחים היומיים, השקילות והתמונות נשארים פרטיים.
      </p>` : ''}

    <div class="sec">
      <div class="kicker">איך זה עובד</div>
      <h2>שלושה מספרים ביום, שקילה אחת בשבוע</h2>
    </div>
    <div class="mechanisms">
      ${[
        { t: 'מדווחים שלושה מספרים', b: 'קלוריות, חלבון והאם היה אימון כוח. דיווח אחד ביום, פחות מחצי דקה.' },
        { t: 'נשקלים פעם בשבוע', b: 'משקל יומי מושפע ממלח, מים ושינה. שקילה שבועית מסננת את הרעש ומשאירה מגמה.' },
        { t: 'רואים את הקבוצה', b: 'החברים רואים זה את זה. זה מה שמחזיק כשהמוטיבציה נגמרת.' },
      ].map((m, i) => `
        <div class="mechanism">
          <div class="num">${String(i + 1).padStart(2, '0')}</div>
          <h3>${esc(m.t)}</h3>
          <p>${esc(m.b)}</p>
        </div>`).join('')}
    </div>

    <div class="sec">
      <div class="kicker">מאמרים · פתוח לכולם</div>
      <h2>קריאה קצרה לכל שלב בדרך</h2>
      <p>אין צורך בחשבון כדי לקרוא. כל המאמרים פתוחים.</p>
    </div>
    <div class="articles">
      ${posts.slice(0, 3).map((p) => `
        <a class="article bp ${p.image_url ? 'has-figure' : ''}" href="#/articles/${encodeURIComponent(p.slug)}">
          ${corners()}
          ${p.image_url ? `<span class="card-figure"><img src="/api/posts/${p.id}/image" alt="" loading="lazy" /></span>` : ''}
          <span class="tag tag-accent">${esc(p.category)}</span>
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.excerpt)}</p>
          <span class="meta">${esc(p.author || '')} · ${p.read_minutes} דקות קריאה</span>
        </a>`).join('')}
    </div>

    <p class="disclaimer">המידע כאן הוא חינוכי ואינו מחליף ייעוץ רפואי או תזונתי אישי.</p>`;

  // --- the assistant ---
  const chatForm = el.querySelector('#chat-form');
  if (chatForm) {
    const thread = el.querySelector('#chat-thread');
    const input = el.querySelector('#chat-input');
    const history = [];

    // The model is told to answer in plain prose, but models drift, so any markdown
    // that slips through is rendered rather than shown as raw asterisks. Escaping runs
    // first, so nothing here can inject HTML.
    const render = (text) => esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .split('\n')
      .map((line) => line.replace(/^\s*[*-]\s+/, '• '))
      .join('<br />');

    const bubble = (who, text, cls) => {
      const node = document.createElement('div');
      node.className = `msg ${cls}`;
      node.innerHTML = `<div class="msg-who">${esc(who)}</div><div class="msg-body">${render(text)}</div>`;
      thread.appendChild(node);
      thread.scrollTop = thread.scrollHeight;
      return node;
    };

    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      input.disabled = true;
      chatForm.querySelector('button').disabled = true;
      bubble('אתה', question, 'from-me');
      const pending = bubble('הבוט', 'חושב…', 'from-coach is-pending');

      try {
        const { reply, sources, web } = await api('/chat', { method: 'POST', body: { message: question, history } });
        pending.remove();
        const node = bubble('הבוט', reply, 'from-coach');
        // Two lines, kept apart on purpose: the articles are the house line, the research
        // is what the bot reached for when the articles fell short. Seeing which is which
        // is how anyone can tell the answer stayed inside the world it was told to use.
        const credit = (label, items) => {
          if (!items?.length) return;
          const links = document.createElement('div');
          links.className = 'msg-sources';
          links.innerHTML = label + items.join(' · ');
          node.appendChild(links);
        };
        credit('מתוך המאמרים: ', (sources || [])
          .map((x) => `<a href="#/articles/${encodeURIComponent(x.slug)}">${esc(x.title)}</a>`));
        credit('מהמחקר: ', (web || [])
          .map((x) => x.uri
            ? `<a href="${esc(x.uri)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>`
            : esc(x.title)));
        history.push({ role: 'user', text: question }, { role: 'bot', text: reply });
        thread.scrollTop = thread.scrollHeight;
      } catch (err) {
        pending.remove();
        bubble('הבוט', err.message, 'from-coach is-error');
      } finally {
        input.disabled = false;
        chatForm.querySelector('button').disabled = false;
        input.focus();
      }
    });
  }

  el.querySelectorAll('.member').forEach((button) => {
    button.addEventListener('click', () => {
      selected = group.members.find((m) => m.id === Number(button.dataset.id));
      el.querySelectorAll('.member').forEach((b) => b.classList.toggle('active', b === button));
      document.getElementById('member-panel').innerHTML = memberPanel(selected);
    });
  });
}

/** One member's headline numbers: the same block the group screen used to show. */
function memberPanel(member) {
  if (!member) return '<div class="empty">אין עדיין חברים בקבוצה</div>';
  return `
    <section class="panel bp">
      ${corners()}
      <div class="label">אזור אישי</div>
      <h3 style="margin:0; font-size:26px">${esc(member.full_name)}</h3>
      ${statBlock([
        { value: member.weight_change === null ? '-' : signed(member.weight_change), cap: 'ק״ג מאז ההתחלה', accent: true },
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
    </section>`;
}

/** Shown instead of a members-only screen when a visitor asks for it. */
function renderGate(el, route) {
  el.innerHTML = `
    <section class="hero bp">
      ${corners()}
      <div>
        <div class="label">חברים בלבד</div>
        <h1>${esc(route.title)}</h1>
        <p>המסך הזה נפתח לחברי הקבוצה. ההרשמה לוקחת פחות מדקה, ומשם אפשר לדווח,
           להישקל ולראות את ההתקדמות של כולם.</p>
        <div class="gate-actions">
          <button class="btn btn-primary" data-auth="register" type="button">הרשמה והצטרפות לקבוצה</button>
          <button class="btn btn-secondary" data-auth="login" type="button">כבר יש לי חשבון</button>
        </div>
        <p class="hero-note">המאמרים והמדע פתוחים לקריאה גם בלי חשבון.</p>
      </div>
    </section>`;
}

// ---------------- Routing ----------------
// ---------------- Editor ----------------
const CATEGORIES = ['תזונה', 'אימונים', 'מנטלי', 'מטבוליזם', 'כללי'];

async function viewEditor(el) {
  const [posts, tips, slogans, inbox, recipes, members, bot] = await Promise.all([
    api('/editor/posts'), api('/tips'), api('/tips?kind=slogan'),
    api('/editor/inbox'), api('/editor/recipes'), api('/editor/members'), api('/public/bot'),
  ]);
  const botUrl = bot.url || '';
  const totalUnread = inbox.reduce((n, m) => n + m.unread, 0);

  el.innerHTML = `
    <div class="sec">
      <div class="kicker">עריכה</div>
      <h2>תוכן ומסרים</h2>
      <p>מה שנכתב כאן מופיע מיד באתר. אין שלב פרסום נפרד.</p>
    </div>

    <div class="sec">
      <div class="kicker">${totalUnread ? `${totalUnread} ממתינות לך` : 'תיבת המסרים'}</div>
      <h2>מי כתב לך</h2>
      <p>לחיצה על "שיחה" פותחת את ההתכתבות, ו"דגשים" קובע את מה שיופיע בראש הדאשבורד שלו.</p>
    </div>
    <div class="rowlist">
      ${inbox.length ? inbox.map((m) => `
        <div class="row" data-member="${m.id}">
          <span>
            <span class="row-text">${esc(m.full_name)}${m.unread ? ` <span class="tag tag-accent">${m.unread} חדש</span>` : ''}</span>
            <span class="facts">${m.last_body ? esc(m.last_body.slice(0, 70)) : 'עוד לא נכתב דבר'}</span>
          </span>
          <span class="row-actions">
            <button class="btn btn-secondary btn-sm" data-open-thread type="button">שיחה</button>
            <button class="btn btn-secondary btn-sm" data-edit-note type="button">דגשים</button>
          </span>
        </div>`).join('') : '<div class="empty">אין עדיין חברים בקבוצה</div>'}
    </div>

    <div class="sec">
      <div class="kicker">מתכונים</div>
      <h2>מה לשלוח לאכול</h2>
      <p>מתכון בלי שיוך מגיע לכל הקבוצה; עם שיוך מגיע רק לחבר שנבחר.</p>
    </div>
    <div class="rowlist">
      ${recipes.length ? recipes.map((r) => `
        <div class="row" data-recipe="${r.id}">
          <span>
            <span class="row-text">${esc(r.title)}</span>
            <span class="facts">${r.member_name ? 'ל' + esc(r.member_name) : 'לכל הקבוצה'}</span>
          </span>
          <span class="row-actions">
            <button class="btn btn-secondary btn-sm" data-edit-recipe type="button">עריכה</button>
            <button class="btn btn-secondary btn-sm" data-del-recipe type="button">מחיקה</button>
          </span>
        </div>`).join('') : '<div class="empty">עוד לא נשלחו מתכונים</div>'}
    </div>
    <div class="add-row">
      <button class="btn btn-primary" id="new-recipe" type="button">מתכון חדש</button>
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
                    <label class="btn btn-secondary btn-sm" title="תמונת אילוסטרציה">
                      ${p.image_url ? 'החלפת תמונה' : 'תמונה'}
                      <input type="file" data-post-image accept="image/png,image/jpeg,image/webp" hidden />
                    </label>
                    <button class="btn btn-secondary btn-sm" data-gen-image type="button">יצירת תמונה</button>
                    ${p.image_url ? '<button class="btn btn-secondary btn-sm" data-del-image type="button">הסרה</button>' : ''}
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
        <input class="input" name="text" maxlength="200" placeholder="כלל אצבע חדש, שורה אחת" required />
        <button type="submit" class="btn btn-primary">הוספה</button>
      </form>
    </div>

    <div>
      <div class="sec" style="margin-bottom:var(--space-6)">
        <div class="kicker">סיסמאות</div>
        <h2>הטיקר בדף הבית</h2>
        <p>שורה אחת כל אחת, מתחלפות אחת לכמה שניות בראש דף הבית. ${slogans.length} כרגע.</p>
      </div>
      <div class="rowlist" id="slogan-list">
        ${slogans.map((t) => `
          <div class="row" data-slogan="${t.id}">
            <span class="row-text">${esc(t.text)}</span>
            <span class="row-actions">
              <button class="btn btn-secondary btn-sm" data-edit-slogan type="button">עריכה</button>
              <button class="btn btn-secondary btn-sm" data-del-slogan type="button">מחיקה</button>
            </span>
          </div>`).join('')}
      </div>
      <form id="slogan-form" class="add-row">
        <input class="input" name="text" maxlength="200" placeholder="סיסמה חדשה, שורה אחת" required />
        <button type="submit" class="btn btn-primary">הוספה</button>
      </form>
    </div>

    <div>
      <div class="sec" style="margin-bottom:var(--space-6)">
        <div class="kicker">הבוט</div>
        <h2>כתובת הבוט</h2>
        <p>הקישור שאליו נשלחים החברים מדף הבית. ריק מסתיר את הקטע מכולם חוץ ממך.</p>
      </div>
      <form id="bot-form" class="add-row">
        <input class="input" name="url" type="url" placeholder="https://..." value="${esc(botUrl)}" />
        <button type="submit" class="btn btn-primary">שמירה</button>
      </form>
    </div>

    <div>
      <div class="sec" style="margin-bottom:var(--space-6)">
        <div class="kicker">הרשאות</div>
        <h2>מי יכול לערוך</h2>
        <p>לעורך יש גישה לעמוד הזה: מאמרים, סיסמאות, מתכונים ותיבת המסרים.</p>
      </div>
      <div class="rowlist">
        ${members.map((m) => `
          <div class="row ${m.active ? '' : 'is-off'}" data-account="${m.id}">
            <span>
              <span class="row-text">${avatar(m, 'sm')}${esc(m.full_name)}${m.is_editor ? ' <span class="tag tag-accent">עורך</span>' : ''}${m.active ? '' : ' <span class="tag">מוסר</span>'}</span>
              <span class="facts">${esc(m.email)}</span>
            </span>
            <span class="row-actions">
              ${m.active ? `
                <button class="btn btn-secondary btn-sm" data-toggle-editor data-grant="${m.is_editor ? 0 : 1}" type="button">
                  ${m.is_editor ? 'הסרת הרשאה' : 'הפיכה לעורך'}
                </button>` : ''}
              <button class="btn btn-secondary btn-sm" data-toggle-active data-on="${m.active ? 0 : 1}" type="button">
                ${m.active ? 'הסרה מהקבוצה' : 'החזרה לקבוצה'}
              </button>
            </span>
          </div>`).join('')}
      </div>
    </div>`;

  // --- the thread with one member ---
  el.querySelectorAll('[data-open-thread]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.closest('[data-member]').dataset.member;
      const { member, messages } = await api('/editor/inbox/' + id);
      const backdrop = openModal(`שיחה עם ${member.full_name}`, `
        <div class="thread" id="editor-thread">
          ${messages.length ? messages.map((m) => `
            <div class="msg ${m.from_coach ? 'from-coach' : 'from-me'}">
              <div class="msg-who">${m.from_coach ? 'אתה' : esc(member.full_name)} · ${fmtDate(m.created_at)}</div>
              <div class="msg-body">${esc(m.body)}</div>
            </div>`).join('') : '<div class="empty">עוד לא נכתב דבר</div>'}
        </div>
        <div class="field" style="margin-top:14px">
          <label for="reply">התשובה שלך. היא תקפוץ לו בכניסה הבאה</label>
          <textarea class="input" id="reply" name="body" rows="4" maxlength="2000" required></textarea>
        </div>`,
        async (form) => {
          await api('/editor/inbox/' + id, { method: 'POST', body: form });
          toast('נשלח');
          render();
        }, 'שליחה');
      const box = backdrop.querySelector('#editor-thread');
      if (box) box.scrollTop = box.scrollHeight;
    });
  });

  // --- the emphases shown on that member's dashboard ---
  el.querySelectorAll('[data-edit-note]').forEach((button) => {
    button.addEventListener('click', () => {
      const member = inbox.find((m) => m.id === Number(button.closest('[data-member]').dataset.member));
      openModal(`דגשים ל${member.full_name}`, `
        <div class="field">
          <label for="note">שורה או שתיים שיופיעו בראש הדאשבורד שלו</label>
          <textarea class="input" id="note" name="coach_note" rows="3">${esc(member.coach_note || '')}</textarea>
        </div>`,
        async (form) => {
          await api(`/editor/members/${member.id}/note`, { method: 'PUT', body: form });
          toast('הדגשים נשמרו');
          render();
        });
    });
  });

  // --- recipes ---
  const recipeFields = (r = {}) => `
    <div class="field"><label>שם המתכון</label>
      <input class="input" name="title" value="${esc(r.title || '')}" required /></div>
    <div class="field" style="margin-top:10px"><label>למי</label>
      <select class="input" name="user_id">
        <option value="">לכל הקבוצה</option>
        ${inbox.map((m) => `<option value="${m.id}" ${r.user_id === m.id ? 'selected' : ''}>${esc(m.full_name)}</option>`).join('')}
      </select></div>
    <div class="field" style="margin-top:10px"><label>המתכון</label>
      <textarea class="input" name="body" rows="8">${esc(r.body || '')}</textarea></div>`;

  el.querySelector('#new-recipe')?.addEventListener('click', () => {
    openModal('מתכון חדש', recipeFields(), async (form) => {
      await api('/recipes', { method: 'POST', body: form });
      toast('נשלח');
      render();
    }, 'שליחה');
  });

  el.querySelectorAll('[data-edit-recipe]').forEach((button) => {
    button.addEventListener('click', () => {
      const recipe = recipes.find((r) => r.id === Number(button.closest('[data-recipe]').dataset.recipe));
      openModal('עריכת מתכון', recipeFields(recipe), async (form) => {
        await api('/recipes/' + recipe.id, { method: 'PUT', body: form });
        toast('עודכן');
        render();
      });
    });
  });

  el.querySelectorAll('[data-del-recipe]').forEach((button) => {
    button.addEventListener('click', () => {
      const recipe = recipes.find((r) => r.id === Number(button.closest('[data-recipe]').dataset.recipe));
      confirmAction(`למחוק את "${recipe.title}"?`, async () => {
        await api('/recipes/' + recipe.id, { method: 'DELETE' });
        toast('נמחק');
        render();
      });
    });
  });

  const reload = () => { tipsCache = {}; render(); };

  el.querySelector('#tip-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/tips', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) });
      toast('הטיפ נוסף');
      reload();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelector('#bot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/settings/bot-url', { method: 'PUT', body: { url: e.target.url.value.trim() } });
      toast('נשמר');
      render();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelector('#slogan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target).entries());
      await api('/tips', { method: 'POST', body: { ...body, kind: 'slogan' } });
      toast('הסיסמה נוספה');
      reload();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelectorAll('[data-edit-slogan]').forEach((button) => {
    button.addEventListener('click', () => {
      const slogan = slogans.find((t) => t.id === Number(button.closest('[data-slogan]').dataset.slogan));
      openModal('עריכת סיסמה', `
        <div class="field"><label>הטקסט</label>
          <input class="input" name="text" maxlength="200" value="${esc(slogan.text)}" required /></div>`,
        async (form) => {
          await api('/tips/' + slogan.id, { method: 'PUT', body: form });
          toast('עודכן');
          reload();
        });
    });
  });

  el.querySelectorAll('[data-del-slogan]').forEach((button) => {
    button.addEventListener('click', () => {
      const slogan = slogans.find((t) => t.id === Number(button.closest('[data-slogan]').dataset.slogan));
      confirmAction(`למחוק את "${slogan.text}"?`, async () => {
        await api('/tips/' + slogan.id, { method: 'DELETE' });
        toast('נמחק');
        reload();
      });
    });
  });

  el.querySelectorAll('[data-toggle-editor]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.closest('[data-account]').dataset.account);
      const member = members.find((m) => m.id === id);
      const grant = button.dataset.grant === '1';
      confirmAction(
        grant ? `לתת ל${member.full_name} הרשאת עריכה מלאה?` : `להסיר מ${member.full_name} את הרשאת העריכה?`,
        async () => {
          await api(`/editor/members/${id}/editor`, { method: 'PUT', body: { is_editor: grant ? 1 : 0 } });
          toast(grant ? 'ההרשאה ניתנה' : 'ההרשאה הוסרה');
          // Revoking your own rights closes this screen, so re-resolve the route.
          if (id === state.me.id) return boot();
          render();
        });
    });
  });

  el.querySelectorAll('[data-toggle-active]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.closest('[data-account]').dataset.account);
      const member = members.find((m) => m.id === id);
      const activate = button.dataset.on === '1';
      confirmAction(
        activate
          ? `להחזיר את ${member.full_name} לקבוצה?`
          : `להסיר את ${member.full_name} מהקבוצה? החשבון לא נמחק, והוא ייעלם מהרשימות ולא יוכל להתחבר.`,
        async () => {
          await api(`/editor/members/${id}/active`, { method: 'PUT', body: { active: activate ? 1 : 0 } });
          toast(activate ? 'הוחזר לקבוצה' : 'הוסר מהקבוצה');
          render();
        });
    });
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
    <div class="field" style="margin-top:10px"><label>תקציר, השורה שמופיעה בכרטיס</label>
      <input class="input" name="excerpt" value="${esc(post.excerpt || '')}" /></div>
    <div class="field" style="margin-top:10px"><label>כותב</label>
      <input class="input" name="author" value="${esc(post.author || 'מאור דוידוביץ')}" /></div>
    <div class="field" style="margin-top:10px"><label>זמן קריאה בדקות, ריק לחישוב אוטומטי</label>
      <input class="input" type="number" name="read_minutes" min="1" max="90" value="${post.read_minutes || ''}" /></div>
    <div class="field" style="margin-top:10px"><label>תוכן, שורה ריקה מפרידה פסקאות, ו-**כותרת** יוצרת כותרת משנה</label>
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

  el.querySelectorAll('[data-post-image]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const id = input.closest('[data-post]').dataset.post;
      try {
        // 1200px wide is plenty for a full-width illustration and keeps the upload small.
        await api(`/posts/${id}/image`, { method: 'POST', body: { image: await readImageAsDataURL(file, 1200) } });
        toast('התמונה הועלתה');
        render();
      } catch (err) { toast(err.message, true); }
    });
  });

  el.querySelectorAll('[data-gen-image]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.closest('[data-post]').dataset.post;
      const post = posts.find((p) => p.id === Number(id));
      openModal('יצירת תמונה לכתבה', `
        <p class="note-line" style="margin:0 0 12px">
          הסגנון קבוע לכל האתר. כאן קובעים רק מה יופיע בתמונה.
        </p>
        <div class="field">
          <label for="genp">מה לצייר</label>
          <textarea class="input" id="genp" name="prompt" rows="3">${esc(`${post.title}. ${post.excerpt || ''}`.trim())}</textarea>
        </div>`,
        async (form) => {
          await api(`/posts/${id}/generate-image`, { method: 'POST', body: form });
          toast('התמונה נוצרה');
          render();
        }, 'יצירה');
    });
  });

  el.querySelectorAll('[data-del-image]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.closest('[data-post]').dataset.post;
      confirmAction('להסיר את תמונת האילוסטרציה?', async () => {
        await api(`/posts/${id}/image`, { method: 'DELETE' });
        toast('הוסרה');
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
  { path: 'home', title: 'ראשי', render: viewHome, open: true },
  { path: 'dashboard', title: 'דאשבורד', render: viewDashboard },
  { path: 'progress', title: 'התקדמות', render: viewProgress },
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

  // Bring the current tab into view by scrolling the strip itself. Using
  // scrollIntoView here would move the whole page and make it jump on render.
  const strip = document.getElementById('tabs');
  const current = strip.querySelector('a.active');
  if (current && strip.scrollWidth > strip.clientWidth) {
    strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
  }

  document.getElementById('readout-member').classList.toggle('hidden', !signedIn);
  document.getElementById('readout-guest').classList.toggle('hidden', signedIn);
  if (signedIn) {
    document.getElementById('xp-readout').textContent = nf(state.me.total_points);
  }
}

async function render() {
  const path = currentPath();
  const el = document.getElementById('view');
  const article = /^articles\/(.+)$/.exec(path);
  const route = ROUTES.find((r) => r.path === path);

  renderChrome();
  el.className = 'screen';
  // Hold the previous height while the next screen loads, so nothing collapses
  // and springs back. Cleared as soon as the new markup is in.
  const held = el.offsetHeight;
  el.style.minHeight = held > 200 ? `${held}px` : '';
  el.innerHTML = '<div class="empty">טוען…</div>';
  try {
    if (article) await viewArticle(el, decodeURIComponent(article[1]));
    else if (!route || (route.guestOnly && state.me)) { location.hash = '#/' + homePath(); return true; }
    // The editor tab is not just hidden from members; the route itself is closed.
    else if (route.editorOnly && !state.me?.is_editor) { location.hash = '#/' + homePath(); return true; }
    else if (!route.open && !state.me) renderGate(el, route);
    else await route.render(el);
    renderChrome();
  } catch (err) {
    if (/התחברות/.test(err.message)) return boot();
    el.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  } finally {
    el.style.minHeight = '';
  }
}

// ---------------- Auth overlay ----------------
/** The sign-in card sits over the site rather than in front of it: closing it returns you to what you were reading. */
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
  // Reveal the shell only once the first screen is in the DOM. Showing an empty
  // shell first parks the footer in the middle of the viewport and then throws it
  // down the page when the content lands. That is the load "jump".
  // A redirect resolves to true, so follow it to the screen it lands on.
  let hops = 0;
  while ((await render()) === true && hops++ < 3);
  showApp();
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
