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

/** Content authoring is the one elevated capability; there is no coach area. */
function requireEditor(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'נדרשת התחברות' });
  if (!req.user.is_editor) return res.status(403).json({ error: 'הפעולה מותרת לעורך התוכן בלבד' });
  next();
}

const setting = (key, fallback) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

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
  // Whoever opens the app first is its editor; everyone after them is a member.
  const isFirst = db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n === 0;
  const info = db.prepare(
    'INSERT INTO profiles (email, password_hash, full_name, is_editor) VALUES (?, ?, ?, ?)'
  ).run(email, hashPassword(password), fullName, isFirst ? 1 : 0);
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

  // One weigh-in per calendar week: if this week is done, the next one opens Monday.
  const thisWeek = weekKey(today);
  const weighedThisWeek = weighIns.some((w) => w.week === thisWeek);
  const nextWeighIn = weighedThisWeek ? shiftDate(start, 7) : today;

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
    weighed_this_week: weighedThisWeek,
    next_weigh_in: nextWeighIn,
    target_weight: profile.target_weight,
    to_target: profile.target_weight && last
      ? Number((last.weight - profile.target_weight).toFixed(1)) : null,
    coach_note: profile.coach_note,
    has_photo: !!profile.photo_url,
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
    has_photo: !!row.photo_url,
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

  const goalKg = Number(setting('group_goal_kg', '200'));
  const total = Number(lost.toFixed(1));

  return {
    total_kg_lost: total,
    goal_kg: goalKg,
    goal_progress_pct: goalKg > 0 ? Math.min(100, Math.round((total / goalKg) * 100)) : 0,
    goal_remaining_kg: goalKg > 0 ? Number(Math.max(0, goalKg - total).toFixed(1)) : 0,
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

/**
 * The portrait on the home page is the editor's own profile photo, so it is changed
 * by uploading a new one from the dashboard rather than by a deploy.
 */
function heroProfile() {
  return db.prepare(
    'SELECT id, full_name, photo_url FROM profiles WHERE is_editor = 1 AND active = 1 AND photo_url IS NOT NULL ORDER BY id LIMIT 1'
  ).get();
}

app.get('/api/public/hero', asyncRoute((req, res) => {
  const row = heroProfile();
  const ready = !!row && existsSync(join(uploadsDir, row.photo_url));
  res.json({ has_photo: ready, name: ready ? row.full_name : null });
}));

app.get('/api/public/hero-photo', asyncRoute((req, res) => {
  const row = heroProfile();
  if (!row) throw fail('אין תמונה', 404);
  const path = join(uploadsDir, row.photo_url);
  if (!existsSync(path)) throw fail('אין תמונה', 404);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path);
}));

// ---------- Articles ----------
/** Open to visitors: the articles are the part of the app that needs no account. */
app.get('/api/posts', asyncRoute((req, res) => {
  res.json(db.prepare(
    'SELECT id, slug, title, category, excerpt, author, image_url, read_minutes, published_at FROM posts ORDER BY published_at DESC, id'
  ).all());
}));

app.get('/api/posts/:slug', asyncRoute((req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.slug);
  if (!post) throw fail('המאמר לא נמצא', 404);
  res.json(post);
}));

/**
 * Every member's cumulative loss over time, plus the group's running total.
 * Public, so it carries first names only and stays behind the same member
 * floor that hides the headline numbers for a group of one or two.
 */
app.get('/api/public/progress', asyncRoute((req, res) => {
  const members = db.prepare("SELECT id, full_name FROM profiles WHERE active = 1").all();
  // The floor keeps one or two members from being identifiable to a passing visitor.
  // Members of the group are meant to see each other, so for them it does not apply.
  const enough = req.user || members.length >= MIN_MEMBERS_FOR_PUBLIC_TOTALS;
  if (!enough) return res.json({ visible: false, series: [], total: [], goal_kg: Number(setting('group_goal_kg', '200')) });

  // Every date anyone weighed in on, in order — the shared x-axis.
  const dates = db.prepare('SELECT DISTINCT date FROM weekly_weigh_ins ORDER BY date').all().map((r) => r.date);

  const series = members.map((m) => {
    const rows = db.prepare('SELECT date, weight FROM weekly_weigh_ins WHERE user_id = ? ORDER BY date').all(m.id);
    if (!rows.length) return null;
    const start = rows[0].weight;
    // Carry the last known weight forward, so a missed week is a flat line, not a gap.
    let last = 0;
    const points = dates.map((d) => {
      const row = [...rows].reverse().find((r) => r.date <= d);
      if (row) last = Number((start - row.weight).toFixed(1));
      return row ? last : null;
    });
    return { name: m.full_name.split(' ')[0], points };
  }).filter(Boolean);

  const total = dates.map((_, i) =>
    Number(series.reduce((sum, s) => sum + Math.max(0, s.points[i] ?? 0), 0).toFixed(1)));

  res.json({ visible: true, dates, series, total, goal_kg: Number(setting('group_goal_kg', '200')) });
}));

