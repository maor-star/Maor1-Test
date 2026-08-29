import type { Config } from 'tailwindcss';

/**
 * Tokens mirror the dark HUD design handoff. Radius is 0 by system rule and
 * borders are 1px hairlines; both are enforced in globals.css as well.
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
        cond: ['var(--font-barlow-condensed)', 'var(--font-barlow)', 'sans-serif'],
        semi: ['var(--font-barlow-semi)', 'var(--font-barlow)', 'sans-serif'],
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
        sev: {
          critical: alpha('--sev-critical'),
          warning: alpha('--sev-warning'),
          watch: alpha('--sev-watch'),
          ok: alpha('--sev-ok'),
        },
      },
      borderRadius: { DEFAULT: '0', none: '0', sm: '0', md: '0', lg: '0', xl: '0', full: '0' },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      spacing: { rail: '248px' },
    },
  },
  plugins: [],
};

export default config;
