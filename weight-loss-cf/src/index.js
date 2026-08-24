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

const requireAdmin = async (c, next) => {
  const user = c.get('user');
  if (!user) throw fail('נדרשת התחברות', 401);
  if (user.role !== 'admin') throw fail('הפעולה מותרת למנהל בלבד', 403);
  await next();
};

/** Creates the bootstrap admin on first use; D1 has no startup hook to do it in. */
async function ensureAdmin(env) {
  const exists = await env.DB.prepare("SELECT 1 AS ok FROM profiles WHERE role = 'admin' LIMIT 1").first();
  if (exists) return;
  const email = (env.ADMIN_EMAIL || 'admin@easyweightloss.local').toLowerCase();
  const password = env.ADMIN_PASSWORD || 'admin1234';
  await env.DB.prepare("INSERT INTO profiles (email, password_hash, role, full_name) VALUES (?, ?, 'admin', ?)")
    .bind(email, await hashPassword(password), env.ADMIN_NAME || 'המאמן').run();
}

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
  await ensureAdmin(c.env);
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

  const userId = c.get('user').id;
  const week = weekKey(date);
  const photo = body.photo ? await savePhoto(c.env, body.photo) : null;

  const existing = await c.env.DB.prepare('SELECT * FROM weekly_weigh_ins WHERE user_id = ? AND week = ?')
    .bind(userId, week).first();

  if (existing) {
    if (photo && existing.photo_url) await c.env.PHOTOS.delete(existing.photo_url);
    await c.env.DB.prepare(
      'UPDATE weekly_weigh_ins SET date = ?, weight = ?, photo_url = COALESCE(?, photo_url) WHERE id = ?'
    ).bind(date, weight, photo, existing.id).run();
  } else {
    await c.env.DB.prepare(`
      INSERT INTO weekly_weigh_ins (user_id, date, week, weight, photo_url, points_awarded)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userId, date, week, weight, photo, XP.WEIGH_IN).run();
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

/** Progress photos are streamed from R2 so only their owner (or an admin) can read them. */
app.get('/api/weigh-ins/:id/photo', requireAuth, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!row || !row.photo_url) throw fail('התמונה לא נמצאה', 404);
  if (row.user_id !== user.id && user.role !== 'admin') throw fail('אין הרשאה', 403);

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

  const proteinGoalDays = logs.filter(
    (l) => profile.daily_protein_goal > 0 && l.protein_consumed >= profile.daily_protein_goal
  ).length;

  const first = weighIns[0];
  const last = weighIns[weighIns.length - 1];

  return {
    today: todayDate,
    week_start: start,
    logs,
    weigh_ins: weighIns,
    workouts_this_week: workouts.n,
    weekly_workouts_goal: profile.weekly_workouts_goal,
    protein_goal_days_30: proteinGoalDays,
    logged_days_30: logs.length,
    weight_start: first ? first.weight : null,
    weight_latest: last ? last.weight : null,
    weight_change: first && last ? Number((last.weight - first.weight).toFixed(1)) : null,
  };
}

app.get('/api/stats', requireAuth, async (c) => c.json(await clientStats(c.env, c.get('user').id, today(c))));

// ---------- Blog ----------
app.get('/api/posts', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.*, pr.full_name AS author_name
    FROM posts p LEFT JOIN profiles pr ON pr.id = p.author_id
    ORDER BY p.published_at DESC
  `).all();
  return c.json(results);
});

app.post('/api/posts', requireAdmin, async (c) => {
  const body = await c.req.json();
  const title = str(body.title);
  if (!title) throw fail('יש להזין כותרת');
  const info = await c.env.DB.prepare('INSERT INTO posts (title, content, author_id) VALUES (?, ?, ?)')
    .bind(title, str(body.content), c.get('user').id).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(info.meta.last_row_id).first());
});

app.put('/api/posts/:id', requireAdmin, async (c) => {
  const body = await c.req.json();
  const title = str(body.title);
  if (!title) throw fail('יש להזין כותרת');
  await c.env.DB.prepare('UPDATE posts SET title = ?, content = ? WHERE id = ?')
    .bind(title, str(body.content), c.req.param('id')).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(c.req.param('id')).first());
});

