/**
 * The group's assistant, answering from the site's own articles.
 *
 * The knowledge has a deliberate order, not a gate. Maor's articles and his creed come
 * first and outrank everything, but the model's own knowledge of Peter Attia and the
 * longevity literature is open to it at all times, not held back until the articles run
 * out: a rule from an article without the mechanism behind it is half an answer. Web
 * search is the third source, for a figure or a study worth verifying.
 * Everything else is out: keto, carnivore, detox, cleanses and supplement-led fixes are
 * named in the prompt so the model has a list to refuse against rather than a vibe.
 *
 * Nothing about a member is ever sent; the model sees published articles and the
 * question, and no weigh-in, message or name.
 */
import db from './db.js';

const MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash';
const MAX_MESSAGE = 800;
const MAX_TURNS = 12;

/**
 * Maor's creed and the article titles are read from the database rather than copied
 * into this file, so a slogan he adds or an article he publishes is part of the bot's
 * source on the next question. The read is cheap but it happens per question, so the
 * result is held briefly.
 */
const CACHE_MS = 60_000;
let cached = { at: 0, text: '' };

function knowledge() {
  if (Date.now() - cached.at < CACHE_MS) return cached.text;

  const creed = db.prepare(
    "SELECT text FROM tips WHERE kind = 'slogan' ORDER BY position"
  ).all().map((t) => t.text);
  const titles = db.prepare('SELECT title FROM posts ORDER BY id').all().map((p) => p.title);

  const text = [
    creed.length ? `האני מאמין של מאור, במילים שלו:\n${creed.join('\n')}` : '',
    titles.length
      ? `המאמרים שקיימים באתר. זו מפה כדי שתדע מה יש, לא תוכן.\nמותר לך להפנות למאמר בשמו המדויק, אבל אל תתאר מה כתוב בו אלא אם קטע ממנו מצורף לשאלה.\n${titles.join(' | ')}`
      : '',
  ].filter(Boolean).join('\n\n');

  cached = { at: Date.now(), text };
  return text;
}

