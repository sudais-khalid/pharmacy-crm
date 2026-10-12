import localFont from "next/font/local";

/*
 * Self-hosted from @fontsource (latin subset), so builds and the desktop app never need Google Fonts.
 * Fira Sans for UI text, Fira Code for codes and numbers (docs/plan/04-ui-ux.md, section 2.3).
 */
export const sans = localFont({
  variable: "--font-sans",
  display: "swap",
  src: [
    { path: "../../node_modules/@fontsource/fira-sans/files/fira-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/fira-sans/files/fira-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../node_modules/@fontsource/fira-sans/files/fira-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/fira-sans/files/fira-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const mono = localFont({
  variable: "--font-mono",
  display: "swap",
  src: [
    { path: "../../node_modules/@fontsource/fira-code/files/fira-code-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/fira-code/files/fira-code-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});
