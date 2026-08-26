import express from 'express';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import db from './db.js';
import {
  hashPassword, verifyPassword, startSession, endSession,
  attachUser, requireAuth, publicProfile,
} from './auth.js';
import {
  XP, levelInfo, todayISO, shiftDate, isValidDate, weekKey, weekStart,
  evaluateBadges, dailyLogPoints, applyPointsDelta, refreshStreak,
} from './gamification.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadsDir = join(dirname(process.env.DB_PATH || join(__dirname, 'data', 'weightloss.db')), 'uploads');
const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json({ limit: '12mb' }));
app.use(express.static(join(__dirname, 'public')));
app.use(attachUser);

// ---------- Helpers ----------
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

function asyncRoute(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(err.status || 400).json({ error: err.message });
    }
  };
}

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function intInRange(value, { min, max, label }) {
  const n = Math.round(num(value));
  if (!Number.isFinite(n) || n < min || n > max) {
    throw fail(`${label} חייב להיות מספר בין ${min} ל-${max}`);
  }
  return n;
}

/** The profile plus everything the header and dashboard need. */
function profileState(userId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId);
  const badges = db.prepare(`
    SELECT b.*, ub.earned_at
    FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? ORDER BY ub.earned_at DESC
  `).all(userId);
  return { ...publicProfile(profile), level: levelInfo(profile.total_points), badges };
}

// ---------- Auth ----------
app.post('/api/auth/register', asyncRoute((req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const fullName = str(req.body.full_name);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('כתובת אימייל לא תקינה');
  if (password.length < 6) throw fail('הסיסמה חייבת להכיל לפחות 6 תווים');
  if (!fullName) throw fail('יש להזין שם מלא');
  if (db.prepare('SELECT 1 FROM profiles WHERE email = ?').get(email)) {
    throw fail('כתובת האימייל כבר רשומה במערכת');
  }
  const info = db.prepare(
    'INSERT INTO profiles (email, password_hash, full_name) VALUES (?, ?, ?)'
  ).run(email, hashPassword(password), fullName);
  const user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid);
  startSession(res, user);
  res.json(profileState(user.id));
}));

app.post('/api/auth/login', asyncRoute((req, res) => {
  const email = str(req.body.email).toLowerCase();
  const user = db.prepare('SELECT * FROM profiles WHERE email = ?').get(email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    throw fail('אימייל או סיסמה שגויים', 401);
  }
  if (!user.active) throw fail('החשבון אינו פעיל', 403);
  startSession(res, user);
  refreshStreak(user.id);
  res.json(profileState(user.id));
}));

app.post('/api/auth/logout', asyncRoute((req, res) => {
  endSession(res);
  res.json({ ok: true });
}));

app.get('/api/me', asyncRoute((req, res) => {
  if (!req.user) return res.json(null);
  refreshStreak(req.user.id);
  res.json(profileState(req.user.id));
}));

/** Goals are set by the person they belong to; there is no coach to set them. */
app.put('/api/me/goals', requireAuth, asyncRoute((req, res) => {
  db.prepare(`
    UPDATE profiles
    SET full_name = ?, daily_calories_goal = ?, daily_protein_goal = ?, weekly_workouts_goal = ?
    WHERE id = ?
  `).run(
    str(req.body.full_name) || req.user.full_name,
    intInRange(req.body.daily_calories_goal, { min: 500, max: 10000, label: 'יעד הקלוריות' }),
    intInRange(req.body.daily_protein_goal, { min: 10, max: 500, label: 'יעד החלבון' }),
    intInRange(req.body.weekly_workouts_goal, { min: 0, max: 14, label: 'יעד האימונים' }),
    req.user.id
  );
  // A lower goal can put a badge within reach immediately.
  evaluateBadges(req.user.id);
  res.json(profileState(req.user.id));
}));

