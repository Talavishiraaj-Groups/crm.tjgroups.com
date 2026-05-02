/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'tj-black': '#161616',
        'tj-surface': '#DFDFDF',
        'tj-bg': '#F9F9F9',
        'tj-border': 'rgba(22, 22, 22, 0.1)',
      },
      fontFamily: {
        sans: ['Roboto', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'tj': '6px',
      },
    },
  },
  plugins: [],
}
