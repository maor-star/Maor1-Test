#!/usr/bin/env node
/**
 * Proves the copilot can hold a tool-using exchange with each configured model.
 *
 *   node deploy/copilot-check.mjs        (reads ANTHROPIC_API_KEY / GEMINI_API_KEY from the environment)
 *
 * Mirrors lib/copilot/provider.ts request for request: a system brief, one
 * tool, a first turn that should provoke a tool call, the tool result fed
 * back, and a final answer. "The key works" is not the same as "the tool
 * round-trip works" — the second is where the two APIs differ, and it is what
 * the screen depends on. Prints outcomes only; never a key.
 */
const tool = {
  name: 'get_number',
  description: 'Returns the secret number for a label.',
  parameters: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
};
const system = 'You are a terse assistant. Use the tool when asked for a secret number, then answer in one short sentence.';
const question = 'What is the secret number for "video"? Use the tool.';

async function anthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return 'anthropic: no key';
  const model = process.env.COPILOT_ANTHROPIC_MODEL ?? 'claude-sonnet-5';
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const tools = [{ name: tool.name, description: tool.description, input_schema: tool.parameters }];
  const first = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: 300, system, tools, messages: [{ role: 'user', content: [{ type: 'text', text: question }] }] }) });
  if (!first.ok) return `anthropic: first call http_${first.status} ${(await first.text()).slice(0, 160)}`;
  const a = await first.json();
  const use = a.content.find((c) => c.type === 'tool_use');
  if (!use) return `anthropic: model did not call the tool (${a.content.map((c) => c.type).join(',')})`;
  const second = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: 300, system, tools, messages: [
    { role: 'user', content: [{ type: 'text', text: question }] },
    { role: 'assistant', content: a.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: '42' }] },
  ] }) });
  if (!second.ok) return `anthropic: second call http_${second.status} ${(await second.text()).slice(0, 160)}`;
  const b = await second.json();
  const text = b.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  return `anthropic: ok — tool called with ${JSON.stringify(use.input)}, answer: "${text.slice(0, 80)}" (${b.model})`;
}

async function gemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return 'gemini: no key';
  const model = process.env.COPILOT_GEMINI_MODEL ?? 'gemini-2.5-pro';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };
  const tools = [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: { type: 'OBJECT', properties: { label: { type: 'STRING' } }, required: ['label'] } }] }];
  const contents = [{ role: 'user', parts: [{ text: question }] }];
  const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, tools }) });
  if (!first.ok) return `gemini: first call http_${first.status} ${(await first.text()).slice(0, 160)}`;
  const a = await first.json();
  const parts = a.candidates?.[0]?.content?.parts ?? [];
  const call = parts.find((p) => p.functionCall);
  if (!call) return `gemini: model did not call the tool (${JSON.stringify(parts).slice(0, 120)})`;
  const second = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, tools, contents: [
    ...contents,
    { role: 'model', parts },
    { role: 'user', parts: [{ functionResponse: { name: call.functionCall.name, response: { result: '42' } } }] },
  ] }) });
  if (!second.ok) return `gemini: second call http_${second.status} ${(await second.text()).slice(0, 160)}`;
  const b = await second.json();
  const text = (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(' ');
  return `gemini: ok — tool called with ${JSON.stringify(call.functionCall.args)}, answer: "${text.slice(0, 80)}" (${b.modelVersion ?? model})`;
}

console.log(await anthropic());
console.log(await gemini());
