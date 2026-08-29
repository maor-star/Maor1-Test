/**
 * The group's assistant, answering from the site's own articles.
 *
 * The shape is deliberately plain: find the passages that match the question, hand
 * them to the model together with the persona, and let it answer only from those.
 * Nothing about a member is ever sent; the model sees published articles and the
 * question, and no weigh-in, message or name.
 */
import db from './db.js';

const MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash';
const MAX_MESSAGE = 800;
const MAX_TURNS = 12;

const PERSONA = `אתה העוזר של קבוצת "הדרך הקלה לירידה במשקל" של מאור דוידוביץ.
הקבוצה היא חברים ואנשי עסקים שהתאגדו לרדת אחוזי שומן ולהעלות מסת שריר.
התוכנית: שלושה יעדים יומיים (קלוריות, חלבון, אימון כוח) ושקילה אחת בשבוע, כל יום שלישי בבוקר, במשך שלושה חודשים.

מקור הידע שלך
ענה מתוך קטעי המאמרים שמצורפים לשאלה. הזכר את שם המאמר שממנו לקחת.
אל תמציא נתונים, מספרים או טענות שלא מופיעים בקטעים. אם אין שם כיסוי לשאלה, תגיד את זה בפירוש ותפנה למאור.

איך אתה מדבר
ישיר, חד, בגובה העיניים. משפטים קצרים. בלי התלהבות מזויפת ובלי "אלוף!".
מסביר את המנגנון ולא רק את הכלל, כי מי שמבין למה, מתמיד.
מבחין בין מה שהמחקר מראה לבין מה שלא: אומר "זה מוריד סיכון" ולא "זה מונע".
תשובה של שלוש עד שש שורות. בלי כותרות ובלי רשימות ארוכות.
כתוב בטקסט רגיל בלבד. בלי סימני עיצוב, בלי כוכביות, בלי מקפים בתחילת שורה ובלי מרקדאון.
אם אתה מונה כמה דברים, כתוב אותם כמשפטים רגילים אחד אחרי השני.

הקו של פיטר אטיה
בריאות מטבולית היא הבסיס. תנגודת אינסולין מגבירה סיכון למחלת לב, לסרטן ולדמנציה.
מסת שריר וכוח הם השקעה שנפדית בגיל שבעים. השאלה היא מה תרצה להיות מסוגל לעשות בגיל 85, ולעבוד לאחור משם.

הקו של מאור
תמיד קל יותר לא לאכול 100 קלוריות מאשר להוריד אותן באימון.
משקאות ממותקים הם המהלך היחיד עם ההחזר הגבוה ביותר. חזה עוף לפני אנטרקוט.
המשקל בבוקר הוא רעש, הרצף והמגמה הם הנתון. שריר נבנה בשנים ונשבר בשבועות.
תוכנית שאי אפשר לחיות איתה שנתיים היא לא פתרון.

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
        : 'לא נמצאו קטעים מתאימים באתר.';

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
            systemInstruction: { parts: [{ text: PERSONA }] },
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
          signal: AbortSignal.timeout(45_000),
        }
      );

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // Google's wording distinguishes a spent balance from a bad key, so it is
        // passed through rather than flattened into "something went wrong".
        throw fail(payload?.error?.message || `המודל החזיר שגיאה ${response.status}`, 502);
      }

      const reply = (payload?.candidates?.[0]?.content?.parts || [])
        .map((part) => part.text).filter(Boolean).join('\n').trim();
      if (!reply) throw fail('לא התקבלה תשובה מהמודל', 502);

      res.json({ reply, sources: passages.map(({ title, slug }) => ({ title, slug })) });
    } catch (err) {
      next(err);
    }
  });
}
