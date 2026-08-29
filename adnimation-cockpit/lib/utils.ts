import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatInTimeZone } from 'date-fns-tz';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Everything is stored UTC and rendered Asia/Jerusalem (CLAUDE.md §10). */
export const TZ = 'Asia/Jerusalem';

export const fmtTime = (d: Date) => formatInTimeZone(d, TZ, 'HH:mm');
export const fmtDate = (d: Date) => formatInTimeZone(d, TZ, 'dd/MM/yyyy');
export const fmtDateTime = (d: Date) => formatInTimeZone(d, TZ, 'dd/MM/yyyy HH:mm');

/** Today in Asia/Jerusalem as YYYY-MM-DD — the boundary every "due today" uses. */
export const todayInTz = (now = new Date()) => formatInTimeZone(now, TZ, 'yyyy-MM-dd');

/** Money is stored in cents; render as whole dollars unless it is a small figure. */
export function fmtMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: dollars >= 1000 ? 0 : 2,
  }).format(dollars);
}

export const fmtNumber = (n: number) => new Intl.NumberFormat('en-US').format(n);

/** Hebrew plural-friendly day counter: "היום", "אתמול", "לפני 3 ימים". */
export function relativeDays(days: number): string {
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  return `לפני ${days} ימים`;
}
