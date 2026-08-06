// הגדרות הסוכן — נטענות ממשתני סביבה (.env או משתני מערכת).
// אין לשמור טוקנים אמיתיים בקוד. השתמש בקובץ .env (ראה agent/.env.example).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// טעינת agent/.env אם קיים (loader מינימלי, ללא תלות ב-dotenv).
// משתני סביבה שכבר הוגדרו במערכת גוברים על מה שבקובץ.
(function loadEnv() {
  try {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // אין קובץ .env — נסתמך על משתני סביבה של המערכת.
  }
})();

function optional(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : String(v).trim();
}

export const config = {
  // כתובת הבסיס של ה-API. ברירת מחדל: ה-API של Adnimation.
  baseUrl: optional('API_BASE_URL', 'https://dashapi.xe.works/adnimation/client'),

  // אימות: הטוקן/מפתח ה-API. חובה.
  // בזמן ריצה אמיתית הגדר API_TOKEN ב-.env.
  token: optional('API_TOKEN', ''),

  // שם ה-header לאימות ותבנית הערך.
  // אם ה-API משתמש ב-Bearer:   authHeader='Authorization', authScheme='Bearer'
  // אם ה-API משתמש ב-API key:  authHeader='X-API-Key',     authScheme='' (ערך = הטוקן בלבד)
  authHeader: optional('API_AUTH_HEADER', 'Authorization'),
  authScheme: optional('API_AUTH_SCHEME', 'Bearer'),

  // התנהגות בקשות
  timeoutMs: Number(optional('API_TIMEOUT_MS', '30000')),
  maxRetries: Number(optional('API_MAX_RETRIES', '3')),

  // מצב יבש: true = לא מבצע כתיבות אמיתיות, רק מדפיס מה היה קורה.
  // מומלץ להריץ פעם ראשונה עם DRY_RUN=true כדי לוודא שהכול תקין.
  dryRun: optional('DRY_RUN', 'false').toLowerCase() === 'true',

  // שעת ריצה יומית עבור המתזמן הפנימי (agent/scheduler.js), בפורמט 24 שעות "HH:MM".
  dailyRunAt: optional('DAILY_RUN_AT', '08:00'),
};

export function assertReadyForLiveRun() {
  if (!config.token && !config.dryRun) {
    throw new Error(
      'API_TOKEN לא הוגדר. הגדר טוקן ב-agent/.env, או הרץ עם DRY_RUN=true לבדיקה ללא כתיבה.'
    );
  }
}
