import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { sniffImage } from "@/lib/images";
import { cleanForOcr, decode, encodePng, rotate, unrotateBox, type Gray } from "./preprocess";
import type { ExtractedDocument, OcrImage, OcrLine, OcrProvider } from "./types";

/**
 * Local OCR with Tesseract (architecture, section 6.1.2): works offline, good on printed bills.
 * The engine and the English model ship with the app; nothing is downloaded. One engine is kept per
 * worker process and reused for every page. Photos are cleaned up first (preprocess.ts), and a page that
 * reads badly is tried a quarter turn either way (photos taken sideways).
 */
type TessWorker = {
  recognize: (image: Buffer, options?: object, output?: object) => Promise<{ data: TessResult }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
};
type TessBox = { x0: number; y0: number; x1: number; y1: number };
type TessResult = { blocks: { paragraphs: { lines: { text: string; confidence: number; bbox: TessBox; words: { text: string; confidence: number; bbox: TessBox }[] }[] }[] }[] | null };

let engine: Promise<TessWorker> | null = null;

/** Packages are found next to the server (desktop: its own node_modules; development: the repository's). */
const fromServer = () => createRequire(path.join(process.cwd(), "index.js"));

function start(): Promise<TessWorker> {
  engine ??= (async () => {
    const req = fromServer();
    const { createWorker } = req("tesseract.js") as { createWorker: (lang: string, oem: number, options: object) => Promise<TessWorker> };
    const langPath = process.env.TESSERACT_LANG_DIR ?? path.join(path.dirname(req.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
    const worker = await createWorker("eng", 1, { langPath, gzip: true, cachePath: path.join(os.tmpdir(), "pcrm-tesseract"), logger: () => {} });
    // keep the gaps between table columns, which the bill parser uses
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_pageseg_mode: process.env.PCRM_OCR_PSM ?? "6" });
    return worker;
  })();
  return engine;
}

type Read = { lines: OcrLine[]; score: number; flat: number };

async function readOnce(worker: TessWorker, image: Buffer, width: number, height: number, pageNo: number, turns: number): Promise<Read> {
  const box = (b: TessBox) => ({ page: pageNo, ...unrotateBox({ x: b.x0 / width, y: b.y0 / height, w: (b.x1 - b.x0) / width, h: (b.y1 - b.y0) / height }, turns) });
  const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
  const lines: OcrLine[] = [];
  let sure = 0;
  let flat = 0;
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const l of para.lines) {
        const words = l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), conf: w.confidence / 100, box: box(w.bbox) }));
        const confident = l.words.filter((w) => w.confidence >= 80 && /[A-Za-z]{3}/.test(w.text));
        sure += confident.length;
        // on an upright page a word is wider than it is tall
        flat += confident.filter((w) => w.bbox.x1 - w.bbox.x0 > (w.bbox.y1 - w.bbox.y0) * 1.2).length;
        if (words.length) lines.push({ text: words.map((w) => w.text).join(" "), conf: l.confidence / 100, box: box(l.bbox), words });
      }
    }
  }
  return { lines, score: sure, flat: sure ? flat / sure : 0 };
}

/** Reading order on the page as uploaded: top to bottom. */
const byRow = (lines: OcrLine[]) => lines.sort((a, b) => a.box.y - b.box.y);

export const localProvider: OcrProvider = {
  name: "LOCAL",
  async extract(images: OcrImage[]): Promise<ExtractedDocument> {
    const worker = await start();
    const pages = [];
    for (const img of images) {
      const gray = decode(img.data, img.mime);
      if (!gray) {
        // a format we cannot clean up (WebP): Tesseract reads it as it is
        const size = sniffImage(img.data);
        const r = await readOnce(worker, img.data, size?.width ?? 1, size?.height ?? 1, img.pageNo, 0);
        pages.push({ pageNo: img.pageNo, lines: byRow(r.lines) });
        continue;
      }
      const clean: Gray = cleanForOcr(gray);
      const attempt = (turns: number) => {
        const turned = rotate(clean, turns);
        return readOnce(worker, encodePng(turned), turned.width, turned.height, img.pageNo, turns);
      };
      let best = await attempt(0);
      // words standing upright, or few confident words: the photo was probably taken sideways
      if (best.flat < 0.6 || best.score < 40) {
        for (const turns of [1, 3]) {
          const r = await attempt(turns);
          if (r.flat * r.score > best.flat * best.score * 1.3) best = r;
        }
      }
      pages.push({ pageNo: img.pageNo, lines: byRow(best.lines) });
    }
    return { provider: "LOCAL", pages };
  },
};
