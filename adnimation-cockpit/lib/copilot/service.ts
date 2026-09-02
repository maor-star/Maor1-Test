import { desc, eq, isNull } from 'drizzle-orm';
import { copilotMessages, copilotThreads, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import {
  PROVIDER_LABEL, chat, loadProviderKeys, resolveProvider,
  type ProviderName, type ToolCall, type ToolResult, type Turn,
} from './provider';
import { TOOL_SPECS, runTool, type ToolContext } from './tools';

/**
 * The conversation he has with the model over the company.
 *
 * The model never sees the database. It sees tools — "the control panel",
 * "the deals needing attention", "open a task" — and every tool is a function
 * in this codebase that reads through the same modules the screens use and
 * writes through the same mutations, with the same audit rows and the same
 * undo. So an answer here cannot know anything the cockpit does not, and an
 * action here cannot do anything a screen could not.
 *
 * The loop runs until the model stops asking for tools or hits the cap. The
 * cap is the loop protection: a model that keeps asking for the same thing is
 * stopped, and what it read so far is still recorded on the message.
 */

const MAX_TOOL_ROUNDS = 8;
const HISTORY_TURNS = 24;

export function systemBrief(ctx: ToolContext, extra = ''): string {
  return [
    `You are the copilot inside the Adnimation CEO Cockpit — the private command centre of Maor Davidovich, CEO of Adnimation, an Israeli ad-tech company (publisher monetisation, a bidder, an ad exchange, seat leasing, display trading).`,
    `Today is ${ctx.today} (Asia/Jerusalem). The person you are talking to is ${ctx.actor}.`,
    ``,
    `How to work:`,
    `- Answer from the tools, never from memory. If a number is not in a tool result, say you do not have it. Cite the last full day a figure is from.`,
    `- Money in the tools is in cents unless a field says otherwise; present it in dollars, rounded sensibly. Gross is what flowed through; "ours"/profit is what Adnimation kept.`,
    `- Answer in the language he writes in (Hebrew or English). Ad-tech terms stay in English. Be direct and short; lead with the answer, then the evidence.`,
    `- You may act, through the tools, on anything reversible inside the cockpit: open a task, raise an alert, note a deal, move a deal's stage, switch an agent on or off. Say what you did. Never claim an action you did not take.`,
    `- You cannot send mail, sign, pay or touch anything outside the cockpit. When he asks for that, draft the text and say it is his to send.`,
    `- The Ad Ops Architect source is read-only, always.`,
    extra,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ThreadSummary {
  id: string;
  title: string;
  provider: string;
  updatedAt: Date;
  messageCount: number;
}

export async function listThreads(limit = 20): Promise<ThreadSummary[]> {
  const rows = await db
    .select()
    .from(copilotThreads)
    .where(isNull(copilotThreads.archivedAt))
    .orderBy(desc(copilotThreads.updatedAt))
    .limit(limit);
  const counts = await Promise.all(
    rows.map(async (t) => {
      const msgs = await db.select({ id: copilotMessages.id }).from(copilotMessages).where(eq(copilotMessages.threadId, t.id));
      return msgs.length;
    }),
  );
  return rows.map((t, i) => ({ id: t.id, title: t.title, provider: t.provider, updatedAt: t.updatedAt, messageCount: counts[i] ?? 0 }));
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: { name: string; args: Record<string, unknown>; output: string }[];
  provider: string | null;
  model: string | null;
  createdAt: Date;
}

export async function threadMessages(threadId: string): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(copilotMessages)
    .where(eq(copilotMessages.threadId, threadId))
    .orderBy(copilotMessages.createdAt);
  return rows.map((m) => ({
    id: m.id,
    role: m.role as StoredMessage['role'],
    content: m.content,
    toolCalls: (m.toolCalls as StoredMessage['toolCalls']) ?? [],
    provider: m.provider,
    model: m.model,
    createdAt: m.createdAt,
  }));
}

export async function createThread(actor: string, provider = 'auto'): Promise<string> {
  const [row] = await db
    .insert(copilotThreads)
    .values({ createdBy: actor, provider })
    .returning({ id: copilotThreads.id });
  if (!row) throw new Error('Could not open a conversation');
  return row.id;
}

export async function setThreadProvider(threadId: string, provider: string): Promise<void> {
  await db.update(copilotThreads).set({ provider, updatedAt: new Date() }).where(eq(copilotThreads.id, threadId));
}

/** The stored history, as turns the provider layer understands. */
function toTurns(messages: StoredMessage[]): Turn[] {
  // Tool calls are folded into the assistant message for the record, so the
  // history the model sees is question and answer — the reads it made last
  // time are not re-fed, which keeps the context small and the reads fresh.
  return messages
    .filter((m) => m.role !== 'tool')
    .slice(-HISTORY_TURNS)
    .map((m) => (m.role === 'user' ? { role: 'user', text: m.content } : { role: 'assistant', text: m.content }));
}

export interface ConverseResult {
  ok: boolean;
  error?: string;
  reply?: string;
  provider?: ProviderName;
  toolCalls?: { name: string; args: Record<string, unknown>; output: string }[];
}

/**
 * One turn: his message in, the model's answer out, every tool call recorded.
 */
export async function converse(
  threadId: string,
  text: string,
  ctx: ToolContext,
  wantedProvider?: string | null,
): Promise<ConverseResult> {
  const [thread] = await db.select().from(copilotThreads).where(eq(copilotThreads.id, threadId)).limit(1);
  if (!thread) return { ok: false, error: 'No such conversation' };

  await loadProviderKeys();
  const provider = resolveProvider(wantedProvider ?? thread.provider);
  if (!provider) {
    return { ok: false, error: 'No model is connected — set ANTHROPIC_API_KEY or GEMINI_API_KEY on the server.' };
  }

  await db.insert(copilotMessages).values({ threadId, role: 'user', content: text });

  const history = await threadMessages(threadId);
  const turns: Turn[] = toTurns(history);
  const made: { name: string; args: Record<string, unknown>; output: string }[] = [];
  let finalText = '';
  let model = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const res = await chat(provider, { system: systemBrief(ctx), turns, tools: TOOL_SPECS });
    if (!res.ok) return { ok: false, error: res.error };
    model = res.model;
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;

    if (res.toolCalls.length === 0 || round === MAX_TOOL_ROUNDS) {
      finalText = res.text || (res.toolCalls.length ? 'I ran out of steps before finishing. Ask again more narrowly.' : '');
      break;
    }

    turns.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls });
    const results: ToolResult[] = [];
    for (const call of res.toolCalls) {
      const output = await runTool(call, ctx);
      results.push({ id: call.id, name: call.name, output });
      made.push({ name: call.name, args: call.args, output: output.slice(0, 4000) });
    }
    turns.push({ role: 'tool', results });
  }

  await db.insert(copilotMessages).values({
    threadId,
    role: 'assistant',
    content: finalText,
    toolCalls: made as never,
    provider,
    model,
    inputTokens,
    outputTokens,
  });

  // The first exchange names the thread, so the list reads as what was asked.
  const isFirst = history.filter((m) => m.role === 'user').length === 1;
  await db
    .update(copilotThreads)
    .set({ updatedAt: new Date(), ...(isFirst ? { title: text.slice(0, 80) } : {}) })
    .where(eq(copilotThreads.id, threadId));

  if (made.some((m) => WRITE_TOOLS.has(m.name))) {
    await writeAudit({
      actor: ctx.actor,
      action: 'copilot.acted',
      entityType: 'copilot_thread',
      entityId: threadId,
      after: { tools: made.filter((m) => WRITE_TOOLS.has(m.name)).map((m) => ({ name: m.name, args: m.args })) },
    });
  }

  return { ok: true, reply: finalText, provider, toolCalls: made };
}

/** The tools that change something. Their use on a thread is itself audited. */
export const WRITE_TOOLS = new Set([
  'create_task', 'raise_alert', 'note_deal', 'move_deal_stage', 'set_agent_enabled',
]);

export { PROVIDER_LABEL };
export type { ToolCall };
