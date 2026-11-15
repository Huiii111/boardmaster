import type { Config } from 'tailwindcss';

/**
 * Tailwind theme is the single source of truth for the design tokens documented
 * in DESIGN_SYSTEM.md. Keep the two in sync when editing.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: '#070a0e',
          900: '#0b0f14',
          850: '#101620',
          800: '#151c26',
          750: '#1b2430',
          700: '#232e3c',
          600: '#2e3c4d',
          500: '#44566b',
          400: '#5d7490',
        },
        ink: {
          100: '#eef4fb',
          200: '#cfdbe8',
          300: '#a6b6c8',
          400: '#7c8da2',
          500: '#5b6c81',
        },
        electric: {
          400: '#43b9ff',
          500: '#1b9dfb',
          600: '#0b7fd4',
        },
        cyanx: {
          300: '#7af0e4',
          400: '#2fe0cf',
          500: '#12c4b4',
        },
        signal: {
          ok: '#34d399',
          warn: '#fbbf24',
          err: '#f87171',
          info: '#60a5fa',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xs: '3px',
        sm: '5px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -12px rgba(0,0,0,0.8)',
        glow: '0 0 0 1px rgba(47,224,207,0.4), 0 0 20px -4px rgba(47,224,207,0.35)',
        inset: 'inset 0 1px 2px rgba(0,0,0,0.6)',
      },
      transitionTimingFunction: {
        lab: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
export default config;
