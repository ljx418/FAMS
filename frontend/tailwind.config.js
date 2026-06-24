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
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d4ff',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        success: {
          DEFAULT: '#34d399',
          light: '#6ee7b7',
          dark: '#059669',
        },
        danger: {
          DEFAULT: '#f87171',
          light: '#fca5a5',
          dark: '#dc2626',
        },
        warning: {
          DEFAULT: '#fbbf24',
          light: '#fcd34d',
          dark: '#d97706',
        },
        info: {
          DEFAULT: '#38bdf8',
          light: '#7dd3fc',
          dark: '#0284c7',
        },
        surface: {
          primary: '#0f0f23',
          secondary: '#1a1a2e',
          tertiary: '#1f1f3a',
          hover: '#252545',
          border: '#2a2a4e',
        },
      },
      fontFamily: {
        sans: ["'PingFang SC'", "'Microsoft YaHei'", 'sans-serif'],
      },
    },
  },
  plugins: [],
}
