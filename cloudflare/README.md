# פריסה ל-Cloudflare Workers + D1

גרסת האפליקציה שרצה על Cloudflare. אין שרת לתחזק, אין SSH, אין תשלום חודשי,
ו-HTTPS מגיע מובנה.

> **נבדק מקומית — 29 בדיקות עוברות.** הרצתי את כל 15 הנתיבים מול D1 אמיתי
> (מקומי) והכול עובר. מה שלא נבדק זו הפריסה עצמה, כי אין כאן חשבון Cloudflare.

## למה זו הסבה ולא העלאה

Workers לא מריץ Node רגיל. שלושה דברים היו חייבים להשתנות:

| `server.js` / `db.js` | `cloudflare/src/index.js` |
|---|---|
| `better-sqlite3` — מודול C++ נייטיב | D1, ה-SQLite המנוהל של Cloudflare |
| קריאות סינכרוניות לבסיס הנתונים | הכול `async` |
| Express + `app.listen` | Hono על fetch handler |

**הסכימה עברה ללא שינוי אחד** — D1 הוא SQLite אמיתי. `schema.sql` זהה למה
שב-`db.js`, כולל האינדקסים וה-`ON DELETE CASCADE`.

`public/` משותף — הקוד כאן מגיש את אותה תיקייה, בלי עותק כפול.

## שני הבדלים מהמקור, בכוונה

**1. אימות.** לאפליקציה המקורית אין שום מנגנון הרשאות — 15 הנתיבים פתוחים
לגמרי. כאן יש אימות בסיסי, והוא חל גם על הדפים הסטטיים ולא רק על ה-API
(`run_worker_first: true`). בלי `APP_USER` ו-`APP_PASSWORD` מוגדרים,
האפליקציה מחזירה 500 ולא מגישה כלום — נכשלת סגור, לא פתוח.

**2. שאילתת המגמה בדשבורד.** המקור בנה את רשימת ששת החודשים בתוך SQL עם
שרשרת `UNION`. ל-D1 יש תקרה נמוכה יותר על `compound SELECT` והשאילתה נכשלת שם
עם `too many terms in compound SELECT`. החודשים מחושבים עכשיו בקוד, ושתי
שאילתות מצטברות מחליפות את שתים-עשרה תת-השאילתות. התוצאה זהה.

## פריסה

### 1. התחברות

```bash
cd cloudflare
npm install
npx wrangler login
```

בסביבה בלי דפדפן, במקום `login`:

```bash
export CLOUDFLARE_API_TOKEN='...'   # Workers + D1 edit
export CLOUDFLARE_ACCOUNT_ID='...'
```

### 2. בסיס הנתונים

```bash
npm run db:create
```

הפקודה מדפיסה `database_id`. **העתק אותו ל-`wrangler.jsonc`** במקום
`REPLACE_AFTER_db:create`. אחר כך:

```bash
npm run db:init
```

### 3. סיסמה

```bash
npx wrangler secret put APP_USER
npx wrangler secret put APP_PASSWORD
```

### 4. פריסה

```bash
npm run deploy
```

בסוף מודפסת הכתובת: `https://office-app.<subdomain>.workers.dev`

## בדיקה מקומית

```bash
cd cloudflare
printf 'APP_USER = "office"\nAPP_PASSWORD = "test-local-pw"\n' > .dev.vars
npm run db:init:local
npm run dev
```

ובחלון שני:

```bash
bash test.sh
```

29 בדיקות: אימות, כל נתיבי ה-CRUD, פילטרים לפי חודש, חישוב עלות שכר,
סכומי הדשבורד, הגשת קבצים סטטיים, ומחיקה מדורגת. הן מניחות בסיס נתונים ריק —
לאיפוס:

```bash
npx wrangler d1 execute office-app-db --local \
  --command "DELETE FROM time_entries; DELETE FROM employees; DELETE FROM expenses; DELETE FROM income;"
```

## עלות

Workers ו-D1 ב-Free Tier: 100,000 בקשות ליום ו-5GB אחסון. אפליקציית משרד
פנימית לא מתקרבת לזה. **בפועל: אפס.**

## מה זה לא פותר

- **סיסמה אחת משותפת.** אין משתמשים נפרדים ואין לדעת מי עשה מה.
- **אין הרשאות.** כל מי שנכנס רואה ועורך הכול.
- **גיבוי.** D1 מגובה על ידי Cloudflare, אבל ייצוא משלך עדיף:
  `npx wrangler d1 export office-app-db --remote --output backup.sql`

## היחס ל-`deploy/aws/`

שתי דרכים חלופיות לאותה אפליקציה. `deploy/aws/` מריץ את `server.js` המקורי
כמו שהוא על EC2, בערך $10 לחודש, עם שרת לתחזק. התיקייה הזאת לא נוגעת בקוד
המקורי — הוא ממשיך לרוץ מקומית ב-`npm start` בדיוק כמו קודם.
