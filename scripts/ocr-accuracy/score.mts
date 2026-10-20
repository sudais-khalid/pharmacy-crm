// Reads bill photos with a photo reader and the parsers, and scores them against truth.json.
//   tsx scripts/ocr-accuracy/score.mts <folder> [LOCAL|CLOUD] [--verbose]
// truth.json: [{ file, kind, supplierName, invoiceNo, billDate, billTotal, lines: [{ name, batchNumber, expiryDate,
// quantity, bonusQty, rate, amount }] }]. A field that is null in the truth (a bill without an expiry column) is not scored.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cloudProvider, localProvider, normalizeItemText, parseDocument, type OcrProvider } from "@/modules/stockentry";

type TruthLine = { name: string; batchNumber: string | null; expiryDate: string | null; quantity: number; bonusQty?: number; rate: number | null; amount: number | null };
type Truth = { file: string; kind: "PURCHASE_BILL" | "STOCK_LIST"; lines: TruthLine[]; supplierName: string | null; invoiceNo: string | null; billDate: string | null; billTotal: number | null; note?: string | null };

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const [dirArg, whichArg] = args.filter((a) => !a.startsWith("--"));
const dir = path.resolve(dirArg ?? "ocr-samples");
const which = (whichArg ?? "LOCAL").toUpperCase();
let provider: OcrProvider = localProvider;
if (which === "CLOUD") {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY to score the cloud reader.");
  provider = cloudProvider(process.env.ANTHROPIC_API_KEY);
}
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const truth: Truth[] = (JSON.parse(readFileSync(path.join(dir, "truth.json"), "utf8")) as Truth[]).filter((t) => !only || only.split(",").some((o) => t.file.includes(o)));
const mimeOf = (f: string) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");

const FIELDS = ["found", "name", "batch", "expiry", "quantity", "bonus", "rate", "amount"] as const;
const hits: Record<string, number> = {};
const totals: Record<string, number> = {};
const count = (field: string, ok: boolean, bucket = hits, all = totals) => {
  all[field] = (all[field] ?? 0) + 1;
  bucket[field] = (bucket[field] ?? 0) + (ok ? 1 : 0);
};
const near = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.002);
const words = (s: string) => new Set(normalizeItemText(s).split(" ").filter(Boolean));
/** Share of the true name's words that were read (the reader may add a word or two of noise). */
const overlap = (read: string, want: string) => {
  const r = words(read);
  const w = words(want);
  return [...w].filter((x) => r.has(x)).length / Math.max(1, w.size);
};
const sameCode = (a: string | null | undefined, b: string) => (a ?? "").replace(/[\s.-]/g, "").toUpperCase() === b.replace(/[\s.-]/g, "").toUpperCase();

const report: unknown[] = [];
const started = Date.now();
for (const t of truth) {
  const t0 = Date.now();
  const doc = await provider.extract([{ pageNo: 1, data: readFileSync(path.join(dir, t.file)), mime: mimeOf(t.file) }], t.kind);
  const parsed = parseDocument(doc, t.kind);
  const used = new Set<number>();
  const mine: Record<string, number> = {};
  const mineAll: Record<string, number> = {};
  const both = (field: string, ok: boolean) => { count(field, ok); count(field, ok, mine, mineAll); };
  for (const line of t.lines) {
    // the read line that best matches this true line (each read line is used once)
    let best = -1;
    let score = 0;
    parsed.lines.forEach((p, i) => {
      const s = overlap(`${p.name ?? ""} ${p.rawText}`, line.name);
      if (!used.has(i) && s > score) [best, score] = [i, s];
    });
    const p = score >= 0.5 ? parsed.lines[best] : null;
    if (p) used.add(best);
    both("found", Boolean(p));
    both("name", Boolean(p) && overlap(p!.name ?? "", line.name) >= 0.8);
    if (line.batchNumber) both("batch", sameCode(p?.batchNumber, line.batchNumber));
    if (line.expiryDate) both("expiry", p?.expiryDate === line.expiryDate);
    both("quantity", p?.quantity === line.quantity);
    if (line.bonusQty) both("bonus", p?.bonusQty === line.bonusQty);
    if (line.rate !== null) both("rate", near(p?.rate, line.rate));
    // the truth holds the gross; a reader may give the net, which adds 0.5% advance tax or takes a discount off
    if (line.amount !== null) both("amount", p?.amount != null && Math.abs(p.amount - line.amount) <= Math.max(1, line.amount * 0.015) || (p?.amount != null && line.rate !== null && p.quantity != null && Math.abs(p.amount - p.quantity * line.rate) <= Math.max(1, p.amount * 0.12)));
    if (verbose) {
      console.log(`  ${p ? "+" : "-"} ${line.name}`);
      if (p) console.log(`      read: ${JSON.stringify({ n: p.name, b: p.batchNumber, e: p.expiryDate, q: p.quantity, bo: p.bonusQty, r: p.rate, a: p.amount })}`);
    }
  }
  const extra = parsed.lines.length - used.size;
  if (t.lines.length) both("no extra lines", extra === 0);
  if (t.invoiceNo) both("invoice no", (parsed.header.invoiceNo ?? "").replace(/^0+/, "") === t.invoiceNo.replace(/^0+/, ""));
  if (t.billDate) both("bill date", parsed.header.billDate === t.billDate);
  if (t.billTotal !== null) both("bill total", near(parsed.header.billTotal, t.billTotal) || near(parsed.header.billTotal, Math.round(t.billTotal)));
  if (t.supplierName) both("supplier", overlap(parsed.header.supplierName ?? "", t.supplierName) >= 0.6);
  const pct = (k: string) => (mineAll[k] ? `${k} ${mine[k]}/${mineAll[k]}` : null);
  const summary = ["found", "name", "batch", "expiry", "quantity", "rate", "invoice no", "bill total"].map(pct).filter(Boolean).join(", ");
  console.log(`${t.file}: ${t.lines.length} lines, ${parsed.lines.length} read${summary ? `; ${summary}` : ""}${t.note ? ` (${t.note})` : ""} [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
  report.push({ file: t.file, truthLines: t.lines.length, readLines: parsed.lines.length, extra, fields: { hits: mine, totals: mineAll }, ms: Date.now() - t0 });
}

const rows = [...FIELDS, ...Object.keys(totals).filter((k) => !(FIELDS as readonly string[]).includes(k))].filter((k) => totals[k]);
console.log(`\n${which} reader, ${truth.length} documents, ${((Date.now() - started) / 1000 / truth.length).toFixed(1)} s per page\n`);
for (const k of rows) console.log(`${k.padEnd(20)} ${String(hits[k]).padStart(4)} / ${String(totals[k]).padEnd(4)} ${((100 * hits[k]) / totals[k]).toFixed(1).padStart(5)}%`);
writeFileSync(path.join(dir, `report-${which.toLowerCase()}.json`), JSON.stringify({ provider: which, fields: Object.fromEntries(rows.map((k) => [k, { hits: hits[k], total: totals[k] }])), documents: report }, null, 2));
process.exit(0);
