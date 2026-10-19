/**
 * A pharmacy's brand colour (docs/plan/05-roadmap.md, task 3.6): one hex colour becomes the brand palette
 * (brand-50 to brand-900) and the primary tokens, for light and dark mode. Contrast is checked against
 * WCAG 2.2: the colour must stand out on white (3:1, as for buttons and links), and button text uses
 * white or near-black, whichever reads better (at least 4.5:1).
 */
export type Rgb = [number, number, number];
export const BRAND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [15, 23, 42]; // --fg, near-black

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const toHex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const channels = (c: Rgb) => c.join(" ");

/** WCAG relative luminance and contrast ratio. */
function luminance([r, g, b]: Rgb) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Rgb;

/** The brand scale with the chosen colour as 600, lighter shades towards white, darker towards black. */
export function palette(base: Rgb): Record<(typeof BRAND_SHADES)[number], Rgb> {
  const black: Rgb = [0, 0, 0];
  return {
    50: mix(base, WHITE, 0.94), 100: mix(base, WHITE, 0.84), 200: mix(base, WHITE, 0.68), 300: mix(base, WHITE, 0.5), 400: mix(base, WHITE, 0.3),
    500: mix(base, WHITE, 0.12), 600: base, 700: mix(base, black, 0.18), 800: mix(base, black, 0.32), 900: mix(base, black, 0.44),
  };
}

/** Text colour for a filled button in this colour: white or near-black, whichever contrasts more. */
export function onColor(c: Rgb): Rgb {
  return contrast(c, WHITE) >= contrast(c, INK) ? WHITE : INK;
}

/** Why a colour cannot be used, or null when it can. */
export function brandColorProblem(hex: string): string | null {
  const c = parseHex(hex);
  if (!c) return "Use a colour code like #1F7F78.";
  if (contrast(c, WHITE) < 3) return `This colour is too light to read on white (contrast ${contrast(c, WHITE).toFixed(1)}:1, at least 3:1 is needed). Choose a darker shade.`;
  if (contrast(c, onColor(c)) < 4.5) return "Text on buttons in this colour would be hard to read. Choose a darker or lighter shade.";
  return null;
}

/** CSS that applies the colour to the brand palette and primary tokens, in light and dark mode. */
export function brandCss(hex: string): string | null {
  const c = parseHex(hex);
  if (!c || brandColorProblem(hex)) return null;
  const p = palette(c);
  const scale = BRAND_SHADES.map((s) => `--brand-${s}: ${channels(p[s])};`).join(" ");
  // dark mode uses a lighter shade so it stands out on the dark surface
  return `:root { ${scale} --primary: ${channels(p[600])}; --on-primary: ${channels(onColor(p[600]))}; --ring: ${channels(p[600])}; }
.dark { --primary: ${channels(p[400])}; --on-primary: ${channels(onColor(p[400]))}; }`;
}
