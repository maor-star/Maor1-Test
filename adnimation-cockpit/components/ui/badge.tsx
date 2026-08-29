import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium leading-none',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        outline: 'border border-border text-foreground',
        critical: 'bg-sev-critical/12 text-sev-critical',
        warning: 'bg-sev-warning/12 text-sev-warning',
        watch: 'bg-sev-watch/15 text-sev-watch',
        ok: 'bg-sev-ok/12 text-sev-ok',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
