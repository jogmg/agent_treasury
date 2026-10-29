/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Accent alias for border/text utilities. Primary backgrounds use the
        // literal brand blue so previews that ignore this config still match.
        emerald: {
          100: "#dce7f3",
          200: "#c4d5e8",
          300: "#96ADC8",
          400: "#4F75A0",
          500: "#083D77",
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
