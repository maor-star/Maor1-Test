// נקודת כניסה: הרצה בודדת של המשימה היומית.
// זה מה ש-cron / systemd-timer מפעיל פעם ביום.
//
//   node agent/runOnce.js            # מריץ את משימת ברירת המחדל (dailySync)
//   node agent/runOnce.js dailySync  # מריץ משימה לפי שם
//
// יוצא עם קוד 0 בהצלחה, 1 בכישלון — כדי ש-cron/systemd יזהו כשל.

import { config, assertReadyForLiveRun } from './config.js';
import { startRun, finishRun } from './store.js';

const TASKS = {
  dailySync: () => import('./tasks/dailySync.js'),
  // הוסף כאן משימות נוספות: reportName: () => import('./tasks/reportName.js'),
};

async function main() {
  const taskName = process.argv[2] || 'dailySync';
  const loader = TASKS[taskName];
  if (!loader) {
    console.error(`משימה לא מוכרת: "${taskName}". זמינות: ${Object.keys(TASKS).join(', ')}`);
    process.exit(1);
  }

  assertReadyForLiveRun();
  const task = await loader();
  const runId = startRun(taskName, config.dryRun);

  console.log(`▶ מריץ משימה "${taskName}"${config.dryRun ? ' [DRY_RUN]' : ''} — ${new Date().toISOString()}`);
  try {
    const result = await task.run();
    finishRun(runId, { status: 'success', ...result });
    console.log(`✔ ${result.message || 'הסתיים בהצלחה.'}`);
    process.exit(0);
  } catch (err) {
    finishRun(runId, { status: 'error', message: err.message });
    console.error(`✖ המשימה נכשלה: ${err.message}`);
    process.exit(1);
  }
}

main();
