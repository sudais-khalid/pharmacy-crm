import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/**
 * Prepares a phone photo of a bill for Tesseract (pure JavaScript, so it runs the same in Docker and in
 * the Windows app). Tesseract's own binarisation uses one threshold for the whole page, which loses the
 * dark heading bars and grey-shaded columns that distributor invoices print. Here:
 *
 *   1. grayscale, and enlarge small photos so table text is tall enough to read;
 *   2. adaptive threshold (Bradley): each pixel is compared with the mean of its neighbourhood, so shadows
 *      and shaded cells drop out; in dark regions the test is inverted, so white text on a dark bar becomes
 *      black on white like the rest of the page;
 *   3. rotate by quarter turns (the caller tries another turn when a page reads badly).
 */
export type Gray = { width: number; height: number; data: Uint8Array };

export function decode(data: Buffer, mime: string): Gray | null {
  try {
    let width: number, height: number, rgba: Uint8Array;
    if (mime === "image/jpeg") ({ width, height, data: rgba } = jpeg.decode(data, { useTArray: true, maxMemoryUsageInMB: 512 }));
    else if (mime === "image/png") ({ width, height, data: rgba } = PNG.sync.read(data));
    else return null; // WebP and others go to Tesseract as they are
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    return { width, height, data: gray };
  } catch {
    return null;
  }
}

/** Bilinear enlargement so the longer side is about `target` pixels (never shrinks). */
export function enlarge(img: Gray, target = 2600): Gray {
  const scale = target / Math.max(img.width, img.height);
  if (scale <= 1.1) return img;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, (x + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const fx = sx - x0;
      const a = img.data[y0 * img.width + x0], b = img.data[y0 * img.width + x1];
      const c = img.data[y1 * img.width + x0], d = img.data[y1 * img.width + x1];
      out[y * w + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return { width: w, height: h, data: out };
}

/** Bradley adaptive threshold with inversion in dark regions. Output is 0 (ink) or 255 (paper). */
export function binarize(img: Gray, t = 0.15): Gray {
  const { width: w, height: h, data } = img;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.max(w, h) / 50));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const sum = integral[yb * (w + 1) + xb] - integral[ya * (w + 1) + xb] - integral[yb * (w + 1) + xa] + integral[ya * (w + 1) + xa];
      const mean = sum / ((xb - xa) * (yb - ya));
      const v = data[y * w + x];
      // light text on a dark bar is ink too
      const ink = mean < 100 ? v > mean * (1 + t) + 20 : v < mean * (1 - t);
      out[y * w + x] = ink ? 0 : 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** Mean of each pixel's neighbourhood (a box rx wide, ry high), from an integral image. */
function boxMean(img: Gray, rx: number, ry: number): Float32Array {
  const { width: w, height: h, data } = img;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - ry), yb = Math.min(h, y + ry + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - rx), xb = Math.min(w, x + rx + 1);
      out[y * w + x] = (integral[yb * (w + 1) + xb] - integral[ya * (w + 1) + xb] - integral[yb * (w + 1) + xa] + integral[ya * (w + 1) + xa]) / ((xb - xa) * (yb - ya));
    }
  }
  return out;
}

/**
 * Turns light-on-dark heading bars into dark-on-light. A wide, flat window finds them: across a bar
 * the average is dark, while a line of ordinary text stays light because ink covers little of it.
 */
export function invertBars(img: Gray): Gray {
  // "dark" is relative to this photo's paper: a grey bar in a dim photo counts, a shadow does not
  const hist = new Uint32Array(256);
  for (const v of img.data) hist[v]++;
  let acc = 0, paper = 255;
  for (; paper > 0; paper--) { acc += hist[paper]; if (acc >= img.data.length * 0.3) break; }
  const limit = Math.min(140, paper * 0.62);
  // a bar spans much of the table; a bold title word is far narrower than this window
  const mean = boxMean(img, Math.round(img.width / 5), Math.max(2, Math.round(img.height / 250)));
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = mean[i] < limit ? 255 - img.data[i] : img.data[i];
  return { ...img, data: out };
}

/**
 * Evens out lighting and shaded cells: each pixel is divided by the paper brightness around it (the
 * brightest values in its block, smoothed), so the paper becomes white and faint print stays visible.
 */
