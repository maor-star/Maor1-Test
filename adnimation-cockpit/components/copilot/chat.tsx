'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendMessageAction } from '@/app/actions/copilot';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { useUndo } from '@/components/ui/undo-bar';
import type { StoredMessage } from '@/lib/copilot/service';

/**
 * The conversation.
 *
 * Plain on purpose: his question, the answer, and under each answer the tools
 * it used to get there — collapsed, but there, because an answer about money
 * that cannot show what it read is an answer he should not trust.
 */
export function CopilotChat({
  threadId,
  messages,
  providers,
  currentProvider,
}: {
  threadId: string | null;
  messages: StoredMessage[];
  providers: { anthropic: boolean; gemini: boolean; auto: string | null };
  currentProvider: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [provider, setProvider] = useState(currentProvider);
  const [optimistic, setOptimistic] = useState<StoredMessage[]>([]);
  const router = useRouter();
  const undo = useUndo();
  const listRef = useRef<HTMLDivElement>(null);

  /*
   * Keep the newest message in view — inside the conversation, and nowhere
   * else.
   *
   * This used to call scrollIntoView() on a marker at the end of the list, and
   * that scrolls EVERY scrollable ancestor until the element is visible: the
   * conversation, and then the page behind it. So every render — opening the
   * screen, sending a message, any refresh — threw the whole page down to the
   * chat. Setting scrollTop on the list itself moves the list and leaves the
   * page where he left it.
   */
  const pinToNewest = () => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  };

  useEffect(() => {
    pinToNewest();
    setOptimistic([]);
  }, [messages]);

  // His own message, and the "reading the cockpit" line under it, both arrive
  // without `messages` changing — they are optimistic until the answer lands.
  useEffect(pinToNewest, [optimistic, pending]);

  const nothingConnected = !providers.anthropic && !providers.gemini;

  const send = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setError(null);
    setOptimistic([{ id: 'tmp', role: 'user', content: text, toolCalls: [], provider: null, model: null, createdAt: new Date() }]);
    setDraft('');
    const data = new FormData();
    if (threadId) data.set('threadId', threadId);
    data.set('text', text);
    data.set('provider', provider);
    startTransition(async () => {
      const result = await sendMessageAction(data);
      if (!result.ok) {
        setError(result.error ?? 'That did not work');
        setOptimistic([]);
        setDraft(text);
        return;
      }
      if (result.toolCalls?.some((t) => ['create_task', 'raise_alert', 'note_deal', 'move_deal_stage', 'set_agent_enabled'].includes(t.name))) {
        undo.offer();
      }
      if (!threadId && result.threadId) router.push(`/copilot?thread=${result.threadId}`);
      else router.refresh();
    });
  };

  const all = [...messages, ...optimistic];

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-[18px] py-3">
        {all.length === 0 ? (
          <div className="text-[13px] text-neutral-500">
            <p className="font-semi">Ask about anything the cockpit knows, or tell it to do something.</p>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              <li>מה קרה לוידאו השבוע לעומת שבוע שעבר?</li>
              <li>אילו לקוחות ליבה ירדו ומה כדאי לעשות?</li>
              <li>Which deals have an overdue next step? Open a task for each.</li>
              <li>מה מחכה לי במייל מאנשים שאנחנו עובדים איתם?</li>
              <li>Switch on activity-watch and core-client-guardian.</li>
            </ul>
          </div>
        ) : (
          all.map((m) => <Message key={m.id} m={m} />)
        )}
        {pending ? <p className="font-semi text-[11px] tracking-[0.1em] text-neutral-500">Reading the cockpit…</p> : null}
      </div>

      <div className="border-t border-line px-[18px] py-3">
        {nothingConnected ? (
          <p className="mb-2 text-[12px] text-sev-warning">
            No model is connected. Set ANTHROPIC_API_KEY or GEMINI_API_KEY on the server (deploy/set-secret.mjs) and restart.
          </p>
        ) : null}
        {error ? <p className="mb-2 text-[12px] text-sev-warning">{error}</p> : null}
        <div className="flex flex-wrap items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask, or tell it what to do. Enter sends; Shift+Enter for a new line."
            className="min-w-[16rem] flex-1"
            disabled={pending || nothingConnected}
          />
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="h-9 text-[12px]" disabled={pending}>
            <option value="auto">Model: auto{providers.auto ? ` (${providers.auto === 'gemini' ? 'Gemini' : 'Claude'})` : ''}</option>
            <option value="anthropic" disabled={!providers.anthropic}>Claude{providers.anthropic ? '' : ' — no key'}</option>
            <option value="gemini" disabled={!providers.gemini}>Gemini{providers.gemini ? '' : ' — no key'}</option>
          </Select>
          <Button type="button" onClick={send} disabled={pending || nothingConnected || !draft.trim()}>
            {pending ? 'THINKING…' : 'SEND'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Message({ m }: { m: StoredMessage }) {
  const [open, setOpen] = useState(false);
  const mine = m.role === 'user';
  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div className={`max-w-[85%] border px-3 py-2 ${mine ? 'border-accent/40 bg-accent/5' : 'border-line bg-card'}`}>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-900">{m.content || (mine ? '' : '—')}</p>
        {!mine && (m.toolCalls.length > 0 || m.model) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {m.model ? <span className="hud-label text-[11px]">{m.provider === 'gemini' ? 'GEMINI' : 'CLAUDE'} · {m.model}</span> : null}
            {m.toolCalls.length > 0 ? (
              <button type="button" onClick={() => setOpen((v) => !v)} className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline">
                {open ? 'Hide' : 'Show'} what it read · {m.toolCalls.length}
              </button>
            ) : null}
          </div>
        ) : null}
        {open ? (
          <ul className="mt-2 space-y-1 border-t border-line pt-2">
            {m.toolCalls.map((t, i) => (
              <li key={i} className="text-[11px] text-neutral-600">
                <span className="font-semi text-info">{t.name}</span>
                {Object.keys(t.args).length ? <span dir="ltr" className="ms-1 text-neutral-500">{JSON.stringify(t.args)}</span> : null}
                <pre dir="ltr" className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap text-start text-[11.5px] leading-snug text-neutral-500">{t.output.slice(0, 1500)}</pre>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
