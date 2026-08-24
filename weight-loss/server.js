import express from 'express';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import db from './db.js';
import {
  hashPassword, verifyPassword, startSession, endSession,
  attachUser, requireAuth, requireAdmin, publicProfile,
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

/** The profile plus everything the dashboard header needs. */
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
    'INSERT INTO profiles (email, password_hash, role, full_name) VALUES (?, ?, ?, ?)'
  ).run(email, hashPassword(password), 'client', fullName);
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
  if (!user.active) throw fail('החשבון אינו פעיל. יש לפנות למאמן', 403);
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
  const rows = db.prepare(
    'SELECT * FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC'
  ).all(req.user.id, from, to);
  res.json(rows);
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
    const newBadges = evaluateBadges(profile.id);

    return {
      log: db.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?').get(profile.id, date),
      points_gained: gained,
      first_submission: !existing,
      workout_celebrated: !!entry.strength_workout_done && (!existing || !existing.strength_workout_done),
      new_badges: newBadges,
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

  const week = weekKey(date);
  const photo = req.body.photo ? savePhoto(req.body.photo) : null;

  const result = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? AND week = ?')
      .get(req.user.id, week);

    if (existing) {
      if (photo && existing.photo_url && existsSync(join(uploadsDir, existing.photo_url))) {
        unlinkSync(join(uploadsDir, existing.photo_url));
      }
      db.prepare('UPDATE weekly_weigh_ins SET date = ?, weight = ?, photo_url = COALESCE(?, photo_url) WHERE id = ?')
        .run(date, weight, photo, existing.id);
    } else {
      db.prepare(`
        INSERT INTO weekly_weigh_ins (user_id, date, week, weight, photo_url, points_awarded)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.user.id, date, week, weight, photo, XP.WEIGH_IN);
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

/** Progress photos are served through this route so only their owner (or an admin) can read them. */
app.get('/api/weigh-ins/:id/photo', requireAuth, asyncRoute((req, res) => {
  const row = db.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?').get(req.params.id);
  if (!row || !row.photo_url) throw fail('התמונה לא נמצאה', 404);
  if (row.user_id !== req.user.id && req.user.role !== 'admin') throw fail('אין הרשאה', 403);
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

// ---------- Client stats ----------
app.get('/api/stats', requireAuth, asyncRoute((req, res) => {
  res.json(clientStats(req.user.id));
}));

function clientStats(userId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId);
  const today = todayISO();
  const from = shiftDate(today, -29);

  const logs = db.prepare(
    'SELECT * FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date'
  ).all(userId, from, today);

  const weighIns = db.prepare(
    'SELECT * FROM weekly_weigh_ins WHERE user_id = ? ORDER BY date'
  ).all(userId);

  const start = weekStart(today);
  const weekEnd = shiftDate(start, 6);
  const workoutsThisWeek = db.prepare(`
    SELECT COUNT(*) AS n FROM daily_logs
    WHERE user_id = ? AND strength_workout_done = 1 AND date BETWEEN ? AND ?
  `).get(userId, start, weekEnd).n;

  const proteinGoalDays = logs.filter(
    (l) => profile.daily_protein_goal > 0 && l.protein_consumed >= profile.daily_protein_goal
  ).length;

  const first = weighIns[0];
  const last = weighIns[weighIns.length - 1];

  return {
    today,
    week_start: start,
    logs,
    weigh_ins: weighIns,
    workouts_this_week: workoutsThisWeek,
    weekly_workouts_goal: profile.weekly_workouts_goal,
    protein_goal_days_30: proteinGoalDays,
    logged_days_30: logs.length,
    weight_start: first ? first.weight : null,
    weight_latest: last ? last.weight : null,
    weight_change: first && last ? Number((last.weight - first.weight).toFixed(1)) : null,
  };
}

// ---------- Blog ----------
app.get('/api/posts', requireAuth, asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT p.*, pr.full_name AS author_name
    FROM posts p LEFT JOIN profiles pr ON pr.id = p.author_id
    ORDER BY p.published_at DESC
  `).all());
}));

app.post('/api/posts', requireAdmin, asyncRoute((req, res) => {
  const title = str(req.body.title);
  if (!title) throw fail('יש להזין כותרת');
  const info = db.prepare('INSERT INTO posts (title, content, author_id) VALUES (?, ?, ?)')
    .run(title, str(req.body.content), req.user.id);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/posts/:id', requireAdmin, asyncRoute((req, res) => {
  const title = str(req.body.title);
  if (!title) throw fail('יש להזין כותרת');
  db.prepare('UPDATE posts SET title = ?, content = ? WHERE id = ?')
    .run(title, str(req.body.content), req.params.id);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id));
}));

