import { cn } from '@/lib/utils';

type Tone = 'accent' | 'neutral' | 'outline' | 'critical' | 'warning' | 'watch' | 'ok';

/**
 * The status pill from the design package: fully rounded, a tinted ground, no
 * border, 12px/700 with a little tracking. Severity carries its own tint —
 * green for good, red for bad, orange for a warning — rather than a coloured
 * outline on a white pill, which reads as decoration rather than a state.
 */
const TONE: Record<Tone, string> = {
  accent: 'bg-accent-100 text-accent-800',
  neutral: 'bg-neutral-200 text-neutral-700',
  outline: 'border border-line text-muted',
  critical: 'bg-neg-tint text-neg',
  warning: 'bg-[#fdf1e4] text-[#b45309]',
  watch: 'bg-[#fdf6e6] text-[#a16207]',
  ok: 'bg-pos-tint text-[#157a45]',
};

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
        'inline-flex items-center rounded-full px-3 py-[5px] text-[12px] font-bold uppercase leading-none tracking-[0.06em]',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
