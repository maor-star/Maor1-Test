import Link from 'next/link';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { heatBand } from '@/lib/scoring/heat-score';
import { PRIORITY_META, STATUS_LABEL, type TaskPriority, type TaskStatus } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';

const PRIORITY_TONE = {
  P0: 'critical', P1: 'warning', P2: 'watch', P3: 'neutral',
} as const;

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <Tag tone={PRIORITY_TONE[priority]} title={PRIORITY_META[priority].sla}>
      <Num>{priority}</Num>
      <span className="ms-1">{PRIORITY_META[priority].label}</span>
    </Tag>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status as TaskStatus] ?? status.replace(/_/g, ' ');
  return <Tag tone={status === 'done' ? 'accent' : 'outline'}>{label}</Tag>;
}

const BAND_CLASS = {
  burning: 'bg-sev-critical',
  hot: 'bg-sev-warning',
  warm: 'bg-sev-watch',
  cool: 'bg-accent-500',
} as const;

/** Heat score as a segmented gauge — the design system's meter pattern. */
export function HeatBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2" title={`Heat Score ${score}`}>
      <div className="hud-gauge w-14">
        <div className={cn('h-full', BAND_CLASS[heatBand(score)])} style={{ width: `${score}%` }} />
      </div>
      <Num className="font-cond text-[13px] text-neutral-500">{score}</Num>
    </div>
  );
}

export function OverdueChip({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <Tag tone={days > 7 ? 'critical' : 'warning'}>
      <Num>{days}</Num>
      <span className="ms-1">D late</span>
    </Tag>
  );
}

/**
 * A task title is always a link to its card — every data point drills down.
 * Mirrored ClickUp tasks additionally expose a jump-out link.
 */
export function TaskTitleLink({
  id,
  title,
  clickupUrl,
}: {
  id: string;
  title: string;
  clickupUrl?: string | null;
}) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <Link href={`/tasks/${id}`} className="font-cond text-[17px] text-neutral-900 hover:text-accent">
        {title}
      </Link>
      {clickupUrl ? (
        <a
          href={clickupUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500 hover:text-accent"
          title="Open in ClickUp"
        >
          Clickup ↗
        </a>
      ) : null}
    </span>
  );
}
