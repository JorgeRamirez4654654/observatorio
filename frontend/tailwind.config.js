/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Libre Baskerville"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Light palette
        canvas: '#F7F9FC',
        sidebar: '#1E2D40',
        accent: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
          soft: '#EFF6FF',
        },
        ink: {
          900: '#0F172A',
          800: '#1F2937',
          600: '#4B5563',
          500: '#6B7280',
          400: '#9CA3AF',
        },
        line: '#E5E7EB',
        // Dark palette
        'd-canvas': '#0F1923',
        'd-sidebar': '#111B27',
        'd-card': '#1A2535',
        'd-line': '#243245',
        'd-text': '#F1F5F9',
        'd-muted': '#94A3B8',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)',
        'card-hover': '0 4px 10px -2px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.06)',
        focus: '0 0 0 3px rgba(37, 99, 235, 0.18)',
      },
      borderRadius: {
        xl2: '14px',
      },
    },
  },
  plugins: [],
}
