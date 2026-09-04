'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lastUndoableAction, undoAction } from '@/app/actions/undo';

/**
 * Ten seconds to take it back.
 *
 * Every screen changes something, and every change is one wrong click away
 * from being a mistake. Rather than each of them growing its own confirm
 * dialog — which costs him a click on the 99 times he meant it, to save him on
 * the one time he did not — the change goes through and a bar offers it back.
 *
 * The bar does not need to be told what happened. A component that changed
 * something calls `offer()`, and the server looks up the last audit row this
 * user wrote; if it can be put back, the bar appears. That is what makes undo
 * available everywhere instead of only where somebody remembered to wire it,
 * and it means an action nobody has taught it about is still undoable the day
 * it ships.
 */

const WINDOW_SECONDS = 10;

interface UndoContextValue {
  /** Something just changed — find it and offer it back for ten seconds. */
  offer: (fallbackLabel?: string) => void;
}

const UndoContext = createContext<UndoContextValue | null>(null);

/**
 * Outside the provider this is a no-op rather than a crash.
 *
 * A component that can be rendered on the login page or in a test has no
 * business failing to mount because there is nowhere to put an undo bar.
 */
export function useUndo(): UndoContextValue {
  return useContext(UndoContext) ?? { offer: () => {} };
}

interface Pending {
  auditId: number;
  label: string;
  /** When the offer stops being shown. */
  until: number;
}

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [left, setLeft] = useState(WINDOW_SECONDS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Offers arrive faster than the round trip when he clicks twice; only the
  // newest one may open the bar, or the second click restores the first state.
  const seq = useRef(0);

  const offer = useCallback((fallbackLabel?: string) => {
    const mine = ++seq.current;
    setNote(null);
    void lastUndoableAction()
      .then((res) => {
        if (mine !== seq.current) return;
        if (!res.offer) {
          setPending(null);
          return;
        }
        setPending({
          auditId: res.offer.auditId,
          label: fallbackLabel ?? res.offer.label,
          until: Date.now() + WINDOW_SECONDS * 1000,
        });
        setLeft(WINDOW_SECONDS);
      })
      .catch(() => {
        // Undo is a courtesy, never the thing that breaks the screen.
      });
  }, []);

  // One ticker for the countdown, running only while a bar is up.
  useEffect(() => {
    if (!pending) return;
    const tick = () => {
      const remaining = Math.ceil((pending.until - Date.now()) / 1000);
      if (remaining <= 0) {
        setPending(null);
        setLeft(WINDOW_SECONDS);
        return;
      }
      setLeft(remaining);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pending]);

  // A note ("put back", or why it could not be) stands for a moment and goes.
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(id);
  }, [note]);

  const run = async () => {
    if (!pending || busy) return;
    setBusy(true);
    const res = await undoAction(pending.auditId).catch(() => ({
      ok: false,
      error: 'Could not reach the server',
    }));
    setBusy(false);
    setPending(null);
    setNote(res.ok ? 'Put back' : (res.error ?? 'Could not undo that'));
    if (res.ok) router.refresh();
  };

  return (
    <UndoContext.Provider value={{ offer }}>
      {children}

      {(pending || note) && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
          role="status"
          aria-live="polite"
        >
          <div className="hud-card pointer-events-auto flex items-center gap-3 border border-line bg-card px-3 py-2 shadow-lg">
            {pending ? (
              <>
                <span className="hud-label text-neutral-500">{pending.label}</span>
                <button
                  type="button"
                  onClick={run}
                  disabled={busy}
                  className="font-semi text-[11px] uppercase tracking-[0.16em] text-accent hover:text-info disabled:opacity-50"
                >
                  {busy ? 'Undoing…' : 'Undo'}
                </button>
                <span
                  className="hud-numeral text-[11px] tabular-nums text-neutral-400"
                  aria-hidden="true"
                >
                  {left}s
                </span>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  aria-label="Dismiss"
                  className="text-[11px] text-neutral-400 hover:text-neutral-700"
                >
                  ×
                </button>
              </>
            ) : (
              <span className="hud-label text-neutral-500">{note}</span>
            )}
          </div>
        </div>
      )}
    </UndoContext.Provider>
  );
}
