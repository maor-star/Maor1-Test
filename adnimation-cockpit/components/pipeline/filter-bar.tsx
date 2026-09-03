import Link from 'next/link';
import { Num } from '@/components/num';

/**
 * The one bar the deals board is worked from.
 *
 * Every way of cutting the book sits here — the stage, the kind of client,
 * and the three views that are not stages at all (what needs attention, what
 * has been suggested and not yet accepted, what is finished). They were four
 * separate hairline strips of nine-pixel text before, which is a lot of aiming
 * for something touched on every visit; and the suggestions were a whole card
 * of their own above the board, always open whether or not he was looking at
 * them.
 *
 * So: proper targets, a count on every one of them, and the count is the
 * point — it says which cuts have anything in them before he clicks. The
 * counts are of the whole book, never of the current filter, or choosing one
 * type would make every other chip read zero.
 */

export interface FilterChip {
  key: string;
  label: string;
  href: string;
  active: boolean;
  /** Shown beside the label. Null for the "all" chips, which count everything. */
  count?: number | null;
  /** `warn` for a count that is waiting on him rather than merely describing. */
  tone?: 'warn';
  title?: string;
}

export interface FilterGroup {
  label: string;
  chips: FilterChip[];
}

export function PipelineFilterBar({ groups }: { groups: FilterGroup[] }) {
  return (
    <div className="hud-card hud-marks flex min-w-0 flex-col divide-y divide-divider p-0">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-[14px]">
          <span className="hud-label w-[62px] shrink-0 text-[9px] text-neutral-400">
            {group.label}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {group.chips.map((chip) => (
              <Chip key={chip.key} chip={chip} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ chip }: { chip: FilterChip }) {
  const empty = chip.count === 0;
  return (
    <Link
      href={chip.href}
      {...(chip.title ? { title: chip.title } : {})}
      aria-current={chip.active ? 'page' : undefined}
      className={[
        'group inline-flex min-h-[34px] items-center gap-2 border px-3 transition-colors',
        chip.active
          ? 'border-accent bg-accent text-ground'
          : empty
            ? 'border-divider text-neutral-400 hover:border-accent hover:text-accent'
            : 'border-divider text-neutral-700 hover:border-accent hover:text-accent',
      ].join(' ')}
    >
      <span className="font-semi text-[11px] uppercase tracking-[0.14em]">{chip.label}</span>
      {chip.count !== null && chip.count !== undefined ? (
        <span
          className={[
            'font-cond text-[16px] leading-none',
            chip.active
              ? 'text-ground'
              : chip.tone === 'warn' && chip.count > 0
                ? 'text-sev-warning'
                : empty
                  ? 'text-neutral-300'
                  : 'text-accent-700 group-hover:text-accent',
          ].join(' ')}
        >
          <Num>{chip.count}</Num>
        </span>
      ) : null}
    </Link>
  );
}
