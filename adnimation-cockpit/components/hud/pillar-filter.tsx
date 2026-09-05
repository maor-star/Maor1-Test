import Link from 'next/link';
import { PILLAR_OPTIONS } from '@/lib/control/pillars';

/**
 * Reading a screen one pillar at a time.
 *
 * Links rather than a control, like every other filter here, so a pillar is a
 * URL he can bookmark and send — "the contracts on Exchange CTV" is a thing he
 * asks someone for, not only a thing he looks at.
 */
export function PillarFilter({
  current,
  href,
}: {
  current: string | null;
  /** Builds the URL for one pillar, or for none. */
  href: (line: string | null) => string;
}) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Filter by pillar">
      <Chip label="Every pillar" to={href(null)} on={current === null} />
      {PILLAR_OPTIONS.map((p) => (
        <Chip key={p.line} label={p.label} to={href(p.line)} on={current === p.line} />
      ))}
    </nav>
  );
}

function Chip({ label, to, on }: { label: string; to: string; on: boolean }) {
  return (
    <Link
      href={to}
      aria-current={on ? 'page' : undefined}
      className={`hud-label rounded-full border px-2.5 py-[6px] text-[11px] ${
        on
          ? 'border-ink bg-ink text-white'
          : 'border-line bg-card text-muted hover:border-neutral-300 hover:text-ink'
      }`}
    >
      {label}
    </Link>
  );
}
