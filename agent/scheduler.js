// מתזמן פנימי — תהליך שרץ ברקע ומפעיל את המשימה היומית בשעה קבועה.
// חלופה ל-cron של מערכת ההפעלה. שימושי אם אין לך גישה ל-crontab/systemd.
//
//   node agent/scheduler.js
//
// השעה נקבעת ע"י DAILY_RUN_AT ב-.env (ברירת מחדל 08:00, לפי שעון השרת).
// התהליך צריך לרוץ ברציפות (למשל תחת systemd/pm2/screen).

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_ONCE = join(__dirname, 'runOnce.js');

function msUntilNext(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function runTask() {
  console.log(`⏰ מפעיל את המשימה היומית — ${new Date().toISOString()}`);
  const child = spawn(process.execPath, [RUN_ONCE], { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`המשימה הסתיימה עם קוד ${code}.`);
  });
}

function scheduleNext() {
  const delay = msUntilNext(config.dailyRunAt);
  const when = new Date(Date.now() + delay);
  console.log(`⌛ הריצה הבאה מתוזמנת ל-${when.toLocaleString('he-IL')} (בעוד ${Math.round(delay / 60000)} דקות).`);
  setTimeout(() => {
    runTask();
    scheduleNext(); // תזמון ליום הבא
  }, delay);
}

console.log(`הסוכן פועל. שעת ריצה יומית: ${config.dailyRunAt}. לחץ Ctrl+C לעצירה.`);
scheduleNext();
