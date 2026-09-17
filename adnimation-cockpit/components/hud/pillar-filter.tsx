import Link from 'next/link';
import type { PillarOption } from '@/lib/control/pillars';

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
  options,
  manage,
}: {
  current: string | null;
  /** Builds the URL for one pillar, or for none. */
  href: (line: string | null) => string;
  /** The pillars as he has them now, read from the table by the page. */
  options: PillarOption[];
  /** Where the list itself is edited. Omitted for anyone who may not. */
  manage?: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Filter by pillar">
      <Chip label="Every pillar" to={href(null)} on={current === null} />
      {options.map((p) => (
        <Chip key={p.line} label={p.label} to={href(p.line)} on={current === p.line} />
      ))}
      {/* The list is his to change, so the way to change it sits with it —
          finding it under Settings means knowing it is there. */}
      {manage ? (
        <Link
          href={manage}
          className="hud-label rounded-full border border-dashed border-line px-2.5 py-[6px] text-[11px] text-muted hover:border-neutral-300 hover:text-ink"
        >
          + EDIT PILLARS
        </Link>
      ) : null}
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
