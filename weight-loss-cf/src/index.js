import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  hashPassword, verifyPassword, signSession, verifySession,
  publicProfile, COOKIE_NAME, sessionMaxAge, sessionExpiry,
} from './auth.js';
import {
  XP, levelInfo, todayISO, shiftDate, isValidDate, weekKey, weekStart,
  evaluateBadges, dailyLogPoints, applyPointsDelta, refreshStreak,
} from './gamification.js';

const app = new Hono();

// ---------- Helpers ----------
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => new AppError(message, status);

function intInRange(value, { min, max, label }) {
  const n = Math.round(num(value));
  if (!Number.isFinite(n) || n < min || n > max) {
    throw fail(`${label} חייב להיות מספר בין ${min} ל-${max}`);
  }
  return n;
}

const today = (c) => todayISO(c.env.APP_TZ || 'Asia/Jerusalem');
const secret = (c) => c.env.SESSION_SECRET || 'easy-weight-loss-dev-secret';

app.onError((err, c) => {
  if (!(err instanceof AppError)) console.error(err);
  return c.json({ error: err.message || 'שגיאה בשרת' }, err.status || 500);
});

/** The profile plus everything the dashboard header needs. */
async function profileState(env, userId) {
  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(userId).first();
  const { results: badges } = await env.DB.prepare(`
    SELECT b.*, ub.earned_at
    FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? ORDER BY ub.earned_at DESC
  `).bind(userId).all();
  return { ...publicProfile(profile), level: levelInfo(profile.total_points), badges };
}

async function startSession(c, user) {
  const token = await signSession(secret(c), { uid: user.id, exp: sessionExpiry() });
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    // On Workers the request URL is always https; the check only relaxes local `wrangler dev`.
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: sessionMaxAge,
  });
}

// ---------- Auth middleware ----------
app.use('/api/*', async (c, next) => {
  const payload = await verifySession(secret(c), getCookie(c, COOKIE_NAME));
  c.set('user', payload
    ? await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ? AND active = 1').bind(payload.uid).first()
    : null);
  await next();
});

const requireAuth = async (c, next) => {
  if (!c.get('user')) throw fail('נדרשת התחברות', 401);
  await next();
};

// ---------- Auth ----------
app.post('/api/auth/register', async (c) => {
  const body = await c.req.json();
  const email = str(body.email).toLowerCase();
  const password = String(body.password || '');
  const fullName = str(body.full_name);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('כתובת אימייל לא תקינה');
  if (password.length < 6) throw fail('הסיסמה חייבת להכיל לפחות 6 תווים');
  if (!fullName) throw fail('יש להזין שם מלא');
  if (await c.env.DB.prepare('SELECT 1 AS ok FROM profiles WHERE email = ?').bind(email).first()) {
    throw fail('כתובת האימייל כבר רשומה במערכת');
  }
  const info = await c.env.DB.prepare(
    "INSERT INTO profiles (email, password_hash, role, full_name) VALUES (?, ?, 'client', ?)"
  ).bind(email, await hashPassword(password), fullName).run();
  const user = { id: info.meta.last_row_id };
  await startSession(c, user);
  return c.json(await profileState(c.env, user.id));
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json();
  const email = str(body.email).toLowerCase();
  const user = await c.env.DB.prepare('SELECT * FROM profiles WHERE email = ?').bind(email).first();
  if (!user || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
    throw fail('אימייל או סיסמה שגויים', 401);
  }
  if (!user.active) throw fail('החשבון אינו פעיל. יש לפנות למאמן', 403);
  await startSession(c, user);
  await refreshStreak(c.env, user.id, today(c));
  return c.json(await profileState(c.env, user.id));
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json(null);
  await refreshStreak(c.env, user.id, today(c));
  return c.json(await profileState(c.env, user.id));
});

/** Goals are set by the person they belong to; there is no coach to set them. */
app.put('/api/me/goals', requireAuth, async (c) => {
  const body = await c.req.json();
  const user = c.get('user');
  await c.env.DB.prepare(`
    UPDATE profiles
    SET full_name = ?, daily_calories_goal = ?, daily_protein_goal = ?, weekly_workouts_goal = ?
    WHERE id = ?
  `).bind(
    str(body.full_name) || user.full_name,
    intInRange(body.daily_calories_goal, { min: 500, max: 10000, label: 'יעד הקלוריות' }),
    intInRange(body.daily_protein_goal, { min: 10, max: 500, label: 'יעד החלבון' }),
    intInRange(body.weekly_workouts_goal, { min: 0, max: 14, label: 'יעד האימונים' }),
    user.id
  ).run();
  // A lower goal can put a badge within reach immediately.
  await evaluateBadges(c.env, user.id, today(c));
  return c.json(await profileState(c.env, user.id));
});

