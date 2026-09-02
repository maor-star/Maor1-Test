import { z } from 'zod';
import { secret } from '@/lib/secrets/store';

/**
 * A picture for the post, drawn by Gemini.
 *
 * Two ways in: a prompt he typed, or one the cockpit writes from the post
 * itself when he just presses "draw one". Either way the prompt is kept beside
 * the image, so "why does it look like that" has an answer and "again, but
 * warmer" has a starting point.
 *
 * Nothing here publishes. The image sits on the draft until he presses the
 * same PUBLISH button the words go through.
 */

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
const url = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const response = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

export interface GeneratedImage {
  ok: boolean;
  bytes?: Buffer;
  mime?: string;
  error?: string;
}

/** The house style, so a prompt of six words still comes out on-brand. */
const STYLE =
  'Clean, modern editorial illustration for a LinkedIn post by an ad-tech company. ' +
  'Flat shapes, restrained palette (deep navy, warm off-white, one accent colour), generous negative space, ' +
  'no text, no logos, no letters, no watermarks, no people’s faces. Landscape, 1200×627.';

/**
 * The prompt the cockpit writes from the post when he did not.
 *
 * It describes the idea, not the sentence: a post about a publisher going live
 * becomes a picture about connection and lift, not a rendering of the words.
 */
export function promptFromPost(body: string, occasion: string): string {
  const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? occasion;
  return `An image that conveys the idea behind this LinkedIn post — “${first.slice(0, 200)}” — about: ${occasion.slice(0, 120)}. ${STYLE}`;
}

export type ImageMaker = (prompt: string) => Promise<GeneratedImage>;

export const drawWithGemini: ImageMaker = async (prompt) => {
  const key = process.env.GEMINI_API_KEY || (await secret('GEMINI_API_KEY'));
  if (!key) return { ok: false, error: 'No Gemini key — paste GEMINI_API_KEY on the Keys screen.' };

  const res = await fetch(url(MODEL), {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Gemini answered http_${res.status}: ${body.slice(0, 200)}` };
  }

  const parsed = response.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: 'Gemini answered in a shape this code does not know.' };
  if (parsed.data.promptFeedback?.blockReason) {
    return { ok: false, error: `Gemini declined the prompt (${parsed.data.promptFeedback.blockReason}). Try describing the picture differently.` };
  }

  const part = parsed.data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) return { ok: false, error: 'Gemini answered with words and no picture. Try a more concrete prompt.' };

  return { ok: true, bytes: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType };
};

/** In-memory Gemini. Tests read `prompts`. */
export class FakeImageMaker {
  readonly prompts: string[] = [];
  failWith: string | null = null;

  make: ImageMaker = async (prompt) => {
    this.prompts.push(prompt);
    if (this.failWith) return { ok: false, error: this.failWith };
    // The smallest valid PNG there is: one transparent pixel.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    return { ok: true, bytes: png, mime: 'image/png' };
  };
}
