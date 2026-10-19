// Reads rendered samples with a photo reader and the parsers, and scores them against truth.json.
//   tsx scripts/ocr-accuracy/score.mts <samples dir> [LOCAL|CLOUD]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cloudProvider, localProvider, normalizeItemText, parseDocument, type OcrProvider } from "@/modules/stockentry";

type TruthLine = { name: string; batchNumber: string; expiryDate: string; quantity: number; bonusQty: number; rate: number; amount: number };
type Truth = { file: string; kind: "PURCHASE_BILL" | "STOCK_LIST"; lines: TruthLine[]; supplierName: string; invoiceNo: string; billDate: string; billTotal: number; font: string; tilt: number };

const dir = path.resolve(process.argv[2] ?? "ocr-samples");
const which = (process.argv[3] ?? "LOCAL").toUpperCase();
let provider: OcrProvider = localProvider;
if (which === "CLOUD") {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY to score the cloud reader.");
  provider = cloudProvider(process.env.ANTHROPIC_API_KEY);
}
const truth: Truth[] = JSON.parse(readFileSync(path.join(dir, "truth.json"), "utf8"));

const FIELDS = ["found", "name", "batch", "expiry", "quantity", "rate", "amount"] as const;
const hits: Record<string, number> = {};
const totals: Record<string, number> = {};
const count = (field: string, ok: boolean) => {
  totals[field] = (totals[field] ?? 0) + 1;
  hits[field] = (hits[field] ?? 0) + (ok ? 1 : 0);
};
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.011;
const words = (s: string) => new Set(normalizeItemText(s).split(" ").filter(Boolean));
const overlap = (a: string, b: string) => {
  const x = words(a);
  const y = words(b);
  return [...x].filter((w) => y.has(w)).length / Math.max(1, Math.max(x.size, y.size));
};

const report: unknown[] = [];
const started = Date.now();
for (const t of truth) {
  const t0 = Date.now();
  const doc = await provider.extract([{ pageNo: 1, data: readFileSync(path.join(dir, t.file)), mime: "image/png" }], t.kind);
  const parsed = parseDocument(doc, t.kind);
  const used = new Set<number>();
  for (const line of t.lines) {
    // the read line that best matches this true line (each read line is used once)
    let best = -1;
    let score = 0;
    parsed.lines.forEach((p, i) => {
      const s = overlap(p.name ?? p.rawText, line.name);
      if (!used.has(i) && s > score) [best, score] = [i, s];
    });
    const p = score >= 0.5 ? parsed.lines[best] : null;
    if (p) used.add(best);
    count("found", Boolean(p));
    count("name", Boolean(p) && normalizeItemText(p!.name ?? "") === normalizeItemText(line.name));
    count("batch", (p?.batchNumber ?? "").toUpperCase() === line.batchNumber.toUpperCase());
    count("expiry", p?.expiryDate === line.expiryDate);
    count("quantity", p?.quantity === line.quantity);
    if (t.kind === "PURCHASE_BILL") {
      count("rate", near(p?.rate ?? null, line.rate));
      count("amount", near(p?.amount ?? null, line.amount));
    }
  }
  const extra = parsed.lines.length - used.size;
  count("extra lines (lower is better)", extra === 0);
  if (t.kind === "PURCHASE_BILL") {
    count("invoice no", parsed.header.invoiceNo === t.invoiceNo);
    count("bill date", parsed.header.billDate === t.billDate);
    count("bill total", near(parsed.header.billTotal, t.billTotal));
  }
  report.push({ file: t.file, kind: t.kind, font: t.font, tilt: t.tilt, truthLines: t.lines.length, readLines: parsed.lines.length, extra, ms: Date.now() - t0 });
  process.stdout.write(".");
}
process.stdout.write("\n");

const rows = [...FIELDS, ...Object.keys(totals).filter((k) => !(FIELDS as readonly string[]).includes(k))].filter((k) => totals[k]);
console.log(`\n${which} reader, ${truth.length} documents, ${((Date.now() - started) / 1000 / truth.length).toFixed(1)} s per page\n`);
for (const k of rows) console.log(`${k.padEnd(32)} ${String(hits[k]).padStart(4)} / ${String(totals[k]).padEnd(4)} ${((100 * hits[k]) / totals[k]).toFixed(1).padStart(5)}%`);
writeFileSync(path.join(dir, `report-${which.toLowerCase()}.json`), JSON.stringify({ provider: which, fields: Object.fromEntries(rows.map((k) => [k, { hits: hits[k], total: totals[k] }])), documents: report }, null, 2));
process.exit(0);
