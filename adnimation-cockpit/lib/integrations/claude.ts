import { z } from 'zod';

/**
 * Claude, for reading documents and for the agent runtime.
 *
 * One adapter, because two callers need it and a second copy of the retry and
 * error handling is a second set of bugs. Like every other integration here it
 * degrades rather than throws: no key configured is a state the screen reports,
 * not an exception that blanks a page.
 *
 * The key is read from the environment on the server and never reaches the
 * browser (CLAUDE.md §5).
 */

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/**
 * The current Claude models. Sonnet is the default: contract summarising and
 * agent condition evaluation are both well within it, and it is the sensible
 * cost for work that runs on a timer.
 */
export const MODELS = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

export type ModelName = keyof typeof MODELS;

export interface ClaudeStatus {
  configured: boolean;
  reason?: string;
}

export function claudeStatus(): ClaudeStatus {
  return process.env.ANTHROPIC_API_KEY
    ? { configured: true }
    : { configured: false, reason: 'ANTHROPIC_API_KEY is not set on the server' };
}

/** A PDF sent as a document block; Claude reads the pages itself. */
export interface DocumentInput {
  base64: string;
  mediaType: 'application/pdf';
}

export interface AskOptions {
  system?: string;
  model?: ModelName;
  maxTokens?: number;
  document?: DocumentInput;
  /** Ask for JSON back and parse it against this. */
  schema?: z.ZodTypeAny;
}

export type AskResult<T = string> =
  | { ok: true; text: string; parsed?: T; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; needsKey?: boolean };

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/**
 * One question, one answer.
 *
 * Retries only what is worth retrying — a rate limit or a server fault. A 400
 * is a request we built wrong and will build wrong again, so it comes back
 * immediately with what the API said rather than after four waits.
 */
export async function ask<T = string>(
  prompt: string,
  options: AskOptions = {},
): Promise<AskResult<T>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: 'Claude is not connected — ANTHROPIC_API_KEY is not set on the server.',
      needsKey: true,
    };
  }

  const content: unknown[] = [];
  if (options.document) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: options.document.mediaType,
        data: options.document.base64,
      },
    });
  }
  content.push({ type: 'text', text: prompt });

  const body = {
    model: MODELS[options.model ?? 'sonnet'],
    max_tokens: options.maxTokens ?? 2000,
    ...(options.system ? { system: options.system } : {}),
    messages: [{ role: 'user', content }],
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt === 3) {
        return { ok: false, error: e instanceof Error ? e.message : 'Could not reach Claude' };
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt === 3) return { ok: false, error: `Claude is busy (http_${res.status})` };
      // Honour the API's own backoff where it gives one.
      const retryAfter = Number(res.headers.get('retry-after'));
      await new Promise((r) =>
        setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * 2 ** attempt),
      );
      continue;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let reason = detail.slice(0, 300);
      try {
        const parsed = JSON.parse(detail) as { error?: { message?: string } };
        if (parsed.error?.message) reason = parsed.error.message;
      } catch {
        // Not JSON; the raw text is the best we have.
      }
      return {
        ok: false,
        error: `Claude refused it: http_${res.status} ${reason}`,
        ...(res.status === 401 ? { needsKey: true } : {}),
      };
    }

    const parsed = responseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, error: 'Claude sent something unexpected' };

    const text = parsed.data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();

    const usage = {
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
    };

    if (!options.schema) return { ok: true, text, ...usage };

    /*
     * Models like to wrap JSON in prose or a fence; take the object itself.
     *
     * And the parse is guarded, because an answer that runs into the token
     * ceiling comes back as a JSON object cut off mid-string. An unguarded
     * JSON.parse on that throws out of here, through whatever was asking, and
     * out of the render — which is how one long contract answer turned into
     * "this screen failed to load". Every caller of this already handles
     * `ok: false`; none of them expected a throw.
     */
    const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? text;
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      // Said apart, because they are different problems: one is fixed by
      // asking for less, the other by asking more clearly.
      const truncated = parsed.data.usage.output_tokens >= (options.maxTokens ?? 2000) - 8;
      return {
        ok: false,
        error: truncated
          ? 'Claude ran out of room before it finished the answer — ask for a shorter one.'
          : 'Claude did not answer with usable JSON',
      };
    }

    const shaped = options.schema.safeParse(value);
    if (!shaped.success) {
      return { ok: false, error: `Claude's answer did not fit the shape asked for` };
    }
    return { ok: true, text, parsed: shaped.data as T, ...usage };
  }

  return { ok: false, error: 'Claude kept failing' };
}
