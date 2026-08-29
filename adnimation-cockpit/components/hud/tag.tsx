import { cn } from '@/lib/utils';

type Tone = 'accent' | 'neutral' | 'outline' | 'critical' | 'warning' | 'watch' | 'ok';

const TONE: Record<Tone, string> = {
  accent: 'bg-accent-100 text-accent-800 border border-transparent',
  neutral: 'bg-neutral-200 text-neutral-700 border border-transparent',
  outline: 'border border-divider text-neutral-600',
  critical: 'border border-sev-critical/60 text-sev-critical',
  warning: 'border border-sev-warning/60 text-sev-warning',
  watch: 'border border-sev-watch/60 text-sev-watch',
  ok: 'bg-accent-100 text-accent-800 border border-transparent',
};

/** Status pill. Square, hairline, uppercase — per the design system. */
export function Tag({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center px-[7px] py-[3px] font-semi text-[10px] font-medium uppercase leading-none tracking-[0.12em]',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
