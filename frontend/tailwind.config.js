/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#1e3a8a',
          900: '#172554',
        },
        success: {
          DEFAULT: '#047857',
          light: '#d1fae5',
          dark: '#065f46',
        },
        danger: {
          DEFAULT: '#b91c1c',
          light: '#fee2e2',
          dark: '#991b1b',
        },
        warning: {
          DEFAULT: '#a16207',
          light: '#fef3c7',
          dark: '#854d0e',
        },
        info: {
          DEFAULT: '#0369a1',
          light: '#e0f2fe',
          dark: '#075985',
        },
        surface: {
          primary: '#f8fafc',
          secondary: '#ffffff',
          tertiary: '#f1f5f9',
          hover: '#eff6ff',
          border: '#cbd5e1',
        },
      },
      fontFamily: {
        sans: ["'PingFang SC'", "'Microsoft YaHei'", 'sans-serif'],
      },
    },
  },
  plugins: [],
}