app.put('/api/me/password', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  if (!(await verifyPassword(String(body.current_password || ''), user.password_hash))) {
    throw fail('הסיסמה הנוכחית שגויה');
  }
  const next = String(body.new_password || '');
  if (next.length < 6) throw fail('הסיסמה החדשה חייבת להכיל לפחות 6 תווים');
  await c.env.DB.prepare('UPDATE profiles SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(next), user.id).run();
  return c.json({ ok: true });
});

// ---------- Daily logs ----------
app.get('/api/logs', requireAuth, async (c) => {
  const to = isValidDate(c.req.query('to')) ? c.req.query('to') : today(c);
  const from = isValidDate(c.req.query('from')) ? c.req.query('from') : shiftDate(to, -29);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC'
  ).bind(c.get('user').id, from, to).all();
  return c.json(results);
});

app.get('/api/logs/:date', requireAuth, async (c) => {
  const date = c.req.param('date');
  if (!isValidDate(date)) throw fail('תאריך לא תקין');
  const row = await c.env.DB.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?')
    .bind(c.get('user').id, date).first();
  return c.json(row || null);
});

/** Upsert of the daily check-in. Re-submitting the same day adjusts XP instead of adding it again. */
app.put('/api/logs', requireAuth, async (c) => {
  const body = await c.req.json();
  const date = isValidDate(body.date) ? body.date : today(c);
  if (date > today(c)) throw fail('לא ניתן לדווח על תאריך עתידי');

  const entry = {
    calories_consumed: intInRange(body.calories_consumed, { min: 0, max: 20000, label: 'קלוריות' }),
    protein_consumed: intInRange(body.protein_consumed, { min: 0, max: 1000, label: 'חלבון' }),
    strength_workout_done: bool(body.strength_workout_done) ? 1 : 0,
  };

  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(c.get('user').id).first();
  const existing = await c.env.DB.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?')
    .bind(profile.id, date).first();
  const points = dailyLogPoints(entry, profile);

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE daily_logs
      SET calories_consumed = ?, protein_consumed = ?, strength_workout_done = ?, points_awarded = ?
      WHERE id = ?
    `).bind(entry.calories_consumed, entry.protein_consumed, entry.strength_workout_done, points, existing.id).run();
  } else {
    await c.env.DB.prepare(`
      INSERT INTO daily_logs (user_id, date, calories_consumed, protein_consumed, strength_workout_done, points_awarded)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(profile.id, date, entry.calories_consumed, entry.protein_consumed, entry.strength_workout_done, points).run();
  }

  const gained = await applyPointsDelta(c.env, profile.id, existing ? existing.points_awarded : 0, points);
  await refreshStreak(c.env, profile.id, today(c));
  const newBadges = await evaluateBadges(c.env, profile.id, today(c));

  return c.json({
    log: await c.env.DB.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?').bind(profile.id, date).first(),
    points_gained: gained,
    first_submission: !existing,
    workout_celebrated: !!entry.strength_workout_done && (!existing || !existing.strength_workout_done),
    new_badges: newBadges,
    profile: await profileState(c.env, profile.id),
  });
});

// ---------- Weekly weigh-ins ----------
app.get('/api/weigh-ins', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM weekly_weigh_ins WHERE user_id = ? ORDER BY date DESC'
  ).bind(c.get('user').id).all();
  return c.json(results);
});

async function savePhoto(env, dataUrl) {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw fail('פורמט התמונה אינו נתמך (PNG, JPG או WEBP בלבד)');
  const bytes = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
  if (bytes.length > 8 * 1024 * 1024) throw fail('התמונה גדולה מדי (עד 8MB)');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const key = `${crypto.randomUUID()}.${ext}`;
  await env.PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` },
  });
  return key;
}

/** One weigh-in per calendar week; sending another for the same week replaces it. */
app.post('/api/weigh-ins', requireAuth, async (c) => {
  const body = await c.req.json();
  const date = isValidDate(body.date) ? body.date : today(c);
  if (date > today(c)) throw fail('לא ניתן לדווח על תאריך עתידי');
  const weight = num(body.weight);
  if (!(weight > 20 && weight < 400)) throw fail('יש להזין משקל בין 20 ל-400 ק"ג');

  const waist = body.waist === undefined || body.waist === '' ? null : num(body.waist);
  if (waist !== null && !(waist > 30 && waist < 250)) throw fail('היקף המותניים חייב להיות בין 30 ל-250 ס"מ');

  const userId = c.get('user').id;
  const week = weekKey(date);
  const photo = body.photo ? await savePhoto(c.env, body.photo) : null;

  const existing = await c.env.DB.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? AND week = ?')
    .bind(userId, week).first();

  if (existing) {
    if (photo && existing.photo_url) await c.env.PHOTOS.delete(existing.photo_url);
    await c.env.DB.prepare(`
      UPDATE weekly_weigh_ins
      SET date = ?, weight = ?, waist = COALESCE(?, waist), photo_url = COALESCE(?, photo_url)
      WHERE id = ?
    `).bind(date, weight, waist, photo, existing.id).run();
  } else {
    await c.env.DB.prepare(`
      INSERT INTO weekly_weigh_ins (user_id, date, week, weight, waist, photo_url, points_awarded)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(userId, date, week, weight, waist, photo, XP.WEIGH_IN).run();
    await applyPointsDelta(c.env, userId, 0, XP.WEIGH_IN);
  }

  return c.json({
    weigh_in: await c.env.DB.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? AND week = ?')
      .bind(userId, week).first(),
    points_gained: existing ? 0 : XP.WEIGH_IN,
    new_badges: await evaluateBadges(c.env, userId, today(c)),
    profile: await profileState(c.env, userId),
  });
});

