import type { Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";

/** Semantic colour from a CSS variable holding "R G B" channels, so opacity modifiers (bg-primary/90) work. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design tokens (docs/plan/04-ui-ux.md, section 2.2). Values live in globals.css for light and dark.
        bg: token("bg"),
        surface: token("surface"),
        muted: token("muted"),
        fg: { DEFAULT: token("fg"), muted: token("fg-muted") },
        border: token("border"),
        primary: token("primary"),
        "on-primary": token("on-primary"),
        success: token("success"),
        warning: token("warning"),
        danger: token("danger"),
        info: token("info"),
        ring: token("ring"),
        // Brand scale kept for existing screens; new code should prefer the tokens above.
        brand: { 50: "#effaf8", 100: "#d3f3ee", 200: "#a9e6dd", 300: "#76d2c7", 400: "#45b8ad", 500: "#2a9d93", 600: "#1f7f78", 700: "#1d6560", 800: "#1c514e", 900: "#1b4543" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...fontFamily.sans],
        mono: ["var(--font-mono)", ...fontFamily.mono],
      },
      transitionDuration: { DEFAULT: "150ms" },
    },
  },
  plugins: [],
};
export default config;
