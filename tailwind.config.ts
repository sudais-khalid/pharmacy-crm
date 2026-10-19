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
        // Brand scale, also variables: a pharmacy's brand colour replaces it (src/lib/brand.ts)
        brand: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, token(`brand-${s}`)])),
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
