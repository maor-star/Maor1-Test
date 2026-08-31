import Link from 'next/link';
import { Num } from '@/components/num';

/**
 * One number in the strip at the top of a screen.
 *
 * Give it an href and it becomes the way into what it counts: "SWITCHED ON 1"
 * is not a fact to read, it is the question "which one?". The strip is where
 * he looks first, so it is also where he should be able to click first.
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
      ? 'text-sev-warning'
      : tone === 'critical'
        ? 'text-sev-critical'
        : tone === 'ok'
          ? 'text-sev-ok'
          : 'text-neutral-900';

  const body = (
    <>
      <span
        className={`hud-label block text-[9px] ${
          active ? 'text-accent-700' : href ? 'group-hover:text-accent' : ''
        }`}
      >
        {label}
      </span>
      <span
        className={`font-cond leading-none ${big ? 'text-[30px]' : 'text-[22px]'} ${toneClass} ${
          href ? 'group-hover:text-accent' : ''
        }`}
      >
        <Num>{value}</Num>
      </span>
    </>
  );

  if (!href) return <div>{body}</div>;

  return (
    <Link
      href={href}
      className={`group block border-b-2 pb-1 ${
        active ? 'border-accent' : 'border-transparent hover:border-accent/40'
      }`}
    >
      {body}
    </Link>
  );
}