/** Progress photos are streamed from R2 and readable only by the person who uploaded them. */
app.get('/api/weigh-ins/:id/photo', requireAuth, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!row || !row.photo_url) throw fail('התמונה לא נמצאה', 404);
  if (row.user_id !== user.id) throw fail('אין הרשאה', 403);

  const object = await c.env.PHOTOS.get(row.photo_url);
  if (!object) throw fail('התמונה לא נמצאה', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// ---------- Badges ----------
app.get('/api/badges', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT b.*, ub.earned_at
    FROM badges b
    LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
    ORDER BY (ub.earned_at IS NULL), b.points_reward
  `).bind(c.get('user').id).all();
  return c.json(results);
});

// ---------- Stats ----------
async function clientStats(env, userId, todayDate) {
  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(userId).first();
  const from = shiftDate(todayDate, -29);

  const { results: logs } = await env.DB.prepare(
    'SELECT * FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date'
  ).bind(userId, from, todayDate).all();

  const { results: weighIns } = await env.DB.prepare(
    'SELECT * FROM weekly_weigh_ins WHERE user_id = ? ORDER BY date'
  ).bind(userId).all();

  const start = weekStart(todayDate);
  const workouts = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM daily_logs
    WHERE user_id = ? AND strength_workout_done = 1 AND date BETWEEN ? AND ?
  `).bind(userId, start, shiftDate(start, 6)).first();

  const totalWorkouts = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM daily_logs WHERE user_id = ? AND strength_workout_done = 1'
  ).bind(userId).first()).n;

  const proteinGoalDays = logs.filter(
    (l) => profile.daily_protein_goal > 0 && l.protein_consumed >= profile.daily_protein_goal
  ).length;

  const first = weighIns[0];
  const last = weighIns[weighIns.length - 1];
  const firstWaist = weighIns.find((w) => w.waist != null);
  const lastWaist = [...weighIns].reverse().find((w) => w.waist != null);

  return {
    today: todayDate,
    week_start: start,
    logs,
    weigh_ins: weighIns,
    workouts_this_week: workouts.n,
    total_workouts: totalWorkouts,
    weeks_in_program: weighIns.length,
    weekly_workouts_goal: profile.weekly_workouts_goal,
    protein_goal_days_30: proteinGoalDays,
    logged_days_30: logs.length,
    weight_start: first ? first.weight : null,
    weight_latest: last ? last.weight : null,
    weight_change: first && last ? Number((last.weight - first.weight).toFixed(1)) : null,
    waist_change: firstWaist && lastWaist && firstWaist.id !== lastWaist.id
      ? Number((lastWaist.waist - firstWaist.waist).toFixed(1)) : null,
  };
}

app.get('/api/stats', requireAuth, async (c) => c.json(await clientStats(c.env, c.get('user').id, today(c))));

// ---------- The group ----------
/**
 * Everyone using the app is in one group. Members see each other's headline
 * numbers only — never another member's daily logs, photos or email.
 */
async function memberSummary(env, row, todayDate) {
  const stats = await clientStats(env, row.id, todayDate);
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

app.get('/api/group', requireAuth, async (c) => {
  const todayDate = today(c);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM profiles WHERE active = 1 ORDER BY total_points DESC'
  ).all();
  const members = [];
  for (const row of results) members.push(await memberSummary(c.env, row, todayDate));

  // Only members who actually lost weight contribute to the group total.
  const lost = members.reduce((sum, m) => sum + (m.weight_change < 0 ? -m.weight_change : 0), 0);

  return c.json({
    total_kg_lost: Number(lost.toFixed(1)),
    member_count: members.length,
    workouts_this_week: members.reduce((sum, m) => sum + m.workouts_this_week, 0),
    longest_streak: members.reduce((max, m) => Math.max(max, m.current_streak), 0),
    members,
  });
});

// ---------- Articles ----------
app.get('/api/posts', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, slug, title, category, excerpt, read_minutes, published_at FROM posts ORDER BY published_at DESC, id'
  ).all();
  return c.json(results);
});

app.get('/api/posts/:slug', requireAuth, async (c) => {
  const post = await c.env.DB.prepare('SELECT * FROM posts WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!post) throw fail('המאמר לא נמצא', 404);
  return c.json(post);
});

app.all('/api/*', (c) => c.json({ error: 'המסלול לא נמצא' }, 404));

// Anything that is not /api/* is served from the static assets binding.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
