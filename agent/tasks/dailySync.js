// ==========================================================================
//  המשימה היומית של הסוכן: הזנה/עדכון נתונים מול ה-API של Adnimation.
// ==========================================================================
//  זהו הקובץ היחיד שצריך להתאים ל-API הספציפי שלך.
//  שאר הקבצים (apiClient, scheduler, store) גנריים ולא דורשים שינוי.
//
//  התבנית הסטנדרטית של "הזן/עדכן כל יום":
//    1. קרא נתונים (מה-API או ממקור אחר)
//    2. לכל פריט — החלט אם ליצור חדש (POST) או לעדכן קיים (PUT/PATCH)
//    3. בצע את הפעולה, ספור הצלחות/כשלונות, החזר סיכום
//
//  מלא את הנתיבים (paths) האמיתיים במקומות המסומנים ב-TODO,
//  לפי התיעוד: https://dashapi.xe.works/adnimation/client/docs/
// ==========================================================================

import { api } from '../apiClient.js';

export const name = 'dailySync';

export async function run() {
  let processed = 0;
  let created = 0;
  let updated = 0;

  // ----------------------------------------------------------------------
  // שלב 1 — קריאת הנתונים לעיבוד.
  // TODO: החלף '/items' בנתיב האמיתי שממנו מושכים את הרשומות לעיבוד.
  //       אפשר להוסיף פרמטרים ב-query (למשל טווח תאריכים של אתמול).
  // ----------------------------------------------------------------------
  const yesterday = isoDate(-1);
  const { data: items } = await api.get('/items', { date: yesterday });
  const list = Array.isArray(items) ? items : items?.results ?? [];

  // ----------------------------------------------------------------------
  // שלב 2+3 — לכל פריט: יצירה או עדכון.
  // TODO: התאם את השדות ואת הנתיבים לפי הסכמה של ה-API שלך.
  // ----------------------------------------------------------------------
  for (const item of list) {
    processed++;

    const payload = buildPayload(item); // TODO: מיפוי השדות שה-API מצפה להם

    if (item.id) {
      // קיים → עדכון
      await api.put(`/items/${item.id}`, payload);
      updated++;
    } else {
      // חדש → יצירה
      await api.post('/items', payload);
      created++;
    }
  }

  const message = `עובדו ${processed} פריטים: נוצרו ${created}, עודכנו ${updated}.`;
  return { processed, created, updated, message, details: { date: yesterday } };
}

// מיפוי פריט מקור → גוף הבקשה של ה-API.
// TODO: התאם לשדות האמיתיים.
function buildPayload(item) {
  return {
    // example_field: item.some_source_field,
    ...item,
  };
}

// תאריך ISO (YYYY-MM-DD) עם היסט ימים אופציונלי.
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
