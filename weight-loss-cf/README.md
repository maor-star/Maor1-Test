# ☁️ הדרך הקלה לרדת במשקל — גרסת Cloudflare

פורט של האפליקציה מ-[`../weight-loss`](../weight-loss/README.md) ל-Cloudflare Workers.
אותה אפליקציה בדיוק מבחינת המשתמש — אותו פרונטאנד, אותם כללי גיימיפיקציה, אותן הרשאות — אבל רצה על תשתית הקצה של Cloudflare במקום על שרת.

## למה נדרש פורט ולא רק "העלאה"

גרסת ה-Node לא יכולה לרוץ על Workers, ולא בגלל הגדרות:

| בגרסת Node | למה זה נופל ב-Workers | מה בא במקום |
| --- | --- | --- |
| `better-sqlite3` | מודול נייטיב — Workers מריץ V8 isolates ללא מודולים נייטיביים | **D1** (SQLite מנוהל) |
| `writeFileSync` לתמונות | אין מערכת קבצים | **R2** (אחסון אובייקטים) |
| `crypto.scryptSync` | לא קיים ב-runtime | **PBKDF2-SHA256** דרך WebCrypto |
| `express` + `res.sendFile` | אין שרת HTTP של Node ואין קבצים | **Hono** + הזרמה מ-R2 |

## הבדלים מגרסת ה-Node

- **סיסמאות:** PBKDF2-SHA256 עם 100,000 סבבים במקום scrypt. שתי הגרסאות אינן חולקות מסד נתונים — האשים בפורמט שונה (`pbkdf2$...`), ומשתמש שנוצר בגרסה אחת לא יוכל להתחבר בשנייה.
- **טרנזקציות:** ל-D1 אין טרנזקציות אינטראקטיביות, כך שרצף קרא-אז-כתוב בדיווח היומי אינו אטומי. בפועל כל משתמש כותב רק לשורות של עצמו, כך שאין תרחיש התנגשות מעשי.
- **משתמש המנהל הראשוני** נוצר בניסיון ההתחברות הראשון (ל-Workers אין hook של עלייה), ולא בהרצת השרת.
- **הפרונטאנד** הוא עותק מ-`../weight-loss/public`. `npm run deploy` מסנכרן אותו אוטומטית לפני כל פריסה, כך שאין סטייה בין הגרסאות. לעדכון ידני: `npm run sync:public`.

## פריסה

דרוש חשבון Cloudflare. שלב 3 ומעלה מחייבים הרשאות על החשבון.

```bash
# 1. התקנה
npm install

# 2. התחברות לחשבון Cloudflare
npx wrangler login          # או: export CLOUDFLARE_API_TOKEN=...

# 3. יצירת מסד הנתונים — הפקודה מדפיסה database_id
npx wrangler d1 create easy-weight-loss
#    יש להעתיק את ה-database_id שהתקבל אל wrangler.toml

# 4. יצירת דלי התמונות
npx wrangler r2 bucket create easy-weight-loss-photos

# 5. הרצת המיגרציות על מסד הנתונים המרוחק
npm run db:remote

# 6. הגדרת הסודות
npx wrangler secret put SESSION_SECRET     # מחרוזת אקראית ארוכה
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD

# 7. פריסה
npm run deploy
```

בסיום מתקבלת כתובת `https://easy-weight-loss.<שם-החשבון>.workers.dev` — עם HTTPS, בלי שרת לתחזק.

לחיבור דומיין משלך: Workers & Pages → easy-weight-loss → Settings → Domains & Routes.

## הרצה מקומית

לא נדרש חשבון Cloudflare — D1 ו-R2 מדומים מקומית:

```bash
npm install
npm run db:local
npm run dev
```

→ <http://127.0.0.1:8787>, התחברות ראשונית: `admin@easyweightloss.local` / `admin1234`

## סודות ומשתני סביבה

| שם | איפה מוגדר | תיאור |
| --- | --- | --- |
| `SESSION_SECRET` | `wrangler secret put` | חותם על עוגיית ההתחברות. **חובה בייצור** — בלעדיו נעשה שימוש בסוד פיתוח ידוע |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `wrangler secret put` | פרטי המנהל הראשוני, נוצר בהתחברות הראשונה בלבד |
| `APP_TZ` | `wrangler.toml` | אזור הזמן שלפיו נקבע "היום" לרצפים ולדיווחים |

## מבנה

```
├── wrangler.toml           הגדרות ה-Worker וה-bindings (D1, R2, assets)
├── migrations/             מיגרציות D1 (כולל זריעת התגים)
├── src/
│   ├── index.js            אפליקציית Hono — כל מסלולי ה-API
│   ├── auth.js             PBKDF2, עוגיית סשן חתומה ב-HMAC, בדיקת הרשאות
│   └── gamification.js     XP, רצפים, רמות ותגים מול D1
└── public/                 עותק מסונכרן של הפרונטאנד המשותף
```

## מה נבדק

הגרסה הזו נבדקה מקצה לקצה מול D1 ו-R2 מקומיים, והתוצאות זהות לגרסת ה-Node:
חשבונאות ה-XP (‎+80 / ‎+0 בדיווח חוזר / ‎−50 / ‎−20 / ‎+70), רצף של 14 יום, שלושת התגים,
שמירה ושליפה של תמונה מ-R2, וכל בדיקות ההרשאות (לקוח אחר 403, אנונימי 401, עוגייה מזויפת נדחית, השבתת חשבון מנתקת סשן קיים).
