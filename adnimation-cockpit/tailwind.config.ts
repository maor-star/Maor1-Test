import type { Config } from 'tailwindcss';

/**
 * Tokens mirror the Adnimation design package (adnimation_ui_design). Borders
 * are 1px hairlines in one colour; corners are rounded in the five sizes the
 * package names, and there are no shadows anywhere except the selected option
 * of a segmented control.
 *
 * Every colour goes through `alpha()`. A theme colour given to Tailwind as a
 * bare `var(--x)` silently loses its opacity modifier: `bg-accent-500/70`
 * compiles to nothing at all, and the element renders transparent. That is how
 * the seat map shipped invisible — coloured tiles with dark text on a dark
 * ground. Wrapping each token in `color-mix` and letting Tailwind substitute
 * `<alpha-value>` makes the modifier work, and leaves the plain class
 * unchanged (Tailwind passes 1 when there is no modifier).
 */
const alpha = (token: string) =>
  `color-mix(in srgb, var(${token}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-barlow)', 'system-ui', 'sans-serif'],
        /*
         * One text family and one figure family, as the package specifies.
         * `cond` and `semi` are the old system's display and label faces; both
         * are Barlow now, because the figures they used to carry are set in
         * mono by <Num> rather than by the class on their container.
         */
        cond: ['var(--font-barlow)', 'system-ui', 'sans-serif'],
        semi: ['var(--font-barlow)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        paper: alpha('--paper'),
        ground: alpha('--color-bg'),
        surface: alpha('--color-surface'),
        ink: alpha('--color-text'),
        divider: 'var(--color-divider)',
        border: 'var(--color-divider)',
        neutral: {
          100: alpha('--color-neutral-100'), 200: alpha('--color-neutral-200'),
          300: alpha('--color-neutral-300'), 400: alpha('--color-neutral-400'),
          500: alpha('--color-neutral-500'), 600: alpha('--color-neutral-600'),
          700: alpha('--color-neutral-700'), 800: alpha('--color-neutral-800'),
          900: alpha('--color-neutral-900'),
        },
        accent: {
          DEFAULT: alpha('--color-accent'),
          100: alpha('--color-accent-100'), 200: alpha('--color-accent-200'),
          300: alpha('--color-accent-300'), 400: alpha('--color-accent-400'),
          500: alpha('--color-accent-500'), 600: alpha('--color-accent-600'),
          700: alpha('--color-accent-700'), 800: alpha('--color-accent-800'),
          900: alpha('--color-accent-900'),
        },
        brand: alpha('--brand'),
        pos: { DEFAULT: alpha('--pos'), tint: alpha('--pos-tint') },
        neg: { DEFAULT: alpha('--neg'), tint: alpha('--neg-tint') },
        info: alpha('--info'),
        warn: alpha('--warn'),
        muted: alpha('--muted'),
        line: 'var(--line)',
        card: alpha('--card'),
        tile: {
          rose: { from: 'var(--tile-rose-from)', to: 'var(--tile-rose-to)', line: 'var(--tile-rose-line)', icon: 'var(--tile-rose-icon)' },
          blue: { from: 'var(--tile-blue-from)', to: 'var(--tile-blue-to)', line: 'var(--tile-blue-line)', icon: 'var(--tile-blue-icon)' },
          violet: { from: 'var(--tile-violet-from)', to: 'var(--tile-violet-to)', line: 'var(--tile-violet-line)', icon: 'var(--tile-violet-icon)' },
          pink: { from: 'var(--tile-pink-from)', to: 'var(--tile-pink-to)', line: 'var(--tile-pink-line)', icon: 'var(--tile-pink-icon)' },
          amber: { from: 'var(--tile-amber-from)', to: 'var(--tile-amber-to)', line: 'var(--tile-amber-line)', icon: 'var(--tile-amber-icon)' },
          teal: { from: 'var(--tile-teal-from)', to: 'var(--tile-teal-to)', line: 'var(--tile-teal-line)', icon: 'var(--tile-teal-icon)' },
          orange: { from: 'var(--tile-orange-from)', to: 'var(--tile-orange-to)', line: 'var(--tile-orange-line)', icon: 'var(--tile-orange-icon)' },
        },
        sev: {
          critical: alpha('--sev-critical'),
          warning: alpha('--sev-warning'),
          watch: alpha('--sev-watch'),
          ok: alpha('--sev-ok'),
        },
      },
      /* The package's five radii, plus the pill. */
      borderRadius: {
        DEFAULT: '12px', none: '0', sm: '9px', md: '10px', lg: '12px',
        xl: '14px', '2xl': '16px', full: '999px',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      spacing: { rail: '248px' },
    },
  },
  plugins: [],
};

export default config;
