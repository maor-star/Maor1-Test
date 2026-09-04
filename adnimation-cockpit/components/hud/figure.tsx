import Link from 'next/link';
import { Num } from '@/components/num';

/**
 * One number in the strip at the top of a screen.
 *
 * Give it an href and it becomes the way into what it counts: "switched ON 1"
 * is not a fact to read, it is the question "which one?". The strip is where
 * he looks first, so it is also where he should be able to click first.
 *
 * The package's metric cell: a 12px uppercase label above a mono figure, the
 * figure tinted only when it carries a state.
 */
export function Figure({
  label,
  value,
  big = false,
  tone,
  href,
  active = false,
}: {
  label: string;
  value: string | number;
  big?: boolean;
  tone?: 'warn' | 'critical' | 'ok';
  href?: string;
  active?: boolean;
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-warn'
      : tone === 'critical'
        ? 'text-neg'
        : tone === 'ok'
          ? 'text-pos'
          : 'text-ink';

  const body = (
    <>
      <span
        className={`hud-label block text-[11.5px] ${
          active ? 'text-accent' : href ? 'group-hover:text-ink' : ''
        }`}
      >
        {label}
      </span>
      <span
        className={`mt-[6px] block font-mono font-semibold leading-none tracking-[-0.035em] ${
          big ? 'text-[27px]' : 'text-[21px]'
        } ${toneClass}`}
      >
        <Num>{value}</Num>
      </span>
    </>
  );

  if (!href) return <div>{body}</div>;

  return (
    <Link
      href={href}
      className={`group block rounded-[10px] px-2 py-1 transition-colors ${
        active ? 'bg-accent-100' : 'hover:bg-neutral-100'
      }`}
    >
      {body}
    </Link>
  );
}
