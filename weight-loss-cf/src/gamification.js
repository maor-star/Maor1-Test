// אותה לוגיקת גיימיפיקציה כמו בגרסת Node, מותאמת ל-D1 (אסינכרוני).

export const XP = {
  DAILY_LOG: 10,
  PROTEIN_GOAL: 20,
  STRENGTH_WORKOUT: 50,
  WEIGH_IN: 100,
};

export const XP_PER_LEVEL = 500;

export const LEVEL_TITLES = [
  'מתחילים',
  'בדרך הנכונה',
  'צובר תאוצה',
  'לוחם יומיומי',
  'מכונה משומנת',
  'אלוף הרכב הגוף',
];

export function levelInfo(totalPoints) {
  const points = Math.max(0, Number(totalPoints) || 0);
  const level = Math.floor(points / XP_PER_LEVEL) + 1;
  const intoLevel = points % XP_PER_LEVEL;
  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    points_into_level: intoLevel,
    points_for_next_level: XP_PER_LEVEL,
    progress_pct: Math.round((intoLevel / XP_PER_LEVEL) * 100),
  };
}

// ---- Date helpers (calendar days in the app's timezone, not UTC) ----
export function todayISO(tz = 'Asia/Jerusalem') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

export function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) && !Number.isNaN(Date.parse(`${iso}T12:00:00Z`));
}

/** ISO-8601 week key, e.g. "2026-W35". Weeks run Monday..Sunday. */
export function weekKey(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday of the week containing `iso`. */
export function weekStart(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return shiftDate(iso, -((d.getUTCDay() + 6) % 7));
}

// ---- Streak ----
export async function computeStreak(env, userId, today) {
  const { results } = await env.DB
    .prepare('SELECT date FROM daily_logs WHERE user_id = ? ORDER BY date DESC LIMIT 400')
    .bind(userId).all();
  const dates = results.map((r) => r.date);
  if (!dates.length) return 0;

  const yesterday = shiftDate(today, -1);
  if (dates[0] !== today && dates[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] === shiftDate(dates[i - 1], -1)) streak++;
    else break;
  }
  return streak;
}

async function proteinStreak(env, userId, proteinGoal) {
  if (proteinGoal <= 0) return 0;
  const { results } = await env.DB
    .prepare('SELECT date FROM daily_logs WHERE user_id = ? AND protein_consumed >= ? ORDER BY date DESC LIMIT 400')
    .bind(userId, proteinGoal).all();
  const dates = results.map((r) => r.date);
  if (!dates.length) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] === shiftDate(dates[i - 1], -1)) run++;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

async function workoutsThisWeek(env, userId, iso) {
  const start = weekStart(iso);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM daily_logs
     WHERE user_id = ? AND strength_workout_done = 1 AND date BETWEEN ? AND ?`
  ).bind(userId, start, shiftDate(start, 6)).first();
  return row.n;
}

// ---- Badges ----
/** Grants any badge the user now qualifies for and returns the newly earned rows. */
export async function evaluateBadges(env, userId, today) {
  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(userId).first();
  if (!profile) return [];

  const { results: earned } = await env.DB.prepare(
    'SELECT b.key FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?'
  ).bind(userId).all();
  const earnedKeys = new Set(earned.map((r) => r.key));

  const qualifies = {
    iron_champion:
      profile.weekly_workouts_goal > 0 &&
      (await workoutsThisWeek(env, userId, today)) >= profile.weekly_workouts_goal,
    protein_master: (await proteinStreak(env, userId, profile.daily_protein_goal)) >= 7,
    iron_consistency: (await computeStreak(env, userId, today)) >= 14,
  };

  const newlyEarned = [];
  for (const [key, ok] of Object.entries(qualifies)) {
    if (!ok || earnedKeys.has(key)) continue;
    const badge = await env.DB.prepare('SELECT * FROM badges WHERE key = ?').bind(key).first();
    if (!badge) continue;
    const info = await env.DB.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)')
      .bind(userId, badge.id).run();
    if (info.meta.changes) {
      await env.DB.prepare('UPDATE profiles SET total_points = total_points + ? WHERE id = ?')
        .bind(badge.points_reward, userId).run();
      newlyEarned.push(badge);
    }
  }
  return newlyEarned;
}

// ---- Points bookkeeping ----
export function dailyLogPoints(log, profile) {
  let points = XP.DAILY_LOG;
  if (profile.daily_protein_goal > 0 && log.protein_consumed >= profile.daily_protein_goal) {
    points += XP.PROTEIN_GOAL;
  }
  if (log.strength_workout_done) points += XP.STRENGTH_WORKOUT;
  return points;
}

/** Adds only the difference, so editing a record never double-counts points. */
export async function applyPointsDelta(env, userId, previousPoints, nextPoints) {
  const delta = nextPoints - previousPoints;
  if (delta !== 0) {
    await env.DB.prepare('UPDATE profiles SET total_points = MAX(0, total_points + ?) WHERE id = ?')
      .bind(delta, userId).run();
  }
  return delta;
}

export async function refreshStreak(env, userId, today) {
  const streak = await computeStreak(env, userId, today);
  await env.DB.prepare('UPDATE profiles SET current_streak = ? WHERE id = ?').bind(streak, userId).run();
  return streak;
}