app.delete('/api/posts/:id', requireAdmin, asyncRoute((req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Admin ----------
app.get('/api/admin/clients', requireAdmin, asyncRoute((req, res) => {
  const today = todayISO();
  const rows = db.prepare(`
    SELECT p.id, p.email, p.full_name, p.role, p.active, p.total_points, p.current_streak,
           p.daily_calories_goal, p.daily_protein_goal, p.weekly_workouts_goal, p.created_at,
           (SELECT COUNT(*) FROM daily_logs l WHERE l.user_id = p.id) AS log_count,
           (SELECT MAX(date) FROM daily_logs l WHERE l.user_id = p.id) AS last_log_date,
           (SELECT COUNT(*) FROM user_badges ub WHERE ub.user_id = p.id) AS badge_count,
           (SELECT weight FROM weekly_weigh_ins w WHERE w.user_id = p.id ORDER BY w.date DESC LIMIT 1) AS latest_weight
    FROM profiles p
    WHERE p.role = 'client'
    ORDER BY p.active DESC, p.full_name
  `).all();
  res.json(rows.map((r) => ({ ...r, logged_today: r.last_log_date === today, level: levelInfo(r.total_points) })));
}));

app.post('/api/admin/clients', requireAdmin, asyncRoute((req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const fullName = str(req.body.full_name);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('כתובת אימייל לא תקינה');
  if (password.length < 6) throw fail('הסיסמה חייבת להכיל לפחות 6 תווים');
  if (!fullName) throw fail('יש להזין שם מלא');
  if (db.prepare('SELECT 1 FROM profiles WHERE email = ?').get(email)) {
    throw fail('כתובת האימייל כבר רשומה במערכת');
  }
  const info = db.prepare(`
    INSERT INTO profiles (email, password_hash, role, full_name,
                          daily_calories_goal, daily_protein_goal, weekly_workouts_goal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    email, hashPassword(password), req.body.role === 'admin' ? 'admin' : 'client', fullName,
    intInRange(req.body.daily_calories_goal ?? 1800, { min: 500, max: 10000, label: 'יעד הקלוריות' }),
    intInRange(req.body.daily_protein_goal ?? 130, { min: 10, max: 500, label: 'יעד החלבון' }),
    intInRange(req.body.weekly_workouts_goal ?? 3, { min: 0, max: 14, label: 'יעד האימונים' })
  );
  res.json(publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid)));
}));

app.put('/api/admin/clients/:id', requireAdmin, asyncRoute((req, res) => {
  const target = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!target) throw fail('המשתמש לא נמצא', 404);
  const fullName = str(req.body.full_name) || target.full_name;

  db.prepare(`
    UPDATE profiles
    SET full_name = ?, daily_calories_goal = ?, daily_protein_goal = ?, weekly_workouts_goal = ?, active = ?
    WHERE id = ?
  `).run(
    fullName,
    intInRange(req.body.daily_calories_goal ?? target.daily_calories_goal, { min: 500, max: 10000, label: 'יעד הקלוריות' }),
    intInRange(req.body.daily_protein_goal ?? target.daily_protein_goal, { min: 10, max: 500, label: 'יעד החלבון' }),
    intInRange(req.body.weekly_workouts_goal ?? target.weekly_workouts_goal, { min: 0, max: 14, label: 'יעד האימונים' }),
    req.body.active === undefined ? target.active : (bool(req.body.active) ? 1 : 0),
    target.id
  );

  if (req.body.new_password) {
    if (String(req.body.new_password).length < 6) throw fail('הסיסמה חייבת להכיל לפחות 6 תווים');
    db.prepare('UPDATE profiles SET password_hash = ? WHERE id = ?')
      .run(hashPassword(String(req.body.new_password)), target.id);
  }

  // Goals changed, so previously unearned badges may now be within reach.
  evaluateBadges(target.id);
  res.json(publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(target.id)));
}));

app.delete('/api/admin/clients/:id', requireAdmin, asyncRoute((req, res) => {
  if (Number(req.params.id) === req.user.id) throw fail('לא ניתן למחוק את המשתמש שלך');
  db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

app.get('/api/admin/clients/:id', requireAdmin, asyncRoute((req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) throw fail('המשתמש לא נמצא', 404);
  res.json({
    profile: { ...publicProfile(profile), level: levelInfo(profile.total_points) },
    stats: clientStats(profile.id),
    badges: db.prepare(`
      SELECT b.*, ub.earned_at FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = ? ORDER BY ub.earned_at DESC
    `).all(profile.id),
  });
}));

app.put('/api/admin/weigh-ins/:id/feedback', requireAdmin, asyncRoute((req, res) => {
  const row = db.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?').get(req.params.id);
  if (!row) throw fail('השקילה לא נמצאה', 404);
  db.prepare('UPDATE weekly_weigh_ins SET admin_feedback = ? WHERE id = ?')
    .run(str(req.body.admin_feedback), row.id);
  res.json(db.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?').get(row.id));
}));

// ---------- Bootstrap the first admin ----------
function seedAdmin() {
  if (db.prepare("SELECT 1 FROM profiles WHERE role = 'admin'").get()) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@easyweightloss.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  db.prepare(`
    INSERT INTO profiles (email, password_hash, role, full_name)
    VALUES (?, ?, 'admin', ?)
  `).run(email, hashPassword(password), process.env.ADMIN_NAME || 'המאמן');
  console.log(`נוצר משתמש מנהל ראשוני: ${email} / ${password}`);
}
seedAdmin();

app.listen(PORT, () => console.log(`הדרך הקלה לרדת במשקל — פועל על http://localhost:${PORT}`));
