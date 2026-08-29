import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Square, hairline, uppercase-tracked — the design system's button. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semi uppercase tracking-[0.16em] transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-ground hover:bg-accent-600',
        outline: 'border border-divider text-neutral-700 hover:border-accent hover:text-accent',
        ghost: 'text-neutral-500 hover:text-accent',
        destructive: 'border border-sev-critical/60 text-sev-critical hover:bg-sev-critical/10',
        link: 'text-accent-700 hover:text-accent',
      },
      size: {
        default: 'px-[13px] py-2 text-[11px]',
        sm: 'px-[10px] py-1.5 text-[10px]',
        xs: 'px-2 py-1 text-[10px]',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
