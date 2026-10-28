/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        emerald: {
          100: "#dce7f3",
          200: "#c4d5e8",
          300: "#96ADC8",
          400: "#4F75A0",
          500: "#083D77",
          600: "#062f5c",
          700: "#052546",
          800: "#0A0E11",
          900: "#070b0e",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        body: ["DM Sans", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