/** The collective target, readable by visitors — it is the site's slogan. */
app.get('/api/public/goal', asyncRoute((req, res) => {
  res.json({ goal_kg: Number(setting('group_goal_kg', '200')) });
}));

// ---------- Tips (the rules of thumb on the dashboard) ----------
app.get('/api/tips', asyncRoute((req, res) => {
  const kind = req.query.kind === 'slogan' ? 'slogan' : 'rule';
  res.json(db.prepare('SELECT * FROM tips WHERE kind = ? ORDER BY position, id').all(kind));
}));

app.post('/api/tips', requireEditor, asyncRoute((req, res) => {
  const text = str(req.body.text);
  if (!text) throw fail('יש להזין טקסט');
  if (text.length > 200) throw fail('טיפ הוא שורה אחת — עד 200 תווים');
  const kind = req.body.kind === 'slogan' ? 'slogan' : 'rule';
  const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tips WHERE kind = ?').get(kind).n;
  const info = db.prepare('INSERT INTO tips (text, position, kind) VALUES (?, ?, ?)').run(text, next, kind);
  res.json(db.prepare('SELECT * FROM tips WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/tips/:id', requireEditor, asyncRoute((req, res) => {
  const text = str(req.body.text);
  if (!text) throw fail('יש להזין טקסט');
  if (text.length > 200) throw fail('טיפ הוא שורה אחת — עד 200 תווים');
  const info = db.prepare('UPDATE tips SET text = ? WHERE id = ?').run(text, req.params.id);
  if (!info.changes) throw fail('הטיפ לא נמצא', 404);
  res.json(db.prepare('SELECT * FROM tips WHERE id = ?').get(req.params.id));
}));

app.delete('/api/tips/:id', requireEditor, asyncRoute((req, res) => {
  db.prepare('DELETE FROM tips WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Articles: authoring ----------
/** Hebrew titles do not transliterate into a useful slug, so slugs are generated. */
function uniqueSlug() {
  for (let i = 0; i < 50; i++) {
    const slug = 'post-' + crypto.randomUUID().slice(0, 8);
    if (!db.prepare('SELECT 1 FROM posts WHERE slug = ?').get(slug)) return slug;
  }
  throw fail('לא הצלחנו לייצר מזהה למאמר');
}

function readPost(body) {
  const title = str(body.title);
  if (!title) throw fail('יש להזין כותרת');
  const content = str(body.content);
  if (!content) throw fail('יש להזין תוכן');
  // ~200 Hebrew words a minute, rounded up, so the badge is never "0 דקות".
  const readMinutes = body.read_minutes
    ? intInRange(body.read_minutes, { min: 1, max: 90, label: 'זמן הקריאה' })
    : Math.max(1, Math.round(content.split(/\s+/).length / 200));
  return {
    title, content, read_minutes: readMinutes,
    category: str(body.category) || 'כללי',
    excerpt: str(body.excerpt),
    author: str(body.author) || 'מאור דוידוביץ',
  };
}

app.post('/api/posts', requireEditor, asyncRoute((req, res) => {
  const post = readPost(req.body);
  const info = db.prepare(`
    INSERT INTO posts (slug, title, category, excerpt, content, author, read_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uniqueSlug(), post.title, post.category, post.excerpt, post.content, post.author, post.read_minutes);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/posts/:id', requireEditor, asyncRoute((req, res) => {
  const post = readPost(req.body);
  const info = db.prepare(`
    UPDATE posts SET title = ?, category = ?, excerpt = ?, content = ?, author = ?, read_minutes = ?
    WHERE id = ?
  `).run(post.title, post.category, post.excerpt, post.content, post.author, post.read_minutes, req.params.id);
  if (!info.changes) throw fail('המאמר לא נמצא', 404);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id));
}));

/** The illustration at the head of an article. Replacing one deletes the old file. */
app.post('/api/posts/:id/image', requireEditor, asyncRoute((req, res) => {
  const post = db.prepare('SELECT id, image_url FROM posts WHERE id = ?').get(req.params.id);
  if (!post) throw fail('המאמר לא נמצא', 404);
  const name = savePhoto(req.body.image);
  db.prepare('UPDATE posts SET image_url = ? WHERE id = ?').run(name, post.id);
  if (post.image_url && existsSync(join(uploadsDir, post.image_url))) unlinkSync(join(uploadsDir, post.image_url));
  res.json({ ok: true, image_url: name });
}));

app.delete('/api/posts/:id/image', requireEditor, asyncRoute((req, res) => {
  const post = db.prepare('SELECT id, image_url FROM posts WHERE id = ?').get(req.params.id);
  if (!post) throw fail('המאמר לא נמצא', 404);
  if (post.image_url && existsSync(join(uploadsDir, post.image_url))) unlinkSync(join(uploadsDir, post.image_url));
  db.prepare('UPDATE posts SET image_url = NULL WHERE id = ?').run(post.id);
  res.json({ ok: true });
}));

/** Open to visitors, like the articles themselves. */
app.get('/api/posts/:id/image', asyncRoute((req, res) => {
  const post = db.prepare('SELECT image_url FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !post.image_url) throw fail('אין תמונה', 404);
  const path = join(uploadsDir, post.image_url);
  if (!existsSync(path)) throw fail('אין תמונה', 404);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path);
}));

app.delete('/api/posts/:id', requireEditor, asyncRoute((req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

/** Every article, including the fields the list view omits. */
app.get('/api/editor/posts', requireEditor, asyncRoute((req, res) => {
  res.json(db.prepare('SELECT * FROM posts ORDER BY published_at DESC, id DESC').all());
}));

// ---------- The group target ----------
app.put('/api/settings/group-goal', requireEditor, asyncRoute((req, res) => {
  const kg = intInRange(req.body.goal_kg, { min: 1, max: 100000, label: 'היעד הקבוצתי' });
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run('group_goal_kg', String(kg));
  res.json(groupAggregate());
}));

// ---------- The personal target and photo ----------
app.put('/api/me/target-weight', requireAuth, asyncRoute((req, res) => {
  const raw = req.body.target_weight;
  const target = raw === '' || raw === null || raw === undefined ? null : num(raw);
  if (target !== null && !(target > 20 && target < 400)) throw fail('יעד המשקל חייב להיות בין 20 ל-400 ק"ג');
  db.prepare('UPDATE profiles SET target_weight = ? WHERE id = ?').run(target, req.user.id);
  res.json(profileState(req.user.id));
}));

app.post('/api/me/photo', requireAuth, asyncRoute((req, res) => {
  const previous = req.user.photo_url;
  const name = savePhoto(req.body.photo);
  db.prepare('UPDATE profiles SET photo_url = ? WHERE id = ?').run(name, req.user.id);
  if (previous && existsSync(join(uploadsDir, previous))) unlinkSync(join(uploadsDir, previous));
  res.json(profileState(req.user.id));
}));

/** Profile photos are visible to the group, unlike progress photos. */
app.get('/api/members/:id/photo', requireAuth, asyncRoute((req, res) => {
  const row = db.prepare('SELECT photo_url FROM profiles WHERE id = ?').get(req.params.id);
  if (!row || !row.photo_url) throw fail('אין תמונה', 404);
  const path = join(uploadsDir, row.photo_url);
  if (!existsSync(path)) throw fail('אין תמונה', 404);
  res.sendFile(path);
}));

// ---------- Messages ----------
/** The member's own thread with the coach, oldest first. */
app.get('/api/messages', requireAuth, asyncRoute((req, res) => {
  const rows = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at, id').all(req.user.id);
  // Anything the coach sent is now seen.
  db.prepare("UPDATE messages SET read_at = datetime('now') WHERE user_id = ? AND from_coach = 1 AND read_at IS NULL")
    .run(req.user.id);
  res.json(rows);
}));

/** Messages the member has not opened yet — these pop up on the dashboard. */
app.get('/api/messages/unread', requireAuth, asyncRoute((req, res) => {
  res.json(db.prepare(
    'SELECT * FROM messages WHERE user_id = ? AND from_coach = 1 AND read_at IS NULL ORDER BY created_at'
  ).all(req.user.id));
}));

app.post('/api/messages', requireAuth, asyncRoute((req, res) => {
  const body = str(req.body.body);
  if (!body) throw fail('אין מה לשלוח');
  if (body.length > 2000) throw fail('ההודעה ארוכה מדי (עד 2000 תווים)');
  const info = db.prepare('INSERT INTO messages (user_id, from_coach, body) VALUES (?, 0, ?)').run(req.user.id, body);
  res.json(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid));
}));

/** The coach's inbox: one row per member, newest first, unread from members counted. */
app.get('/api/editor/inbox', requireEditor, asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.full_name, p.photo_url IS NOT NULL AS has_photo, p.coach_note,
           (SELECT COUNT(*) FROM messages m WHERE m.user_id = p.id AND m.from_coach = 0 AND m.read_at IS NULL) AS unread,
           (SELECT COUNT(*) FROM messages m WHERE m.user_id = p.id) AS total,
           (SELECT body FROM messages m WHERE m.user_id = p.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
           (SELECT created_at FROM messages m WHERE m.user_id = p.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at
    FROM profiles p
    WHERE p.active = 1 AND p.is_editor = 0
    ORDER BY unread DESC, last_at DESC, p.full_name
  `).all());
}));

app.get('/api/editor/inbox/:id', requireEditor, asyncRoute((req, res) => {
  const member = db.prepare('SELECT id, full_name, coach_note, target_weight FROM profiles WHERE id = ?').get(req.params.id);
  if (!member) throw fail('החבר לא נמצא', 404);
  const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at, id').all(member.id);
  db.prepare("UPDATE messages SET read_at = datetime('now') WHERE user_id = ? AND from_coach = 0 AND read_at IS NULL")
    .run(member.id);
  res.json({ member, messages });
}));

app.post('/api/editor/inbox/:id', requireEditor, asyncRoute((req, res) => {
  const body = str(req.body.body);
  if (!body) throw fail('אין מה לשלוח');
  if (body.length > 2000) throw fail('ההודעה ארוכה מדי (עד 2000 תווים)');
  if (!db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(req.params.id)) throw fail('החבר לא נמצא', 404);
  const info = db.prepare('INSERT INTO messages (user_id, from_coach, body) VALUES (?, 1, ?)').run(req.params.id, body);
  res.json(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid));
}));

/** The coach's emphases for one member, shown on their dashboard. */
app.put('/api/editor/members/:id/note', requireEditor, asyncRoute((req, res) => {
  const note = str(req.body.coach_note);
  const info = db.prepare('UPDATE profiles SET coach_note = ? WHERE id = ?').run(note || null, req.params.id);
  if (!info.changes) throw fail('החבר לא נמצא', 404);
  res.json({ ok: true, coach_note: note });
}));

/** Everyone with an account, editors included — the inbox deliberately leaves editors out. */
app.get('/api/editor/members', requireEditor, asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT id, full_name, email, is_editor FROM profiles
    WHERE active = 1 ORDER BY is_editor DESC, full_name
  `).all());
}));

/** Editor rights are granted from inside the app, so nobody has to touch the database. */
app.put('/api/editor/members/:id/editor', requireEditor, asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const wanted = req.body.is_editor ? 1 : 0;
  const target = db.prepare('SELECT id, full_name, is_editor FROM profiles WHERE id = ?').get(id);
  if (!target) throw fail('החבר לא נמצא', 404);

  // Removing the last editor would lock the editing area for everyone, including the
  // person doing it, and there is no way back in from the app itself.
  if (!wanted) {
    const editors = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE is_editor = 1 AND active = 1').get().n;
    if (editors <= 1) throw fail('זה העורך האחרון — צריך להשאיר לפחות אחד');
  }

  db.prepare('UPDATE profiles SET is_editor = ? WHERE id = ?').run(wanted, id);
  res.json({ ok: true, id, is_editor: wanted });
}));

// ---------- Recipes ----------
/** Everything addressed to this member, plus everything addressed to the group. */
app.get('/api/recipes', requireAuth, asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT * FROM recipes WHERE user_id IS NULL OR user_id = ?
    ORDER BY (user_id IS NULL), created_at DESC, id DESC
  `).all(req.user.id));
}));

app.get('/api/editor/recipes', requireEditor, asyncRoute((req, res) => {
  res.json(db.prepare(`
    SELECT r.*, p.full_name AS member_name
    FROM recipes r LEFT JOIN profiles p ON p.id = r.user_id
    ORDER BY r.created_at DESC, r.id DESC
  `).all());
}));

function readRecipe(body) {
  const title = str(body.title);
  if (!title) throw fail('יש להזין שם למתכון');
  const userId = body.user_id === '' || body.user_id === undefined || body.user_id === null || body.user_id === '0'
    ? null : Math.round(num(body.user_id));
  if (userId !== null && !db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(userId)) {
    throw fail('החבר לא נמצא');
  }
  return { title, body: str(body.body), user_id: userId };
}

app.post('/api/recipes', requireEditor, asyncRoute((req, res) => {
  const r = readRecipe(req.body);
  const info = db.prepare('INSERT INTO recipes (user_id, title, body) VALUES (?, ?, ?)').run(r.user_id, r.title, r.body);
  res.json(db.prepare('SELECT * FROM recipes WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/recipes/:id', requireEditor, asyncRoute((req, res) => {
  const r = readRecipe(req.body);
  const info = db.prepare('UPDATE recipes SET user_id = ?, title = ?, body = ? WHERE id = ?')
    .run(r.user_id, r.title, r.body, req.params.id);
  if (!info.changes) throw fail('המתכון לא נמצא', 404);
  res.json(db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id));
}));

app.delete('/api/recipes/:id', requireEditor, asyncRoute((req, res) => {
  db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

app.listen(PORT, () => console.log(`הדרך הקלה לירידה במשקל — פועל על http://localhost:${PORT}`));
