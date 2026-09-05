'use strict';
// מריץ את ה-JavaScript של האפליקציה עצמה (web/index.html) בתוך Node עם DOM מדומה —
// כך השרת משתמש באותה לוגיקה בדיוק כמו הדפדפן (ייבוא, סינון כפילויות, סיווג, תזרים, דוח שבועי),
// בלי לשכפל קוד: מקור אמת אחד.
const vm = require('vm');

function createRuntime(html) {
  const js = [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  if (!js) throw new Error('index.html ללא <script>');
  const noop = () => {};
  const mkEl = () => ({
    style: {}, dataset: {}, children: [], childNodes: [], innerHTML: '', textContent: '', value: '', checked: false, hidden: false, disabled: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    appendChild: (x) => x, append: noop, prepend: noop, remove: noop, insertBefore: (x) => x, insertAdjacentHTML: noop,
    querySelector: () => mkEl(), querySelectorAll: () => [], closest: () => null, focus: noop, blur: noop, click: noop, scrollIntoView: noop,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  });
  const store = {};
  const storage = { getItem: (k) => (store[k] === undefined ? null : store[k]), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, clear: noop };
  const document = {
    getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [], createElement: () => mkEl(), createTextNode: () => mkEl(),
    addEventListener: noop, removeEventListener: noop, body: mkEl(), documentElement: mkEl(), head: mkEl(), hidden: false, visibilityState: 'visible', activeElement: null, title: '',
  };
  const sb = {
    console, document, localStorage: storage, sessionStorage: storage,
    setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop, requestAnimationFrame: () => 0, queueMicrotask,
    fetch: async () => { throw new Error('no network in headless mode'); },
    navigator: { userAgent: 'node-headless', onLine: true, language: 'he' },
    location: { hash: '', href: '', search: '', origin: 'null', pathname: '/', reload: noop },
    history: { replaceState: noop, pushState: noop },
    URL, URLSearchParams, TextEncoder, TextDecoder, Blob: class {}, FileReader: class {}, FormData: class {},
    crypto: require('crypto').webcrypto, Intl, structuredClone, performance,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }), alert: noop, confirm: () => true, prompt: () => null,
    MutationObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    CustomEvent: class {}, Event: class {}, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, scrollTo: noop,
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    __io: null,
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(js, ctx, { filename: 'app.js' });
  return {
    ctx,
    // מריץ קוד בתוך האפליקציה. __io זמין לקוד כקלט/פלט (כדי לא להדביק JSON גדול לתוך המחרוזת)
    run(code, io) { sb.__io = io === undefined ? null : io; return vm.runInContext(code, ctx, { filename: 'run.js' }); },
  };
}

module.exports = { createRuntime };