app.delete('/api/posts/:id', requireAdmin, async (c) => {
  await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- Admin ----------
app.get('/api/admin/clients', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(`
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
  const todayDate = today(c);
  return c.json(results.map((r) => ({
    ...r,
    logged_today: r.last_log_date === todayDate,
    level: levelInfo(r.total_points),
  })));
});

app.post('/api/admin/clients', requireAdmin, async (c) => {
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
  const info = await c.env.DB.prepare(`
    INSERT INTO profiles (email, password_hash, role, full_name,
                          daily_calories_goal, daily_protein_goal, weekly_workouts_goal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    email, await hashPassword(password), body.role === 'admin' ? 'admin' : 'client', fullName,
    intInRange(body.daily_calories_goal ?? 1800, { min: 500, max: 10000, label: 'יעד הקלוריות' }),
    intInRange(body.daily_protein_goal ?? 130, { min: 10, max: 500, label: 'יעד החלבון' }),
    intInRange(body.weekly_workouts_goal ?? 3, { min: 0, max: 14, label: 'יעד האימונים' })
  ).run();
  const row = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(info.meta.last_row_id).first();
  return c.json(publicProfile(row));
});

app.put('/api/admin/clients/:id', requireAdmin, async (c) => {
  const body = await c.req.json();
  const target = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(c.req.param('id')).first();
  if (!target) throw fail('המשתמש לא נמצא', 404);

  await c.env.DB.prepare(`
    UPDATE profiles
    SET full_name = ?, daily_calories_goal = ?, daily_protein_goal = ?, weekly_workouts_goal = ?, active = ?
    WHERE id = ?
  `).bind(
    str(body.full_name) || target.full_name,
    intInRange(body.daily_calories_goal ?? target.daily_calories_goal, { min: 500, max: 10000, label: 'יעד הקלוריות' }),
    intInRange(body.daily_protein_goal ?? target.daily_protein_goal, { min: 10, max: 500, label: 'יעד החלבון' }),
    intInRange(body.weekly_workouts_goal ?? target.weekly_workouts_goal, { min: 0, max: 14, label: 'יעד האימונים' }),
    body.active === undefined ? target.active : (bool(body.active) ? 1 : 0),
    target.id
  ).run();

  if (body.new_password) {
    if (String(body.new_password).length < 6) throw fail('הסיסמה חייבת להכיל לפחות 6 תווים');
    await c.env.DB.prepare('UPDATE profiles SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(String(body.new_password)), target.id).run();
  }

  // Goals changed, so previously unearned badges may now be within reach.
  await evaluateBadges(c.env, target.id, today(c));
  const row = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(target.id).first();
  return c.json(publicProfile(row));
});

app.delete('/api/admin/clients/:id', requireAdmin, async (c) => {
  if (Number(c.req.param('id')) === c.get('user').id) throw fail('לא ניתן למחוק את המשתמש שלך');
  // R2 objects are not covered by the foreign-key cascade, so clear them first.
  const { results } = await c.env.DB.prepare(
    'SELECT photo_url FROM weekly_weigh_ins WHERE user_id = ? AND photo_url IS NOT NULL'
  ).bind(c.req.param('id')).all();
  await Promise.all(results.map((r) => c.env.PHOTOS.delete(r.photo_url)));
  await c.env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

app.get('/api/admin/clients/:id', requireAdmin, async (c) => {
  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(c.req.param('id')).first();
  if (!profile) throw fail('המשתמש לא נמצא', 404);
  const { results: badges } = await c.env.DB.prepare(`
    SELECT b.*, ub.earned_at FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? ORDER BY ub.earned_at DESC
  `).bind(profile.id).all();
  return c.json({
    profile: { ...publicProfile(profile), level: levelInfo(profile.total_points) },
    stats: await clientStats(c.env, profile.id, today(c)),
    badges,
  });
});

app.put('/api/admin/weigh-ins/:id/feedback', requireAdmin, async (c) => {
  const body = await c.req.json();
  const row = await c.env.DB.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) throw fail('השקילה לא נמצאה', 404);
  await c.env.DB.prepare('UPDATE weekly_weigh_ins SET admin_feedback = ? WHERE id = ?')
    .bind(str(body.admin_feedback), row.id).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM weekly_weigh_ins WHERE id = ?').bind(row.id).first());
});

app.all('/api/*', (c) => c.json({ error: 'המסלול לא נמצא' }, 404));

// Anything that is not /api/* is served from the static assets binding.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