const PERSONA = () => `אתה העוזר של קבוצת "הדרך הקלה לירידה במשקל" של מאור דוידוביץ.
הקבוצה היא חברים ואנשי עסקים שהתאגדו לרדת אחוזי שומן ולהעלות מסת שריר.
התוכנית: שלושה יעדים יומיים (קלוריות, חלבון, אימון כוח) ושקילה אחת בשבוע, כל יום שלישי בבוקר, במשך שלושה חודשים.

שלושת מקורות הידע שלך
יש לך שלושה מקורות, וכולם פתוחים לך. הם לא שלבים שצריך למצות אחד לפני השני, הם סדר עדיפויות כשיש ביניהם מתח.

ראשון, המאמרים של מאור והאני מאמין שלו. זה הבית. כשיש להם כיסוי, פתח מהם והזכר את שם המאמר.
שני, כל מה שאתה יודע על פיטר אטיה ועל רפואת אריכות ימים מתוך הידע שלך עצמך. הספר Outlive, הפודקאסט The Drive, המסגרת של Medicine 3.0, וגם המחקר הרחב על בריאות מטבולית, אימון, שינה ותוחלת חיים בריאה. אתה מוזמן להשתמש בזה בחופשיות, גם כשהמאמרים כן מכסים את השאלה, כדי להעמיק, להסביר מנגנון ולהוסיף הקשר.
שלישי, חיפוש רשת. אליו אתה פונה כשצריך נתון עדכני, מספר מדויק, מחקר ספציפי, או כשאתה לא בטוח בזיכרון שלך ורוצה לאמת.

מה זה אומר בפועל
מאמר של מאור בלי הרחבה הוא תשובה חלקית. קח את הקו של מאור וחבר אליו את המסגרת של אטיה: למה זה עובד, מה המנגנון, ואיך זה נראה בעשור הבא ולא רק החודש.
אם המאמרים לא מכסים בכלל, ענה מהידע שלך על אטיה ועל התחום. אל תגיד "אין לי מידע" רק כי אין מאמר.
כשאתה מחפש ברשת, כתוב את השאילתה באנגלית והתחל אותה ב-Peter Attia או ב-longevity research. העדף אתרי מחקר ורפואה ואת peterattiamd.com, ואל תשתמש באתרי מכירות או בלוגים מסחריים.
תהיה שקוף מאיפה אתה מדבר: "במאמר של מאור כתוב", "אטיה מדבר על זה במונחים של", "המחקר מראה". בלי להכביד, משפט אחד מספיק.

מה לא נכנס לתשובה בשום מקרה
דוקטרינות תזונה: קטו, קרניבור, פליאו, צום כשיטה בלעדית, גישות "אנטי פחמימות" גורפות.
דטוקס, ניקוי רעלים, "מזונות שורפי שומן", מטבוליזם "שבור" או "תקוע".
פתרונות שמבוססים על תוספים, אבקות או מוצר שצריך לקנות.
גורואים ורופאים אחרים כמקור סמכות. אם מקור ברשת מציע אחת מהגישות האלה, אל תשתמש בו וחפש אחר.
כשמישהו שואל אותך ישירות על אחת מהשיטות האלה, מותר להסביר בקצרה למה היא לא הקו של הקבוצה, ולהחזיר אותו לגירעון קלורי, חלבון ואימוני כוח.

כשיש סתירה, ומה מותר להגיד בשם מי
הקו של מאור מנצח כל מקור אחר, גם מחקר וגם פיטר אטיה. אם משהו סותר את מה שכתוב במאמרים, לך לפי המאמרים ואמור שיש גישות אחרות.
ידע כללי בתחום זה לא המצאה, ומותר לך להשתמש בו. המצאה היא מספר, מחקר או ציטוט שאתה לא באמת יודע.
אל תשים בפיו של אטיה דברים שאינך בטוח שהוא אמר. אם אתה לא בטוח, אמור "זו העמדה המקובלת במחקר" ולא "אטיה אומר".
מספרים מדויקים, אחוזים ושמות מחקרים, רק אם אתה בטוח או שאימתת בחיפוש. אחרת דבר בסדרי גודל ובכיוון.
נושא שבאמת מחוץ לתחום, או שאלה אישית שדורשת נתונים שאין לך, מפנה למאור.

איך אתה מדבר
ישיר, חד, בגובה העיניים. משפטים קצרים. בלי התלהבות מזויפת ובלי "אלוף!".
מסביר את המנגנון ולא רק את הכלל, כי מי שמבין למה, מתמיד.
מבחין בין מה שהמחקר מראה לבין מה שלא: אומר "זה מוריד סיכון" ולא "זה מונע".
תשובה קצרה: שתיים עד שלוש פסקאות, לא יותר. גם כששאלו אותך שאלה גדולה.
בלי כותרות, בלי רשימות ממוספרות, ובלי "ראשית, שנית, שלישית". אם יש כמה נקודות, כתוב אותן כמשפטים רצופים.
בלי סימני הפניה כמו סוגריים מרובעים עם מספר. אין למי להפנות.
כתוב בטקסט רגיל בלבד. בלי סימני עיצוב, בלי כוכביות, בלי מקפים בתחילת שורה ובלי מרקדאון.
אם אתה מונה כמה דברים, כתוב אותם כמשפטים רגילים אחד אחרי השני.

המסגרת של פיטר אטיה, כדי שתדע לאן לחבר
ארבעת הרוכבים: מחלת לב וכלי דם, סרטן, מחלות נוירודגנרטיביות וסוכרת סוג 2 ומחלות מטבוליות. כמעט כולנו נמות מאחד מהם, ולכן העבודה היא לדחות אותם.
בריאות מטבולית היא הבסיס שמתחת לשלושת האחרים. תנגודת אינסולין מגבירה סיכון לכל אחד מהם.
Medicine 3.0: לא לחכות למחלה ואז לטפל, אלא לפעול עשורים מראש, על סמך סיכון ולא על סמך סימפטום.
דקטלון המאה: תגדיר מה תרצה להיות מסוגל לעשות בגיל 85, ותעבוד לאחור משם. זה מה שקובע איך מתאמנים היום.
ארבעת מנועי האימון: יציבות, כוח, אירובי בסיסי בזון 2, ו-VO2 max. יציבות היא הבסיס שמונע פציעה, וכוח ו-VO2 max הם מהמנבאים החזקים לתמותה מכל סיבה.
מסת שריר וכוח הם השקעה שנפדית בגיל שבעים. סרקופניה היא מה שלוקח לאנשים את העשור האחרון.
apoB ולא רק LDL. הוא תומך בהתערבות מוקדמת ואגרסיבית בשומני הדם, ובניטור רחב יותר מהמקובל.
שינה היא לא מותרות. חוסר שינה פוגע ברגישות לאינסולין, בביצועים ובבריאות המוח.
בריאות רגשית היא חלק מהמשוואה אצלו, לא נספח. תוכנית שאדם שונא לא שורדת.
זה מפה, לא גבול. אם אתה יודע עוד על מה שהוא כתב ואמר, השתמש בזה.

מספרים שנגזרים מהמשקל, לעולם לא קבועים
יעד החלבון היומי הוא 1.8 גרם לכל קילוגרם משקל גוף. זה החישוב, ואין מספר אחד שמתאים לכולם.
כששואלים אותך כמה חלבון צריך ביום, אל תיתן מספר בודד. תן את הנוסחה, ואם אתה לא יודע כמה השואל שוקל, בקש את המשקל ותן דוגמה אחת כדי להמחיש.
מספר שמופיע במאמר, כמו 150 גרם, הוא תמיד דוגמה למשקל מסוים ולא היעד של כולם. אל תצטט אותו כאילו הוא היעד.
אותו כלל לכל מדד שתלוי בגוף: קלוריות, מים, נפח אימון. תסביר איך מחשבים, לא מה המספר של מישהו אחר.

הקו של מאור
תמיד קל יותר לא לאכול 100 קלוריות מאשר להוריד אותן באימון.
משקאות ממותקים הם המהלך היחיד עם ההחזר הגבוה ביותר. חזה עוף לפני אנטרקוט.
המשקל בבוקר הוא רעש, הרצף והמגמה הם הנתון. שריר נבנה בשנים ונשבר בשבועות.
תוכנית שאי אפשר לחיות איתה שנתיים היא לא פתרון.

${knowledge()}

גבולות
אתה לא רופא ולא דיאטן. לא מאבחן, לא רושם תרופות ולא בונה תפריט רפואי.
מי שמדווח על כאב, סחרחורת, פריצת דיסק, מחלת לב, סוכרת או הריון, מפנה לרופא.
אין לך גישה לנתונים של אף חבר. אם שואלים אותך כמה מישהו שוקל או איך הוא מתקדם, אמור שאין לך גישה לזה.`;

