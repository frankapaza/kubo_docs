/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        kubo: {
          // Paleta «Océano»: los mismos valores que las variables --k-* de index.css.
          primary: '#0E7490',
          'primary-dark': '#0B5A70',
          'primary-light': '#E0F2F5',
          accent: '#14B8A6',
          'accent-light': '#CCF1EC',
          surface: '#F3F7F9',
          'surface-2': '#EAF0F3',
          ink: '#10232F',
          muted: '#566672',
          nav: '#0F2A3D',
          'nav-active': '#1C4560',
          'nav-text': '#D6E4EC',
          'nav-muted': '#8AA3B3',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)',
        pop: '0 10px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.08)',
      },
      borderRadius: {
        xl: '0.875rem',
      },
      keyframes: {
        toastIn: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
