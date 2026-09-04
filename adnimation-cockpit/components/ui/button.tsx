import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The design package's button: a 10px radius, Barlow 600 in sentence case, and
 * colour only where it means something. The primary one is the brand mark;
 * everything else is a hairline or a plain word that fills in on hover.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:bg-accent-700',
        outline: 'border border-line bg-card text-neutral-800 hover:bg-neutral-100',
        ghost: 'text-muted hover:bg-neutral-100 hover:text-ink',
        destructive: 'bg-neg-tint text-neg hover:bg-[#fbdcdc]',
        link: 'text-info hover:underline',
      },
      size: {
        default: 'px-[15px] py-[9px] text-[14.5px]',
        sm: 'px-3 py-[7px] text-[13.5px]',
        xs: 'px-[10px] py-[5px] text-[13px]',
        icon: 'h-[38px] w-[38px]',
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