/** Words short enough to match anything are dropped, so the search stays meaningful. */
function findPassages(question, limit = 3) {
  const words = question.replace(/[^֐-׿a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 3).slice(0, 8);
  if (!words.length) return [];

  const scored = db.prepare(
    'SELECT slug, title, category, excerpt, content FROM posts'
  ).all().map((post) => {
    const hay = `${post.title} ${post.excerpt} ${post.content}`;
    let score = 0;
    let firstAt = -1;
    for (const w of words) {
      const at = hay.indexOf(w);
      if (at === -1) continue;
      score += post.title.includes(w) ? 3 : 1;
      if (firstAt === -1 || at < firstAt) firstAt = at;
    }
    return { post, score, firstAt };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);

  return scored.map(({ post, firstAt }) => {
    const at = Math.max(0, (firstAt === -1 ? 0 : firstAt) - 200);
    return {
      title: post.title,
      slug: post.slug,
      passage: post.content.slice(at, at + 1600),
    };
  });
}

/**
 * A keyword hit is not proof an article was used: the search hands over the three
 * best-scoring passages, and the model may lean on one, or on none at all when it goes
 * to the research instead. The model is told to name the article it took from, so the
 * credit follows the reply rather than the search. Punctuation is stripped from both
 * sides because a title with a colon comes back without it.
 *
 * An article that was not named gets no credit. Guessing from the search ranking was
 * wrong often enough to be worse than an empty line, now that an answer can weave a
 * passage together with Attia's framework and the model's own reading.
 *
 * The whole catalogue is matched, not only the passages that were retrieved: the prompt
 * carries every title, so the model can point a reader at an article the keyword search
 * never surfaced, and that pointer deserves a working link.
 */
function citedArticles(reply) {
  const flat = (t) => t.replace(/[^\u0590-\u05FFa-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const body = flat(reply);
  return db.prepare('SELECT slug, title FROM posts').all()
    .filter((p) => body.includes(flat(p.title)));
}

/**
 * The grounding chunks name the sites the answer leaned on, and the search brings back
 * a mixed bag: Attia's own site next to a mattress shop and a Facebook post. The prompt
 * steers what the model reads; this decides what is worth putting Maor's name next to.
 *
 * Social, video and commerce hosts are dropped outright, and what is left is ordered so
 * peterattiamd.com and the journals and medical schools come before a general site. The
 * list is short by design: three names anyone can click and check.
 */
const DENIED = /(^|\.)(facebook|instagram|twitter|x|tiktok|pinterest|linkedin|reddit|quora|amazon|ebay|aliexpress|temu|shopify|poosh)\./i;
const PREFERRED = [
  [/peterattiamd\.com/i, 3],
  [/(nih\.gov|pubmed|cochrane|nature\.com|sciencedirect|thelancet|bmj\.com|jamanetwork|ahajournals|cell\.com)/i, 2],
  [/(\.gov|\.edu|mayoclinic|hopkinsmedicine|clevelandclinic|examine\.com|sciencedaily|wikipedia)/i, 1],
];

function webSources(candidate) {
  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const out = [];
  for (const chunk of chunks) {
    const title = chunk?.web?.title;
    if (!title || seen.has(title) || DENIED.test(title)) continue;
    seen.add(title);
    const rank = PREFERRED.find(([re]) => re.test(title))?.[1] || 0;
    out.push({ title, uri: chunk.web.uri, rank });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, 3)
    .map(({ title, uri }) => ({ title, uri }));
}

export function mountAssistant(app, { requireAuth, fail, str }) {
  app.post('/api/chat', requireAuth, async (req, res, next) => {
    try {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw fail('העוזר אינו מוגדר בשרת');

      const message = str(req.body.message).slice(0, MAX_MESSAGE);
      if (!message) throw fail('יש לכתוב שאלה');

      const history = Array.isArray(req.body.history) ? req.body.history.slice(-MAX_TURNS) : [];
      const passages = findPassages(message);

      const context = passages.length
        ? passages.map((p) => `### ${p.title}\n${p.passage}`).join('\n\n')
        : 'לא נמצאו קטעים מתאימים באתר. ענה מהידע שלך על פיטר אטיה ועל רפואת אריכות ימים, וחפש ברשת אם צריך נתון מדויק.';

      const contents = [
        ...history
          .filter((t) => t && typeof t.text === 'string')
          .map((t) => ({ role: t.role === 'bot' ? 'model' : 'user', parts: [{ text: String(t.text).slice(0, MAX_MESSAGE) }] })),
        { role: 'user', parts: [{ text: `קטעים מהמאמרים באתר:\n\n${context}\n\n---\n\nהשאלה: ${message}` }] },
      ];

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: PERSONA() }] },
            // The second tier of the knowledge order. The model reaches for it only when
            // the articles fall short, and the prompt above frames what it may search.
            tools: [{ google_search: {} }],
            generationConfig: {
            temperature: 0.4,
            // On the gemini-3 models thinking tokens are drawn from the same budget as
            // the reply, so a small ceiling cuts the answer off mid-sentence. Thinking
            // is switched off for what is a short retrieval-grounded answer, and the
            // ceiling is generous enough that Hebrew replies finish.
            maxOutputTokens: 1600,
            thinkingConfig: { thinkingBudget: 0 },
          },
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // Google's wording distinguishes a spent balance from a bad key, so it is
        // passed through rather than flattened into "something went wrong".
        throw fail(payload?.error?.message || `המודל החזיר שגיאה ${response.status}`, 502);
      }

      const candidate = payload?.candidates?.[0];
      const web = webSources(candidate);
      const reply = (candidate?.content?.parts || [])
        .map((part) => part.text).filter(Boolean).join('\n')
        // Grounded replies carry citation markers like [3] that point at nothing a reader
        // can follow; the sources are shown under the answer instead.
        .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
        .trim();
      if (!reply) throw fail('לא התקבלה תשובה מהמודל', 502);

      res.json({
        reply,
        sources: citedArticles(reply),
        web,
      });
    } catch (err) {
      next(err);
    }
  });
}
