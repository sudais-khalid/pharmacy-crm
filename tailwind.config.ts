import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#effaf8", 100: "#d3f3ee", 200: "#a9e6dd", 300: "#76d2c7", 400: "#45b8ad", 500: "#2a9d93", 600: "#1f7f78", 700: "#1d6560", 800: "#1c514e", 900: "#1b4543" },
      },
    },
  },
  plugins: [],
};
export default config;
