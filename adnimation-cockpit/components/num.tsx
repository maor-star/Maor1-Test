import { cn } from '@/lib/utils';

/**
 * Numbers, currency, dates and ad-tech identifiers render LTR inside RTL
 * paragraphs (CLAUDE.md §7). Every figure in the app goes through this.
 */
export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn('ltr-num', className)}>
      {children}
    </span>
  );
}
