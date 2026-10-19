import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { sniffImage } from "@/lib/images";
import type { ExtractedDocument, OcrImage, OcrLine, OcrProvider } from "./types";

/**
 * Local OCR with Tesseract (architecture, section 6.1.2): works offline, good on clean printed bills.
 * The engine and the English model ship with the app; nothing is downloaded. One engine is kept per
 * worker process and reused for every page.
 */
type TessWorker = { recognize: (image: Buffer, options?: object, output?: object) => Promise<{ data: TessResult }> };
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
    return createWorker("eng", 1, { langPath, gzip: true, cachePath: path.join(os.tmpdir(), "pcrm-tesseract"), logger: () => {} });
  })();
  return engine;
}

export const localProvider: OcrProvider = {
  name: "LOCAL",
  async extract(images: OcrImage[]): Promise<ExtractedDocument> {
    const worker = await start();
    const pages = [];
    for (const img of images) {
      const size = sniffImage(img.data);
      const width = size?.width ?? 1;
      const height = size?.height ?? 1;
      const box = (b: TessBox) => ({ page: img.pageNo, x: b.x0 / width, y: b.y0 / height, w: (b.x1 - b.x0) / width, h: (b.y1 - b.y0) / height });
      const { data } = await worker.recognize(img.data, {}, { blocks: true, text: false });
      const lines: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const l of para.lines) {
            const words = l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), conf: w.confidence / 100, box: box(w.bbox) }));
            if (words.length) lines.push({ text: words.map((w) => w.text).join(" "), conf: l.confidence / 100, box: box(l.bbox), words });
          }
        }
      }
      // reading order: top to bottom
      lines.sort((a, b) => a.box.y - b.box.y);
      pages.push({ pageNo: img.pageNo, lines });
    }
    return { provider: "LOCAL", pages };
  },
};
