import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Num } from '@/components/num';
import { heatBand } from '@/lib/scoring/heat-score';
import { PRIORITY_META, STATUS_LABEL, type TaskPriority, type TaskStatus } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';

const PRIORITY_VARIANT: Record<TaskPriority, 'critical' | 'warning' | 'watch' | 'default'> = {
  P0: 'critical',
  P1: 'warning',
  P2: 'watch',
  P3: 'default',
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <Badge variant={PRIORITY_VARIANT[priority]} title={PRIORITY_META[priority].sla}>
      <Num>{priority}</Num>
      <span className="ms-1">{PRIORITY_META[priority].label}</span>
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status as TaskStatus] ?? status;
  return <Badge variant={status === 'done' ? 'ok' : 'outline'}>{label}</Badge>;
}

const BAND_CLASS = {
  burning: 'bg-sev-critical',
  hot: 'bg-sev-warning',
  warm: 'bg-sev-watch',
  cool: 'bg-muted-foreground/40',
} as const;

/** Heat score as a compact bar — the number and its band in one glance. */
export function HeatBar({ score }: { score: number }) {
  const band = heatBand(score);
  return (
    <div className="flex items-center gap-1.5" title={`Heat Score ${score}`}>
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', BAND_CLASS[band])} style={{ width: `${score}%` }} />
      </div>
      <Num className="text-2xs text-muted-foreground">{score}</Num>
    </div>
  );
}

/** Days overdue, as the cockpit shows it: red once it is late. */
export function OverdueChip({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <Badge variant={days > 7 ? 'critical' : 'warning'}>
      <Num>{days}</Num>
      <span className="ms-1">ימים באיחור</span>
    </Badge>
  );
}

/**
 * A task title is always a link to its card — every data point drills down (§7).
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
    <span className="inline-flex items-center gap-1.5">
      <Link href={`/tasks/${id}`} className="font-medium hover:underline">
        {title}
      </Link>
      {clickupUrl ? (
        <a
          href={clickupUrl}
          target="_blank"
          rel="noreferrer"
          className="text-2xs text-muted-foreground hover:underline"
          title="פתיחה ב-ClickUp"
        >
          ClickUp ↗
        </a>
      ) : null}
    </span>
  );
}
