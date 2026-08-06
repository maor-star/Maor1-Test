# 🤖 סוכן יומי אוטומטי (Adnimation API)

סוכן שרץ **עצמאית כל יום**, מתחבר ל-API של Adnimation, ומבצע פעולות של
**הזנה/עדכון נתונים** — בלי התערבות ידנית. כל ריצה נרשמת ב-DB כדי שתוכל לעקוב.

## מבנה

```
agent/
├── config.js            הגדרות + טעינת .env (ללא תלויות)
├── apiClient.js         לקוח HTTP: אימות, timeout, retry, מצב יבש
├── store.js             רישום כל ריצה בטבלת agent_runs (SQLite)
├── runOnce.js           נקודת כניסה לריצה בודדת ← זה מה ש-cron מפעיל
├── scheduler.js         מתזמן פנימי (חלופה ל-cron)
├── tasks/
│   └── dailySync.js     ★ הלוגיקה הספציפית — כאן ממלאים את ה-endpoints
└── .env.example         תבנית להגדרות (העתק ל-.env)
```

## התקנה מהירה

```bash
npm install
cp agent/.env.example agent/.env
# ערוך את agent/.env: הכנס API_TOKEN, ואמת את שיטת האימות
```

## הרצה ובדיקה

```bash
# ריצה יבשה — לא כותב כלום ל-API, רק מדפיס מה היה קורה (DRY_RUN=true ב-.env)
npm run agent

# ריצה אמיתית — קבע DRY_RUN=false ב-.env, ואז:
npm run agent
```

## מה צריך למלא

רק קובץ אחד: **`agent/tasks/dailySync.js`**. שם מסומנים ב-`TODO`:
1. הנתיב שממנו מושכים את הנתונים לעיבוד.
2. מיפוי השדות לגוף הבקשה (`buildPayload`).
3. נתיבי היצירה (POST) והעדכון (PUT).

הפרטים המדויקים נמצאים בתיעוד: <https://dashapi.xe.works/adnimation/client/docs/>
(לא הצלחתי לקרוא אותו מסביבת הפיתוח בגלל מדיניות רשת — יש להשלים לפי התיעוד).

## אימות (Authentication)

מוגדר ב-`.env`. שתי התצורות הנפוצות:

| סוג | `API_AUTH_HEADER` | `API_AUTH_SCHEME` | נשלח בפועל |
|-----|-------------------|-------------------|-----------|
| Bearer token | `Authorization` | `Bearer` | `Authorization: Bearer <token>` |
| API key | `X-API-Key` | *(ריק)* | `X-API-Key: <token>` |

## תזמון יומי — שתי דרכים

### א. systemd timer (מומלץ בשרת)
```bash
sudo cp deploy/agent.service deploy/agent.timer /etc/systemd/system/
sudo nano /etc/systemd/system/agent.service   # ערוך User והנתיבים
sudo systemctl daemon-reload
sudo systemctl enable --now agent.timer
```

### ב. cron
```cron
0 8 * * *  cd /opt/office-app && /usr/bin/node agent/runOnce.js >> agent.log 2>&1
```

### ג. מתזמן פנימי (בלי הרשאות מערכת)
```bash
npm run agent:scheduler   # תהליך שרץ ברציפות ומפעיל בשעה שב-DAILY_RUN_AT
```

## מעקב אחר ריצות

כל ריצה נשמרת בטבלה `agent_runs` (באותו `data/office.db`): מתי רצה, הצליחה/נכשלה,
כמה רשומות נוצרו/עודכנו, והודעת שגיאה אם הייתה.

## הוספת משימות נוספות

1. צור `agent/tasks/<שם>.js` שמייצא `name` ו-`run()`.
2. רשום אותו ב-`TASKS` שבתוך `agent/runOnce.js`.
3. הרץ: `node agent/runOnce.js <שם>`.
