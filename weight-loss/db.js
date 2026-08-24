import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, 'data', 'weightloss.db');

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(join(dirname(dbPath), 'uploads'), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    email                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash        TEXT    NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'client' CHECK (role IN ('admin','client')),
    full_name            TEXT    NOT NULL DEFAULT '',
    daily_calories_goal  INTEGER NOT NULL DEFAULT 1800,
    daily_protein_goal   INTEGER NOT NULL DEFAULT 130,
    weekly_workouts_goal INTEGER NOT NULL DEFAULT 3,
    total_points         INTEGER NOT NULL DEFAULT 0,
    current_streak       INTEGER NOT NULL DEFAULT 0,
    active               INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_logs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id               INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    date                  TEXT    NOT NULL,
    calories_consumed     INTEGER NOT NULL DEFAULT 0,
    protein_consumed      INTEGER NOT NULL DEFAULT 0,
    strength_workout_done INTEGER NOT NULL DEFAULT 0,
    points_awarded        INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, date)
  );

  CREATE TABLE IF NOT EXISTS weekly_weigh_ins (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    date           TEXT    NOT NULL,
    week           TEXT    NOT NULL,
    weight         REAL    NOT NULL,
    waist          REAL,
    photo_url      TEXT,
    admin_feedback TEXT,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, week)
  );

  CREATE TABLE IF NOT EXISTS badges (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    key           TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    icon_name     TEXT    NOT NULL DEFAULT 'award',
    points_reward INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_badges (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id  INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, badge_id)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT    UNIQUE,
    title         TEXT    NOT NULL,
    category      TEXT    NOT NULL DEFAULT '',
    excerpt       TEXT    NOT NULL DEFAULT '',
    content       TEXT    NOT NULL DEFAULT '',
    read_minutes  INTEGER NOT NULL DEFAULT 5,
    published_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_logs_user_date  ON daily_logs(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_weigh_user_date ON weekly_weigh_ins(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_userbadge_user  ON user_badges(user_id);
  CREATE INDEX IF NOT EXISTS idx_posts_date      ON posts(published_at DESC);
`);

/** Adds a column to an existing database that predates it. */
function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('weekly_weigh_ins', 'waist', 'REAL');
addColumn('posts', 'slug', 'TEXT');
addColumn('posts', 'category', "TEXT NOT NULL DEFAULT ''");
addColumn('posts', 'excerpt', "TEXT NOT NULL DEFAULT ''");
addColumn('posts', 'read_minutes', 'INTEGER NOT NULL DEFAULT 5');

// ---- Seed the master list of badges ----
export const BADGE_SEED = [
  {
    key: 'iron_champion',
    name: 'אלוף הברזל',
    description: 'השלמת את כל אימוני הכוח שתוכננו לשבוע',
    icon_name: 'dumbbell',
    points_reward: 150,
  },
  {
    key: 'protein_master',
    name: 'מאסטר חלבון',
    description: 'עמדת ביעד החלבון 7 ימים ברציפות',
    icon_name: 'drumstick',
    points_reward: 200,
  },
  {
    key: 'iron_consistency',
    name: 'התמדה של ברזל',
    description: 'רצף דיווח יומי של 14 יום',
    icon_name: 'flame',
    points_reward: 300,
  },
];

const upsertBadge = db.prepare(`
  INSERT INTO badges (key, name, description, icon_name, points_reward)
  VALUES (@key, @name, @description, @icon_name, @points_reward)
  ON CONFLICT (key) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    icon_name = excluded.icon_name,
    points_reward = excluded.points_reward
`);
db.transaction((rows) => rows.forEach((r) => upsertBadge.run(r)))(BADGE_SEED);


// ---- Seed the articles ----
// Without a coach area there is no editor UI, so the library ships with the app.
export const POST_SEED = [
  {
    slug: 'protein-150',
    title: 'איך מגיעים ל-150 גרם חלבון ביום בלי לחשוב על זה',
    category: 'תזונה',
    excerpt: 'ארבע ארוחות, מקור חלבון בכל אחת, ורשימת קניות אחת שחוזרת כל שבוע.',
    read_minutes: 6,
    content: `רוב האנשים שמפספסים את יעד החלבון לא מפספסים אותו בגלל חוסר מוטיבציה. הם מפספסים אותו כי הם מחליטים מה לאכול ברגע שהם כבר רעבים.

הפתרון הוא לא משמעת. הוא מבנה.

**ארבע ארוחות, מקור חלבון בכל אחת**

חלקו את היעד היומי לארבע. ביעד של 150 גרם, זה כ-38 גרם לארוחה — מנה אחת של בשר, דג, יוגורט יווני או קטניות עם גבינה. ברגע שכל ארוחה נבנית סביב מקור חלבון אחד, החישוב מפסיק להיות משימה.

**החלבון ראשון בצלחת**

התחילו כל ארוחה מהחלבון, לפני הפחמימה והסלט. זה נשמע טריוויאלי, אבל בפועל זה מה שקובע אם תגיעו ליעד: אם החלבון נאכל אחרון, הוא נאכל חלקית.

**רשימת קניות אחת שחוזרת**

אל תמציאו את הרשימה מחדש כל שבוע. שבע-שמונה מוצרים קבועים — ביצים, יוגורט יווני, חזה עוף, טונה, גבינת קוטג׳, עדשים, טופו — מכסים כמעט כל תפריט. מה שנמצא בבית נאכל.

**מה עושים כשמפספסים**

יום אחד מתחת ליעד לא משנה כלום. שלושה ימים בשבוע כן. אם זה קורה באופן קבוע, סימן שהיעד עצמו גבוה מדי ביחס לאורח החיים — עדיף להוריד אותו לרמה שאפשר לעמוד בה ברציפות מאשר לפספס יעד שאפתני.`,
  },
  {
    slug: 'three-workouts',
    title: 'שלושה אימוני כוח בשבוע: התוכנית המינימלית שעובדת',
    category: 'אימונים',
    excerpt: 'תרגילים מורכבים, טווח חזרות אחד, והעלאה הדרגתית של המשקל. בלי יותר מזה.',
    read_minutes: 8,
    content: `אפשר להתווכח על הרבה דברים בתחום, אבל לא על זה: בלי גירוי כוח, ירידה בקלוריות גורמת לאיבוד שריר יחד עם השומן.

שלושה אימונים שבועיים מספיקים כדי לשמר, ולעיתים קרובות גם להוסיף, מסת שריר. לא צריך שעתיים.

**תרגילים מורכבים בלבד**

סקוואט, דדליפט, לחיצת חזה, לחיצת כתפיים, משיכה. חמישה דפוסי תנועה שמכסים את כל הגוף. תרגילי בידוד הם תוספת, לא בסיס — אם הזמן מוגבל, הם הראשונים לרדת.

**טווח חזרות אחד, וזהו**

6 עד 10 חזרות, שלוש סדרות לתרגיל. אין צורך לגוון בין טווחים בשלב הזה. פשטות מאפשרת לעקוב אחרי התקדמות.

**העלאה הדרגתית — זה כל הסוד**

אם המשקל שאתם מרימים היום זהה למשקל שהרמתם לפני שלושה חודשים, הגוף לא קיבל שום סיבה להשתנות. הוסיפו 2.5 ק״ג כשאתם משלימים את כל הסדרות בטווח העליון. זה קצב איטי, והוא בדיוק הנכון.

**45 דקות**

חימום קצר, חמישה תרגילים, דקה וחצי מנוחה בין סדרות. מי שמאריך מעבר לזה בדרך כלל מוסיף נפח שלא תורם, על חשבון ההתמדה לאורך זמן.

**למה שלושה ולא חמישה**

כי שלושה קורים בפועל. תוכנית של חמישה אימונים שמתקיימת חודשיים ונשברת שווה פחות משלושה אימונים שנמשכים שנה.`,
  },
  {
    slug: 'after-a-miss',
    title: 'מה עושים אחרי יום שבו לא עמדת ביעד',
    category: 'מנטלי',
    excerpt: 'הרצף נשבר, התהליך לא. איך חוזרים למחרת בבוקר בלי לפצות ובלי להיעלם לשבוע.',
    read_minutes: 4,
    content: `הרצף נשבר. זה יקרה, ולא פעם אחת.

השאלה היחידה שמשנה היא מה קורה למחרת בבוקר.

**אל תפצו**

הטעות הנפוצה היא לקצץ קלוריות ביום שאחרי כדי "לאזן". זה כמעט תמיד מוביל לרעב, לאכילה גדולה בערב, ולמעגל שנמשך שבוע. יום אחד מעל היעד הוא רעש סטטיסטי. שבוע של פיצויים הוא כבר מגמה.

**חזרו בדיוק לאותה תוכנית**

אותם יעדים, אותן ארוחות, אותו אימון. שום דבר לא צריך להשתנות בגלל יום אחד.

**דווחו גם על היום שפספסתם**

זה נשמע מיותר, אבל זו הנקודה החשובה ביותר. המערכת נותנת נקודות על הדיווח עצמו, לא רק על העמידה ביעד — כי מה שמנבא הצלחה לאורך זמן הוא ההתמדה במעקב, לא השלמות בביצוע.

**מתי כן צריך לשנות משהו**

אם הפספוסים חוזרים על עצמם שלוש פעמים בשבוע, זו כבר לא תקלה — זה סימן שהיעד לא מתאים לשלב הנוכחי. עדיף יעד צנוע יותר שאפשר לעמוד בו, מאשר יעד נכון על הנייר שנשבר כל שבוע.`,
  },
];

const upsertPost = db.prepare(`
  INSERT INTO posts (slug, title, category, excerpt, content, read_minutes)
  VALUES (@slug, @title, @category, @excerpt, @content, @read_minutes)
  ON CONFLICT (slug) DO UPDATE SET
    title = excluded.title,
    category = excluded.category,
    excerpt = excluded.excerpt,
    content = excluded.content,
    read_minutes = excluded.read_minutes
`);
db.transaction((rows) => rows.forEach((r) => upsertPost.run(r)))(POST_SEED);

export default db;
