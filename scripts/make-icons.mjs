// Draws the app icons for the installable staff app (roadmap 9.5) into public/icons: the same teal tile and
// white cross as the desktop icon, at the sizes browsers ask for, plus a "maskable" one that fills the whole
// square (phones cut it to a circle or a rounded shape). Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const TEAL = [31, 127, 120];
const WHITE = [255, 255, 255];

function draw(size, { maskable }) {
  const png = new PNG({ width: size, height: size });
  const radius = maskable ? 0 : size * 0.18;
  // the cross: arms a third of the tile wide, inside the safe zone for maskable icons
  const reach = maskable ? 0.3 : 0.36;
  const arm = maskable ? 0.12 : 0.15;
  const c = size / 2;
  const inside = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
    const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const cross = (x, y) => (Math.abs(x - c) <= size * arm && Math.abs(y - c) <= size * reach) || (Math.abs(y - c) <= size * arm && Math.abs(x - c) <= size * reach);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 4x supersampling for smooth edges
      let tile = 0, white = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
        if (inside(px, py)) { tile++; if (cross(px, py)) white++; }
      }
      const i = (y * size + x) * 4;
      const t = tile / 16, w = tile ? white / tile : 0;
      for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(TEAL[k] * (1 - w) + WHITE[k] * w);
      png.data[i + 3] = Math.round(t * 255);
    }
  }
  return PNG.sync.write(png);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, draw(size, { maskable: false }));
writeFileSync("public/icons/maskable-512.png", draw(512, { maskable: true }));
writeFileSync("public/icons/apple-touch-icon.png", draw(180, { maskable: true }));
console.log("icons written to public/icons");
