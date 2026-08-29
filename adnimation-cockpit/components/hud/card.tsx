import { cn } from '@/lib/utils';

/**
 * The card pattern from the design handoff: square corners, 1px hairline,
 * inset highlight, deep drop shadow, and four registration crosshairs.
 * `hud-card` draws the top two marks, `hud-marks` the bottom two.
 */
export function HudCard({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('hud-card hud-marks flex min-w-0 flex-col gap-3 p-[18px]', className)} {...props}>
      {children}
    </div>
  );
}

export function HudCardHeader({
  title,
  index,
  action,
  className,
}: {
  title: React.ReactNode;
  index?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <h2 className="hud-heading text-[21px] text-neutral-900">{title}</h2>
      <div className="flex items-center gap-3">
        {action}
        {index ? (
          <span className="font-cond text-[10px] tracking-[0.16em] text-accent-700">{index}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Uppercase tracked technical label. */
export function HudLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('hud-label text-[10px]', className)}>{children}</span>;
}

/** A pulsing LED dot — used for live/status indicators. */
export function Led({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block h-[5px] w-[5px] bg-accent-300 animate-led', className)}
      aria-hidden="true"
    />
  );
}