app.put('/api/me/password', requireAuth, asyncRoute((req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  if (!verifyPassword(current, req.user.password_hash)) throw fail('הסיסמה הנוכחית שגויה');
  if (next.length < 6) throw fail('הסיסמה החדשה חייבת להכיל לפחות 6 תווים');
  db.prepare('UPDATE profiles SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
}));

// ---------- Daily logs ----------
app.get('/api/logs', requireAuth, asyncRoute((req, res) => {
  const to = isValidDate(req.query.to) ? req.query.to : todayISO();
  const from = isValidDate(req.query.from) ? req.query.from : shiftDate(to, -29);
  res.json(db.prepare(
    'SELECT * FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC'
  ).all(req.user.id, from, to));
}));

app.get('/api/logs/:date', requireAuth, asyncRoute((req, res) => {
  if (!isValidDate(req.params.date)) throw fail('תאריך לא תקין');
  res.json(db.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?')
    .get(req.user.id, req.params.date) || null);
}));

/** Upsert of the daily check-in. Re-submitting the same day adjusts XP instead of adding it again. */
app.put('/api/logs', requireAuth, asyncRoute((req, res) => {
  const date = isValidDate(req.body.date) ? req.body.date : todayISO();
  if (date > todayISO()) throw fail('לא ניתן לדווח על תאריך עתידי');

  const entry = {
    calories_consumed: intInRange(req.body.calories_consumed, { min: 0, max: 20000, label: 'קלוריות' }),
    protein_consumed: intInRange(req.body.protein_consumed, { min: 0, max: 1000, label: 'חלבון' }),
    strength_workout_done: bool(req.body.strength_workout_done) ? 1 : 0,
  };

  const result = db.transaction(() => {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.user.id);
    const existing = db.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?').get(profile.id, date);
    const points = dailyLogPoints(entry, profile);

    if (existing) {
      db.prepare(`
        UPDATE daily_logs
        SET calories_consumed = ?, protein_consumed = ?, strength_workout_done = ?, points_awarded = ?
        WHERE id = ?
      `).run(entry.calories_consumed, entry.protein_consumed, entry.strength_workout_done, points, existing.id);
    } else {
      db.prepare(`
        INSERT INTO daily_logs (user_id, date, calories_consumed, protein_consumed, strength_workout_done, points_awarded)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(profile.id, date, entry.calories_consumed, entry.protein_consumed, entry.strength_workout_done, points);
    }

    const gained = applyPointsDelta(profile.id, existing ? existing.points_awarded : 0, points);
    refreshStreak(profile.id);

    return {
      log: db.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?').get(profile.id, date),
      points_gained: gained,
      workout_celebrated: !!entry.strength_workout_done && (!existing || !existing.strength_workout_done),
      new_badges: evaluateBadges(profile.id),
      profile: profileState(profile.id),
    };
  })();

  res.json(result);
}));

// ---------- Weekly weigh-ins ----------
app.get('/api/weigh-ins', requireAuth, asyncRoute((req, res) => {
  res.json(db.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? ORDER BY date DESC').all(req.user.id));
}));

function savePhoto(dataUrl) {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw fail('פורמט התמונה אינו נתמך (PNG, JPG או WEBP בלבד)');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 8 * 1024 * 1024) throw fail('התמונה גדולה מדי (עד 8MB)');
  const name = `${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
  writeFileSync(join(uploadsDir, name), buffer);
  return name;
}

/** One weigh-in per calendar week; sending another for the same week replaces it. */
app.post('/api/weigh-ins', requireAuth, asyncRoute((req, res) => {
  const date = isValidDate(req.body.date) ? req.body.date : todayISO();
  if (date > todayISO()) throw fail('לא ניתן לדווח על תאריך עתידי');
  const weight = num(req.body.weight);
  if (!(weight > 20 && weight < 400)) throw fail('יש להזין משקל בין 20 ל-400 ק"ג');

  const waist = req.body.waist === undefined || req.body.waist === '' ? null : num(req.body.waist);
  if (waist !== null && !(waist > 30 && waist < 250)) throw fail('היקף המותניים חייב להיות בין 30 ל-250 ס"מ');

  const week = weekKey(date);
  const photo = req.body.photo ? savePhoto(req.body.photo) : null;

  const result = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? AND week = ?')
      .get(req.user.id, week);

    if (existing) {
      if (photo && existing.photo_url && existsSync(join(uploadsDir, existing.photo_url))) {
        unlinkSync(join(uploadsDir, existing.photo_url));
      }
      db.prepare(`
        UPDATE weekly_weigh_ins
        SET date = ?, weight = ?, waist = COALESCE(?, waist), photo_url = COALESCE(?, photo_url)
        WHERE id = ?
      `).run(date, weight, waist, photo, existing.id);
    } else {
      db.prepare(`
        INSERT INTO weekly_weigh_ins (user_id, date, week, weight, waist, photo_url, points_awarded)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.id, date, week, weight, waist, photo, XP.WEIGH_IN);
      applyPointsDelta(req.user.id, 0, XP.WEIGH_IN);
    }

    return {
      weigh_in: db.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? AND week = ?').get(req.user.id, week),
      points_gained: existing ? 0 : XP.WEIGH_IN,
      new_badges: evaluateBadges(req.user.id),
      profile: profileState(req.user.id),
    };
  })();

  res.json(result);
}));

/** Progress photos are private: served only to the person who uploaded them. */
app.get('/api/weigh-ins/:id/photo', requireAuth, asyncRoute((req, res) => {
  const row = db.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?').get(req.params.id);
  if (!row || !row.photo_url) throw fail('התמונה לא נמצאה', 404);
  if (row.user_id !== req.user.id) throw fail('אין הרשאה', 403);
  const path = join(uploadsDir, row.photo_url);
  if (!existsSync(path)) throw fail('התמונה לא נמצאה', 404);
  res.sendFile(path);
}));

// ---------- Badges ----------
app.get('/api/badges', requireAuth, asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT b.*, ub.earned_at
    FROM badges b
    LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
    ORDER BY (ub.earned_at IS NULL), b.points_reward
  `).all(req.user.id));
}));

// ---------- Personal stats ----------
function personalStats(userId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId);
  const today = todayISO();
  const from = shiftDate(today, -29);

  const logs = db.prepare(
    'SELECT * FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date'
  ).all(userId, from, today);

  const weighIns = db.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? ORDER BY date').all(userId);

  const start = weekStart(today);
  const workoutsThisWeek = db.prepare(`
    SELECT COUNT(*) AS n FROM daily_logs
    WHERE user_id = ? AND strength_workout_done = 1 AND date BETWEEN ? AND ?
  `).get(userId, start, shiftDate(start, 6)).n;

  const totalWorkouts = db.prepare(
    'SELECT COUNT(*) AS n FROM daily_logs WHERE user_id = ? AND strength_workout_done = 1'
  ).get(userId).n;

  const proteinGoalDays = logs.filter(
    (l) => profile.daily_protein_goal > 0 && l.protein_consumed >= profile.daily_protein_goal
  ).length;

  const first = weighIns[0];
  const last = weighIns[weighIns.length - 1];
  const firstWaist = weighIns.find((w) => w.waist != null);
  const lastWaist = [...weighIns].reverse().find((w) => w.waist != null);

  return {
    today,
    week_start: start,
    logs,
    weigh_ins: weighIns,
    workouts_this_week: workoutsThisWeek,
    total_workouts: totalWorkouts,
    weekly_workouts_goal: profile.weekly_workouts_goal,
    protein_goal_days_30: proteinGoalDays,
    logged_days_30: logs.length,
    weeks_in_program: weighIns.length,
    weight_start: first ? first.weight : null,
    weight_latest: last ? last.weight : null,
    weight_change: first && last ? Number((last.weight - first.weight).toFixed(1)) : null,
    waist_change: firstWaist && lastWaist && firstWaist.id !== lastWaist.id
      ? Number((lastWaist.waist - firstWaist.waist).toFixed(1)) : null,
  };
}

app.get('/api/stats', requireAuth, asyncRoute((req, res) => res.json(personalStats(req.user.id))));

// ---------- The group ----------
/**
 * Everyone using the app is in one group. Members see each other's headline
 * numbers only — never another member's daily logs, photos or email.
 */
function memberSummary(row) {
  const stats = personalStats(row.id);
  return {
    id: row.id,
    full_name: row.full_name,
    total_points: row.total_points,
    current_streak: row.current_streak,
    level: levelInfo(row.total_points),
    weeks_in_program: stats.weeks_in_program,
    weight_change: stats.weight_change,
    waist_change: stats.waist_change,
    workouts_this_week: stats.workouts_this_week,
    weekly_workouts_goal: stats.weekly_workouts_goal,
    total_workouts: stats.total_workouts,
    protein_goal_days_30: stats.protein_goal_days_30,
    logged_days_30: stats.logged_days_30,
  };
}

function groupAggregate() {
  const rows = db.prepare('SELECT * FROM profiles WHERE active = 1 ORDER BY total_points DESC').all();
  const members = rows.map(memberSummary);

  // Only members who actually lost weight contribute to the group total.
  const lost = members.reduce((sum, m) => sum + (m.weight_change < 0 ? -m.weight_change : 0), 0);

  return {
    total_kg_lost: Number(lost.toFixed(1)),
    member_count: members.length,
    workouts_this_week: members.reduce((sum, m) => sum + m.workouts_this_week, 0),
    longest_streak: members.reduce((max, m) => Math.max(max, m.current_streak), 0),
    members,
  };
}

app.get('/api/group', requireAuth, asyncRoute((req, res) => res.json(groupAggregate())));

// ---------- Public ----------
/**
 * Below this many members the group totals are one person's numbers wearing a
 * plural, so visitors get the member count alone until the group is big enough
 * to hide an individual.
 */
const MIN_MEMBERS_FOR_PUBLIC_TOTALS = 3;

/** The headline numbers for visitors. Never names a member or their figures. */
app.get('/api/public/summary', asyncRoute((req, res) => {
  const group = groupAggregate();
  const enough = group.member_count >= MIN_MEMBERS_FOR_PUBLIC_TOTALS;
  res.json({
    member_count: group.member_count,
    totals_visible: enough,
    total_kg_lost: enough ? group.total_kg_lost : null,
    workouts_this_week: enough ? group.workouts_this_week : null,
    longest_streak: enough ? group.longest_streak : null,
    post_count: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
  });
}));

// ---------- Articles ----------
/** Open to visitors: the articles are the part of the app that needs no account. */
app.get('/api/posts', asyncRoute((req, res) => {
  res.json(db.prepare(
    'SELECT id, slug, title, category, excerpt, read_minutes, published_at FROM posts ORDER BY published_at DESC, id'
  ).all());
}));

app.get('/api/posts/:slug', asyncRoute((req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.slug);
  if (!post) throw fail('המאמר לא נמצא', 404);
  res.json(post);
}));

app.listen(PORT, () => console.log(`הדרך הקלה לירידה במשקל — פועל על http://localhost:${PORT}`));
