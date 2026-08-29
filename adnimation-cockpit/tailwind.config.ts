import type { Config } from 'tailwindcss';

/**
 * Tokens mirror the dark HUD design handoff. Radius is 0 by system rule and
 * borders are 1px hairlines; both are enforced in globals.css as well.
 */
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
        paper: 'var(--paper)',
        ground: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        ink: 'var(--color-text)',
        divider: 'var(--color-divider)',
        border: 'var(--color-divider)',
        neutral: {
          100: 'var(--color-neutral-100)', 200: 'var(--color-neutral-200)',
          300: 'var(--color-neutral-300)', 400: 'var(--color-neutral-400)',
          500: 'var(--color-neutral-500)', 600: 'var(--color-neutral-600)',
          700: 'var(--color-neutral-700)', 800: 'var(--color-neutral-800)',
          900: 'var(--color-neutral-900)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          100: 'var(--color-accent-100)', 200: 'var(--color-accent-200)',
          300: 'var(--color-accent-300)', 400: 'var(--color-accent-400)',
          500: 'var(--color-accent-500)', 600: 'var(--color-accent-600)',
          700: 'var(--color-accent-700)', 800: 'var(--color-accent-800)',
          900: 'var(--color-accent-900)',
        },
        sev: {
          critical: 'var(--sev-critical)',
          warning: 'var(--sev-warning)',
          watch: 'var(--sev-watch)',
          ok: 'var(--sev-ok)',
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
