import { cn } from '@/lib/utils';

/**
 * A card, as the design package draws one: white, a single 1px hairline, a
 * 14px radius, and nothing else — no corner marks, no shadow, no inset
 * highlight. `hud-card` carries the surface; `hud-marks` is kept as a name the
 * screens already use and now draws nothing, which is the point.
 */
export function HudCard({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('hud-card flex min-w-0 flex-col gap-3 p-[20px]', className)} {...props}>
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
  /**
   * The old system's section number ("S01"). The package has no such marks, so
   * it is accepted and not drawn rather than removed from forty call sites.
   */
  index?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  void index;
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <h2 className="hud-heading text-[21px]">{title}</h2>
      {action ? <div className="flex items-center gap-3">{action}</div> : null}
    </div>
  );
}

/** Uppercase tracked technical label. */
export function HudLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('hud-label text-[12px]', className)}>{children}</span>;
}

/**
 * The status dot.
 *
 * Solid, not blinking: nothing in this design moves on its own, and a dot that
 * pulses in the corner of every screen is a thing to stop noticing.
 */
export function Led({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full bg-pos', className)}
      aria-hidden="true"
    />
  );
}
