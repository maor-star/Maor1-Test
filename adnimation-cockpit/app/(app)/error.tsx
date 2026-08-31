'use client';

import { useEffect } from 'react';
import { isStaleBuild } from '@/lib/stale-build';

/**
 * What he sees when something throws in the browser.
 *
 * Two very different failures land here and they need different treatment:
 *
 * · A chunk that no longer exists. His tab was open across a deploy, the next
 *   click asks for a file from the old build, and it is gone. Nothing is wrong
 *   with the app or with what he clicked — the page just needs to be fetched
 *   again. So it reloads itself, once, without asking. (The deploy now keeps
 *   the previous build's chunks too, which should stop this happening at all;
 *   this is the belt to that pair of braces.)
 *
 * · Anything else. A blank page with "an exception occurred" tells him nothing
 *   and loses whatever he was doing, so this says what is known, keeps the
 *   digest for me to find in the logs, and offers the two ways out.
 *
 * The reload guard is a session flag: a page that is broken for a real reason
 * must not reload for ever.
 */
const RELOADED = 'cockpit:reloaded-after-chunk-error';

export default function CockpitError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!isStaleBuild(error)) return;
    try {
      if (sessionStorage.getItem(RELOADED)) return;
      sessionStorage.setItem(RELOADED, '1');
      window.location.reload();
    } catch {
      // A browser that will not let us remember is a browser we do not reload.
    }
  }, [error]);

  const stale = isStaleBuild(error);

  return (
    <div className="mx-auto max-w-xl space-y-4 py-16">
      <div className="flex items-center gap-[10px] hud-kicker">
        <span className="inline-block h-px w-[22px] bg-accent" />
        SOMETHING BROKE
      </div>

      <h1 className="hud-title text-[30px] text-neutral-900">
        {stale ? 'A newer version was deployed' : 'This screen failed to load'}
      </h1>

      <p className="text-[14px] leading-relaxed text-neutral-600">
        {stale
          ? 'Your tab was open while the cockpit was updated, so it was still asking for the old files. Reloading now — nothing you did was lost, but anything you were in the middle of will need doing again.'
          : 'Nothing was saved by whatever you were doing, so it is safe to try again. If it keeps happening, the reference below is the one to send me.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="border border-divider px-3 py-1.5 font-semi text-[10px] uppercase tracking-[0.16em] text-neutral-600 hover:border-accent hover:text-accent"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="border border-accent bg-accent px-3 py-1.5 font-semi text-[10px] uppercase tracking-[0.16em] text-ground"
        >
          Reload the page
        </button>
      </div>

      {/*
        The message itself, not only the digest. A digest is a key into a log
        on a box he does not have a shell on; the message is something he can
        screenshot and send me, which is how this one was found in the first
        place. Nothing here is secret — it is his own cockpit.
      */}
      {!stale ? (
        <pre
          dir="ltr"
          className="max-h-40 overflow-auto whitespace-pre-wrap border border-divider px-2 py-2 text-start text-[11px] text-neutral-500"
        >
          {error.name}: {error.message}
          {error.digest ? `\n\nreference ${error.digest}` : ''}
        </pre>
      ) : null}
    </div>
  );
}
