import * as React from 'react';
import { cn } from '@/lib/utils';

/** 9px radius, hairline, white — the package's field. */
const FIELD =
  'w-full rounded-[9px] border border-line bg-card px-3 py-2 text-[14.5px] text-ink placeholder:text-neutral-500 disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref} className={cn(FIELD, 'h-[38px]', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(FIELD, 'min-h-20', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(FIELD, 'h-[38px] w-auto', className)} {...props} />
));
Select.displayName = 'Select';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('hud-label block text-[11.5px]', className)} {...props} />
));
Label.displayName = 'Label';