export function flatten(img: Gray, block = 24): Gray {
  const { width: w, height: h, data } = img;
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block);
  const bright = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      // the 90th percentile rather than the maximum, so a speck of glare does not count as paper
      const hist = new Uint32Array(256);
      let n = 0;
      for (let y = by * block; y < Math.min(h, (by + 1) * block); y++) for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x++) { hist[data[y * w + x]]++; n++; }
      let acc = 0, v = 255;
      for (; v > 0; v--) { acc += hist[v]; if (acc >= n * 0.1) break; }
      bright[by * bw + bx] = v;
    }
  }
  // spread the paper level over neighbouring blocks (text-only blocks have no paper of their own)
  const level = boxMean({ width: bw, height: bh, data: bright }, 2, 2);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / block - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / block - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      const bg = (level[y0 * bw + x0] * (1 - tx) + level[y0 * bw + x1] * tx) * (1 - ty) + (level[y1 * bw + x0] * (1 - tx) + level[y1 * bw + x1] * tx) * ty;
      out[y * w + x] = Math.min(255, Math.round((data[y * w + x] * 255) / Math.max(40, bg)));
    }
  }
  return { width: w, height: h, data: out };
}

/** Quarter turns clockwise (1 = 90 degrees). */
export function rotate(img: Gray, turns: number): Gray {
  const q = ((turns % 4) + 4) % 4;
  if (q === 0) return img;
  const { width: w, height: h, data } = img;
  const nw = q === 2 ? w : h;
  const nh = q === 2 ? h : w;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [nx, ny] = q === 1 ? [h - 1 - y, x] : q === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      out[ny * nw + nx] = data[y * w + x];
    }
  }
  return { width: nw, height: nh, data: out };
}

export function encodePng(img: Gray): Buffer {
  const png = new PNG({ width: img.width, height: img.height, colorType: 0, inputColorType: 0, inputHasAlpha: false });
  png.data = Buffer.from(img.data);
  return PNG.sync.write(png, { colorType: 0, inputColorType: 0, inputHasAlpha: false });
}

/** A box found on a turned page, as fractions of the photo as it was uploaded (for the review screen). */
export function unrotateBox(b: { x: number; y: number; w: number; h: number }, turns: number) {
  const q = ((turns % 4) + 4) % 4;
  if (q === 1) return { x: b.y, y: 1 - b.x - b.w, w: b.h, h: b.w };
  if (q === 2) return { x: 1 - b.x - b.w, y: 1 - b.y - b.h, w: b.w, h: b.h };
  if (q === 3) return { x: 1 - b.y - b.h, y: b.x, w: b.h, h: b.w };
  return b;
}

/**
 * Removes table rules: runs of dark pixels much longer than any letter, across (a quarter of a cell row
 * wide) or down. Tesseract otherwise reads boxed cells as separate blocks and loses the row order.
 */
export function removeRules(img: Gray): Gray {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(data);
  const dark = (v: number) => v < 140;
  const minH = Math.round(w / 25), minV = Math.round(h / 40);
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && dark(data[y * w + x])) { if (start < 0) start = x; }
      else if (start >= 0) { if (x - start >= minH) for (let k = start; k < x; k++) out[y * w + k] = 255; start = -1; }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      if (y < h && dark(data[y * w + x])) { if (start < 0) start = y; }
      else if (start >= 0) { if (y - start >= minV) for (let k = start; k < y; k++) out[k * w + x] = 255; start = -1; }
    }
  }
  return { width: w, height: h, data: out };
}

/** The cleanup used before reading (PCRM_OCR_STEPS lets the accuracy script compare variants). */
export function cleanForOcr(gray: Gray): Gray {
  const steps = (process.env.PCRM_OCR_STEPS ?? "enlarge,bars,flatten,rules").split(",");
  let img = gray;
  for (const step of steps) {
    if (step === "enlarge") img = enlarge(img, Number(process.env.PCRM_OCR_SIZE ?? 2600));
    else if (step === "bars") img = invertBars(img);
    else if (step === "flatten") img = flatten(img);
    else if (step === "binarize") img = binarize(img);
    else if (step === "rules") img = removeRules(img);
  }
  return img;
}
