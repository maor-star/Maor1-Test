'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Type to find it, on every screen that lists anything.
 *
 * The query lives in the URL, so a search is shareable, survives a reload, and
 * composes with whatever filter is already on — typing never silently drops
 * the view he was in.
 *
 * Typing is debounced rather than requiring Enter: a list that narrows as he
 * types is the point, and a round trip per keystroke is not. Escape clears it,
 * and "/" from anywhere on the page puts the cursor here, because a search box
 * he has to reach for with the mouse is one he stops using.
 */
export function SearchBox({
  placeholder = 'Type to find',
  param = 'q',
  className = '',
  /**
   * `lg` is for the screens he searches rather than skims — tasks and the
   * pipeline, where the box sits at the top of the page and is the first thing
   * he reaches for. Everywhere else it is one control among several in a card
   * header, and a large box there would shout over the numbers beside it.
   */
  size = 'sm',
}: {
  placeholder?: string;
  param?: string;
  className?: string;
  size?: 'sm' | 'lg';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = params.get(param) ?? '';

  const [value, setValue] = useState(fromUrl);
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLInputElement>(null);

  // The URL is the truth: a back button or a cleared filter must show here.
  useEffect(() => setValue(fromUrl), [fromUrl]);

  useEffect(() => {
    if (value === fromUrl) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set(param, value.trim());
      else next.delete(param);
      const query = next.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
    }, 220);
    return () => clearTimeout(timer);
  }, [value, fromUrl, param, params, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typingElsewhere =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (e.key === '/' && !typingElsewhere) {
        e.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`relative ${className}`}>
      <input
        ref={box}
        type="search"
        value={value}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue('');
            box.current?.blur();
          }
        }}
        className={
          size === 'lg'
            ? 'h-[42px] w-full rounded-full border border-line bg-card ps-4 pe-16 text-[15.5px] text-ink placeholder:text-neutral-500'
            : 'h-[38px] w-full rounded-full border border-line bg-card ps-4 pe-14 text-[14.5px] text-ink placeholder:text-neutral-500 sm:w-64'
        }
      />
      <span
        className={`pointer-events-none absolute inset-y-0 end-3 flex items-center font-mono text-[12px] ${
          pending ? 'text-info' : 'text-muted'
        }`}
      >
        <span className="rounded-md bg-neutral-200 px-[7px] py-[3px]">
          {pending ? 'finding' : value ? 'esc' : '/'}
        </span>
      </span>
    </div>
  );
}
