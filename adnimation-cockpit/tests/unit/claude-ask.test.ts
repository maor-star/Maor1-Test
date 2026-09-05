import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ask } from '@/lib/integrations/claude';

/**
 * What `ask` does with an answer it cannot use.
 *
 * It must always come back with `ok: false`. A throw from in here escapes
 * through whatever asked — an agent, the contract summariser, a desk draft —
 * and out of the render, which is exactly how one over-long contract answer
 * became "this screen failed to load" with a digest and nothing else.
 */

const schema = z.object({ text: z.string() });

/** One canned Anthropic response. */
function answers(body: string, outputTokens = 10) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text: body }],
        usage: { input_tokens: 100, output_tokens: outputTokens },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

let key: string | undefined;

beforeEach(() => {
  key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  vi.unstubAllGlobals();
});

describe('an answer that will not parse', () => {
  it('comes back as a refusal, never as a throw', async () => {
    // A JSON object cut off mid-string: what an answer that hits the token
    // ceiling actually looks like.
    vi.stubGlobal('fetch', answers('{"text": "the reply that never fini'));

    const result = await ask('anything', { schema, maxTokens: 1500 });
    expect(result.ok).toBe(false);
  });

  it('says it ran out of room when that is what happened', async () => {
    vi.stubGlobal('fetch', answers('{"text": "cut off here', 1500));

    const result = await ask('anything', { schema, maxTokens: 1500 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ran out of room/i);
  });

  it('says something else when the answer was simply not JSON', async () => {
    // Room to spare, so this is the model ignoring the shape, not a ceiling.
    vi.stubGlobal('fetch', answers('I would rather explain it in prose.', 12));

    const result = await ask('anything', { schema, maxTokens: 1500 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toMatch(/ran out of room/i);
  });

  it('refuses JSON that parses but is the wrong shape', async () => {
    vi.stubGlobal('fetch', answers('{"nothing": "we asked for"}'));

    const result = await ask('anything', { schema, maxTokens: 1500 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/shape/i);
  });
});

describe('an answer that is usable', () => {
  it('comes back parsed', async () => {
    vi.stubGlobal('fetch', answers('Here you go: {"text": "the reply"}'));

    const result = await ask<{ text: string }>('anything', { schema, maxTokens: 1500 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed?.text).toBe('the reply');
  });
});
