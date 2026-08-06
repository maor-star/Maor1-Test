// לקוח HTTP לסוכן — עוטף את ה-API החיצוני עם אימות, timeout, ו-retry.
// משתמש ב-fetch המובנה (Node 18+), בלי תלויות נוספות.

import { config } from './config.js';

function authHeaders() {
  if (!config.token) return {};
  const value = config.authScheme
    ? `${config.authScheme} ${config.token}`
    : config.token;
  return { [config.authHeader]: value };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * בקשה גנרית ל-API עם retry על שגיאות רשת/שרת זמניות.
 * @param {string} path - הנתיב היחסי (למשל '/reports') או URL מלא.
 * @param {object} opts - { method, query, body, headers }
 * @returns {Promise<{status:number, ok:boolean, data:any}>}
 */
export async function apiRequest(path, opts = {}) {
  const { method = 'GET', query, body, headers = {} } = opts;

  const url = new URL(
    path.startsWith('http') ? path : config.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '')
  );
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());

  // מצב יבש: לא מבצעים כתיבות בפועל.
  if (isWrite && config.dryRun) {
    console.log(`[DRY_RUN] ${method} ${url}  body=${body ? JSON.stringify(body) : '∅'}`);
    return { status: 0, ok: true, data: { dryRun: true } };
  }

  const finalHeaders = {
    Accept: 'application/json',
    ...authHeaders(),
    ...headers,
  };
  let payload;
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let lastErr;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: finalHeaders,
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      // 5xx או 429 → ננסה שוב (backoff מעריכי).
      if ((res.status >= 500 || res.status === 429) && attempt < config.maxRetries) {
        const wait = 1000 * Math.pow(2, attempt);
        console.warn(`בקשה נכשלה (${res.status}) ל-${method} ${url}. ניסיון חוזר בעוד ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const msg = typeof data === 'object' ? JSON.stringify(data) : String(data);
        throw new Error(`API ${res.status} ל-${method} ${url}: ${msg}`);
      }
      return { status: res.status, ok: true, data };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const retryable = err.name === 'AbortError' || err.code === 'ECONNRESET' || /network|fetch failed/i.test(err.message);
      if (retryable && attempt < config.maxRetries) {
        const wait = 1000 * Math.pow(2, attempt);
        console.warn(`שגיאת רשת ל-${method} ${url}: ${err.message}. ניסיון חוזר בעוד ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// קיצורים נוחים
export const api = {
  get: (path, query, headers) => apiRequest(path, { method: 'GET', query, headers }),
  post: (path, body, headers) => apiRequest(path, { method: 'POST', body, headers }),
  put: (path, body, headers) => apiRequest(path, { method: 'PUT', body, headers }),
  patch: (path, body, headers) => apiRequest(path, { method: 'PATCH', body, headers }),
  del: (path, headers) => apiRequest(path, { method: 'DELETE', headers }),
};
