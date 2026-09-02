import { z } from 'zod';

/**
 * One way to talk to a model, two models behind it.
 *
 * Claude is the default because the key is already on the server and the rest
 * of the cockpit runs on it. Gemini is there because he asked for it, and
 * because a second provider is the only real insurance against the first
 * one's outage or price. Both speak the same shape here: a system brief, a
 * turn history, a set of tools, and back comes text plus the tool calls it
 * wants made. The loop that runs those tools lives in service.ts and is the
 * same for both — so a tool written once works under either.
 *
 * Keys are read from the server environment only (CLAUDE.md §5) and never
 * appear in a response, a log line or an error message.
 */

export type ProviderName = 'anthropic' | 'gemini';

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments — an object with properties. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** Serialised for the model; kept short by the tool itself. */
  output: string;
}

export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] };

export interface ChatRequest {
  system: string;
  turns: Turn[];
  tools: ToolSpec[];
  maxTokens?: number;
}

export type ChatResponse =
  | { ok: true; text: string; toolCalls: ToolCall[]; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; needsKey?: boolean };

export interface ProviderStatus {
  anthropic: boolean;
  gemini: boolean;
  /** What 'auto' resolves to right now, or null when nothing is configured. */
  auto: ProviderName | null;
}

export function providerStatus(): ProviderStatus {
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  const preferred = process.env.COPILOT_PROVIDER === 'gemini' ? 'gemini' : 'anthropic';
  const auto: ProviderName | null =
    preferred === 'gemini' && gemini ? 'gemini' : anthropic ? 'anthropic' : gemini ? 'gemini' : null;
  return { anthropic, gemini, auto };
}

export function resolveProvider(wanted: string | null | undefined): ProviderName | null {
  const status = providerStatus();
  if (wanted === 'anthropic') return status.anthropic ? 'anthropic' : null;
  if (wanted === 'gemini') return status.gemini ? 'gemini' : null;
  return status.auto;
}

export const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
};

/** Retry only what is worth retrying: a rate limit or a server fault. */
async function withRetry(fn: () => Promise<Response>): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fn();
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;
    last = res;
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  return last as Response;
}

// ───────────────────────────── Anthropic ─────────────────────────────

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = process.env.COPILOT_ANTHROPIC_MODEL ?? 'claude-sonnet-5';

const anthropicResponse = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  model: z.string().optional(),
});

function toAnthropicMessages(turns: Turn[]) {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: [{ type: 'text', text: t.text }] });
    else if (t.role === 'assistant') {
      const blocks: unknown[] = [];
      if (t.text) blocks.push({ type: 'text', text: t.text });
      for (const c of t.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      if (blocks.length > 0) out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({
        role: 'user',
        content: t.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })),
      });
    }
  }
  return out;
}

async function chatAnthropic(req: ChatRequest): Promise<ChatResponse> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set on the server', needsKey: true };

  const res = await withRetry(() =>
    fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: req.maxTokens ?? 2000,
        system: req.system,
        messages: toAnthropicMessages(req.turns),
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }),
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Claude answered http_${res.status}: ${body.slice(0, 200)}` };
  }
  const parsed = anthropicResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: 'Claude answered in a shape this code does not know' };

  const text = parsed.data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
  const toolCalls: ToolCall[] = parsed.data.content
    .filter((c) => c.type === 'tool_use' && c.id && c.name)
    .map((c) => ({ id: c.id as string, name: c.name as string, args: c.input ?? {} }));
  return {
    ok: true,
    text,
    toolCalls,
    model: parsed.data.model ?? ANTHROPIC_MODEL,
    inputTokens: parsed.data.usage.input_tokens,
    outputTokens: parsed.data.usage.output_tokens,
  };
}

// ────────────────────────────── Gemini ───────────────────────────────

const GEMINI_MODEL = process.env.COPILOT_GEMINI_MODEL ?? 'gemini-2.5-pro';
const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const geminiResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  functionCall: z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() })
    .optional(),
  modelVersion: z.string().optional(),
});

/**
 * Gemini has no tool-call ids: a function response is matched to its call by
 * name and order. The ids this code uses are its own, and stay on our side.
 */
function toGeminiContents(turns: Turn[]) {
  const out: { role: 'user' | 'model'; parts: unknown[] }[] = [];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', parts: [{ text: t.text }] });
    else if (t.role === 'assistant') {
      const parts: unknown[] = [];
      if (t.text) parts.push({ text: t.text });
      for (const c of t.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
      if (parts.length > 0) out.push({ role: 'model', parts });
    } else {
      out.push({
        role: 'user',
        parts: t.results.map((r) => ({
          functionResponse: { name: r.name, response: { result: r.output } },
        })),
      });
    }
  }
  return out;
}

/** Gemini's schema dialect is JSON Schema minus a few keywords it rejects. */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, Record<string, unknown>>).map(([pk, pv]) => [pk, toGeminiSchema(pv)]),
      );
    } else if (k === 'items' && v && typeof v === 'object') {
      out.items = toGeminiSchema(v as Record<string, unknown>);
    } else if (k === 'type' && typeof v === 'string') {
      out.type = v.toUpperCase();
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function chatGemini(req: ChatRequest): Promise<ChatResponse> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: 'GEMINI_API_KEY is not set on the server', needsKey: true };

  const res = await withRetry(() =>
    fetch(geminiUrl(GEMINI_MODEL), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: toGeminiContents(req.turns),
        tools: req.tools.length
          ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) }]
          : undefined,
        generationConfig: { maxOutputTokens: req.maxTokens ?? 2000, temperature: 0.3 },
      }),
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Gemini answered http_${res.status}: ${body.slice(0, 200)}` };
  }
  const parsed = geminiResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: 'Gemini answered in a shape this code does not know' };

  const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').filter(Boolean).join('\n').trim();
  const toolCalls: ToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `g${Date.now()}_${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
  return {
    ok: true,
    text,
    toolCalls,
    model: parsed.data.modelVersion ?? GEMINI_MODEL,
    inputTokens: parsed.data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: parsed.data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

export async function chat(provider: ProviderName, req: ChatRequest): Promise<ChatResponse> {
  return provider === 'gemini' ? chatGemini(req) : chatAnthropic(req);
}
