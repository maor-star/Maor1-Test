import { Num } from '@/components/num';
import { fmtTime } from '@/lib/utils';

/**
 * The head of a screen, as the design package draws it: an uppercase eyebrow,
 * a 34px title, and on the right the synced pill — a green dot, the word, and
 * the time in mono.
 *
 * No rule underneath and no live cluster of counters. The package puts the
 * page's identity at the top and everything else in cards below it, so the
 * header is one line of type and one pill.
 */
export function PageHeader({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <div className="hud-kicker">{kicker}</div>
        <h1 className="hud-title mt-1 text-[28px] sm:text-[34px]">{sentence(title)}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {action}
        <span className="inline-flex items-center gap-[9px] whitespace-nowrap rounded-full border border-[#cde9d8] bg-pos-tint px-4 py-[9px]">
          <span className="inline-block h-2 w-2 rounded-full bg-pos" aria-hidden="true" />
          <span className="text-[14.5px] font-semibold text-[#157a45]">Synced</span>
          <span className="font-mono text-[14px] text-[#157a45]">
            <Num>{fmtTime(new Date())}</Num>
          </span>
        </span>
      </div>
    </header>
  );
}

/**
 * The screens name themselves in the old system's tracked capitals ("deals").
 * This design sets a page title as a phrase, so a shouted title is written
 * back as a word here rather than edited in fifteen files — and anything
 * already written as a phrase is left exactly as it is.
 */
function sentence(title: string): string {
  if (title !== title.toUpperCase()) return title;
  return title
    .toLowerCase()
    .replace(/(^|[\s(\/-])([a-z])/g, (_m, before, letter) => `${before}${letter.toUpperCase()}`);
}
