import { cn } from '@/lib/utils';

/**
 * Figures, currency, dates and ad-tech identifiers render LTR with tabular
 * numerals so columns align. Kept as a component so the rule is applied in one
 * place rather than remembered at every call site.
 */
export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn('ltr-num', className)}>
      {children}
    </span>
  );
}
