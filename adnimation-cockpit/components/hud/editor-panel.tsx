import { cn } from '@/lib/utils';

/**
 * The shape of an editor, in one place.
 *
 * The contracts card settled the question of what editing something looks
 * like: an uppercase caption above every control, four of them across a wide
 * screen and two on a narrow one, the long text field spanning the width at
 * the bottom, and one row underneath holding the save, the way out, and a
 * quiet line saying what saving will do.
 *
 * Tasks and deals each had their own arrangement of the same idea — a
 * different column count, labels in sentence case, the consequences of the
 * save left unsaid. They are the same idea, so they are now the same
 * components: a screen cannot drift from this without editing this file.
 */

/** How much of the row a field takes. */
type Span = 1 | 2 | 'full';

const SPAN: Record<string, string> = {
  1: '',
  2: 'sm:col-span-2',
  full: 'sm:col-span-2 xl:col-span-4',
};

/** Four fields across, two on a narrow screen. */
export function EditorGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>;
}

/**
 * One labelled control.
 *
 * The caption is a `<label>` bound to the control, so clicking the words
 * focuses the field and a screen reader reads them together — which is also
 * why every control passed in needs the `id` given here.
 */
export function EditorField({
  label,
  htmlFor,
  span = 1,
  hint,
  error,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  span?: Span;
  /** What the field does when left alone — said under it, quietly. */
  hint?: React.ReactNode;
  /** Why the save refused this one. */
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('min-w-0', SPAN[String(span)])}>
      <label htmlFor={htmlFor} className="hud-label block text-[11.5px]">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-[12px] leading-snug text-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-[12px] text-neg">{error}</p> : null}
    </div>
  );
}

/**
 * The row under the fields: the save first, the way out beside it, and what
 * the save is going to do written where he is looking when he decides.
 */
export function EditorActions({
  hint,
  children,
}: {
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {children}
      {hint ? (
        <span className="hud-label whitespace-normal text-[11.5px] tracking-[0.1em]">{hint}</span>
      ) : null}
    </div>
  );
}
