/**
 * The app icon, drawn in code so the repository holds no binary images: a teal rounded square with a
 * white cross. Returns RGBA pixels. The window and tray use it directly; scripts/icon.mjs turns it into
 * the PNG the installer build converts to an .ico file.
 */
export const TEAL = { r: 0x1f, g: 0x7f, b: 0x78 };

export function iconPixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = size * 0.2;
  const arm = size * 0.14;
  const reach = size * 0.3;
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x - c) - (c - radius));
      const dy = Math.max(0, Math.abs(y - c) - (c - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      const cross = (Math.abs(x - c) <= arm && Math.abs(y - c) <= reach) || (Math.abs(y - c) <= arm && Math.abs(x - c) <= reach);
      const i = (y * size + x) * 4;
      const [r, g, b] = cross ? [255, 255, 255] : [TEAL.r, TEAL.g, TEAL.b];
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return buf;
}
