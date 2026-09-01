import db from './db.js';

const TZ = process.env.APP_TZ || 'Asia/Jerusalem';

// ---- XP awards (per the PRD) ----
export const XP = {
  DAILY_LOG: 10,
  PROTEIN_GOAL: 20,
  STRENGTH_WORKOUT: 50,
  WEIGH_IN: 100,
};

/** XP needed for each additional level. Level 1 starts at 0 XP. */
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
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
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
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week decides the year
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
/**
 * Consecutive days with a daily log, counted back from today.
 * Yesterday still counts as "alive" so the streak isn't lost before the day is over.
 */
export function computeStreak(userId) {
  const dates = db
    .prepare('SELECT date FROM daily_logs WHERE user_id = ? ORDER BY date DESC LIMIT 400')
    .all(userId)
    .map((r) => r.date);
  if (!dates.length) return 0;

  const today = todayISO();
  const yesterday = shiftDate(today, -1);
  if (dates[0] !== today && dates[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] === shiftDate(dates[i - 1], -1)) streak++;
    else break;
  }
  return streak;
}

/** Longest run of consecutive days on which the user hit their protein goal. */
function proteinStreak(userId, proteinGoal) {
  if (proteinGoal <= 0) return 0;
  const rows = db
    .prepare(
      `SELECT date FROM daily_logs
       WHERE user_id = ? AND protein_consumed >= ?
       ORDER BY date DESC LIMIT 400`
    )
    .all(userId, proteinGoal)
    .map((r) => r.date);
  if (!rows.length) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] === shiftDate(rows[i - 1], -1)) run++;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

function workoutsThisWeek(userId, iso) {
  const start = weekStart(iso);
  const end = shiftDate(start, 6);
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM daily_logs
       WHERE user_id = ? AND strength_workout_done = 1 AND date BETWEEN ? AND ?`
    )
    .get(userId, start, end).n;
}

// ---- Badges ----
/**
 * Grants any badge the user now qualifies for and returns the newly earned rows.
 * Each badge is granted once; its `points_reward` is added to the profile on grant.
 */
export function evaluateBadges(userId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId);
  if (!profile) return [];

  const earnedKeys = new Set(
    db
      .prepare('SELECT b.key FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?')
      .all(userId)
      .map((r) => r.key)
  );

  const today = todayISO();
  const qualifies = {
    iron_champion:
      profile.weekly_workouts_goal > 0 && workoutsThisWeek(userId, today) >= profile.weekly_workouts_goal,
    protein_master: proteinStreak(userId, profile.daily_protein_goal) >= 7,
    // Counted over the last thirty days rather than as an unbroken run: one missed
    // evening should not wipe out a month of reporting.
    iron_consistency: db.prepare(
      'SELECT COUNT(*) AS n FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ?'
    ).get(userId, shiftDate(today, -29), today).n >= 14,
  };

  const grant = db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)');
  const addPoints = db.prepare('UPDATE profiles SET total_points = total_points + ? WHERE id = ?');
  const newlyEarned = [];

  for (const [key, ok] of Object.entries(qualifies)) {
    if (!ok || earnedKeys.has(key)) continue;
    const badge = db.prepare('SELECT * FROM badges WHERE key = ?').get(key);
    if (!badge) continue;
    const info = grant.run(userId, badge.id);
    if (info.changes) {
      addPoints.run(badge.points_reward, userId);
      newlyEarned.push(badge);
    }
  }
  return newlyEarned;
}

// ---- Points bookkeeping ----
/** XP a daily log is worth, given the user's goals. */
export function dailyLogPoints(log, profile) {
  let points = XP.DAILY_LOG;
  if (profile.daily_protein_goal > 0 && log.protein_consumed >= profile.daily_protein_goal) {
    points += XP.PROTEIN_GOAL;
  }
  if (log.strength_workout_done) points += XP.STRENGTH_WORKOUT;
  return points;
}

/**
 * Applies the difference between the XP a record is now worth and what it was
 * previously awarded, so editing a log never double-counts points.
 */
export function applyPointsDelta(userId, previousPoints, nextPoints) {
  const delta = nextPoints - previousPoints;
  if (delta !== 0) {
    db.prepare('UPDATE profiles SET total_points = MAX(0, total_points + ?) WHERE id = ?').run(delta, userId);
  }
  return delta;
}

export function refreshStreak(userId) {
  const streak = computeStreak(userId);
  db.prepare('UPDATE profiles SET current_streak = ? WHERE id = ?').run(streak, userId);
  return streak;
}
