import type { Box, ExtractedDocument, IntakeKindName, OcrLine, OcrWord, ParsedHeader, ParsedIntake, ParsedLine } from "./types";

/**
 * Parsers (architecture, section 6.1.2): a supplier bill by its column headings (Qty, Batch, Exp, Rate,
 * Amount, Bonus/Free, Disc, GST), a stock list by loose line formats ("Panadol 500mg 20 exp 3/27").
 * Numbers and dates are read the way Pakistani bills print them (1,234.50; 12/10/2026; 04/28; Apr-28).
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const monthEnd = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** "1,234.50", "Rs. 1234/-", "12.5%" -> number; null when there is no number. */
export function parseNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.replace(/rs\.?|pkr|\/-|%/gi, "").replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, "0").replace(/[lI](?=\d)/g, "1").trim();
  const m = t.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A bill date: 12/10/2026, 12-10-26, 12.10.2026 (day first), 2026-10-12, 12 Oct 2026. ISO or null. */
export function parseDate(text: string): string | null {
  let m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return valid(year(m[3]), Number(m[2]), Number(m[1]));
  m = text.match(/\b(\d{1,2})[\s-]*([A-Za-z]{3,4})[A-Za-z]*[\s,-]*(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(year(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
}
function valid(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** An expiry: 04/28, 4/2028, 04-2028, APR-28, Apr 2028 -> end of that month. */
export function parseExpiry(text: string): string | null {
  let m = text.match(/\b(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return monthEnd(year(m[2]), Number(m[1]));
  m = text.match(/\b([A-Za-z]{3,4})[A-Za-z]*\s*[/.\s-]?\s*(\d{4}|\d{2})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return monthEnd(year(m[2]), MONTHS[m[1].toLowerCase()]);
  return null;
}

/**
 * An expiry cell where the engine lost the separator: 0529, 01129 (01/29, the slash read as 1), 0312027.
 * Only for the expiry column, where a bare number cannot be anything else.
 */
export function parseExpiryCell(text: string): string | null {
  const direct = parseExpiry(text);
  if (direct) return direct;
  const m = text.replace(/[\s.]/g, "").match(/^(0[1-9]|1[0-2])[17|/\\]?(\d{4}|\d{2})$/);
  return m ? monthEnd(year(m[2]), Number(m[1])) : null;
}

/** Words that are only table rules, stamps or specks: no letter or digit, or no confidence at all. */
const isNoise = (w: OcrWord) => w.conf < 0.05 || !/[A-Za-z0-9]/.test(w.text);

/**
 * Engines drop decimal points ("160.50" read as 16050). When quantity x rate does not give the amount,
 * tries the rate and the amount divided by 100 and keeps the combination that agrees. Also fills a missing
 * quantity from amount / rate when that is a whole number.
 */
export function reconcileAmounts(l: Pick<ParsedLine, "quantity" | "rate" | "amount" | "discountPercent" | "taxAmount">) {
  if (l.discountPercent || l.taxAmount) return l;
  const agree = (q: number, r: number, a: number) => Math.abs(q * r - a) <= Math.max(0.02, a * 0.002);
  if (l.quantity && l.rate && l.amount) {
    for (const [dr, da] of [[1, 1], [100, 1], [1, 100], [100, 100]]) {
      if (agree(l.quantity, l.rate / dr, l.amount / da)) return { ...l, rate: l.rate / dr, amount: l.amount / da };
    }
  }
  if (l.quantity === null && l.rate && l.amount) {
    const q = l.amount / l.rate;
    if (q >= 1 && q <= 100_000 && Math.abs(q - Math.round(q)) < 0.001) return { ...l, quantity: Math.round(q) };
  }
  return l;
}

// ---------------------------------------------------------------- supplier bills

type Col = "name" | "batch" | "expiry" | "qty" | "bonus" | "rate" | "disc" | "tax" | "amount";
const HEADINGS: [Col, RegExp][] = [
  ["name", /^(description|item|items|product|particulars|medicine|name)$/i],
  ["batch", /^(batch|b\.?no\.?|lot|batch#|batchno)$/i],
  ["expiry", /^(exp|exp\.|expiry|exp\.date|expdate)$/i],
  ["qty", /^([qoag]t[yv]|qty\.|quantity|pcs|units)$/i], // engines often read "Qty" as "aty" or "Oty"
  ["bonus", /^(bonus|free|bns|sch|scheme|f\.?qty)$/i],
  ["rate", /^(rate|price|t\.?p\.?|tp|unit\s*price)$/i],
  ["disc", /^(disc|disc\.|disc%|discount|d%|dis)$/i],
  ["tax", /^(gst|tax|s\.?tax|sales\s*tax)$/i],
  ["amount", /^(amount|amt|amt\.|value|net|total)$/i],
];
const headingOf = (w: string) => HEADINGS.find(([, re]) => re.test(w.replace(/[:]/g, "").trim()))?.[0] ?? null;
const center = (b: Box) => b.x + b.w / 2;
const unionBox = (boxes: Box[]): Box | null => {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { page: boxes[0].page, x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

/** The heading row: the line naming at least three known columns. */
function findHeading(lines: OcrLine[]) {
  for (let i = 0; i < lines.length; i++) {
    const cols = new Map<Col, number>();
    for (const w of lines[i].words) {
      const c = headingOf(w.text);
      if (c && !cols.has(c)) cols.set(c, center(w.box));
    }
    if (cols.size >= 3 && (cols.has("qty") || cols.has("amount"))) return { index: i, cols };
  }
  return null;
}

const TOTAL_LINE = /\b(net\s*total|grand\s*total|net\s*amount|total\s*amount|net\s*payable|payable|bill\s*total|total)\b/i;

function header(lines: OcrLine[]): ParsedHeader {
  const text = lines.map((l) => l.text);
  const invoice = text.map((t) => t.match(/\b(?:inv(?:oice)?|bill)\s*(?:no|#|number)?\.?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{1,})/i)?.[1]).find(Boolean) ?? null;
  const dateLine = text.find((t) => /\bdate\b/i.test(t) && parseDate(t)) ?? text.find((t) => parseDate(t));
  const totalLine = [...text].reverse().find((t) => TOTAL_LINE.test(t) && parseNumber(t.replace(TOTAL_LINE, "")) !== null);
  const totalNums = totalLine ? totalLine.replace(TOTAL_LINE, "").match(/\d[\d,]*(?:\.\d+)?/g) : null;
  // the supplier is usually the first prominent line of the page
  const supplier = lines.find((l) => /[A-Za-z]{3}/.test(l.text) && !/invoice|bill|date|ntn|strn|phone|tel/i.test(l.text))?.text.trim() ?? null;
  return {
    supplierName: supplier,
    invoiceNo: invoice,
    billDate: dateLine ? parseDate(dateLine) : null,
    billTotal: totalNums ? parseNumber(totalNums[totalNums.length - 1]) : null,
    confidence: lines.length ? Math.min(...lines.slice(0, 8).map((l) => l.conf)) : 0,
  };
}

/** Lines of a bill table, cell by cell, from the heading row down to the total. */
export function parseBill(lines: OcrLine[]): ParsedIntake | null {
  const head = findHeading(lines);
  if (!head) return null;
  const columns = [...head.cols.entries()].sort((a, b) => a[1] - b[1]);
  const firstNumeric = columns.find(([c]) => c !== "name")?.[1] ?? 1;
  const parsed: ParsedLine[] = [];
  for (const line of lines.slice(head.index + 1)) {
    if (TOTAL_LINE.test(line.text) && !/[a-z]{4,}\s+\d+\s*mg/i.test(line.text)) break;
    const words = line.words.filter((w) => !isNoise(w));
    const cells = new Map<Col, OcrWord[]>();
    for (const w of words) {
      const x = center(w.box);
      // words left of the first numeric column belong to the name
      let col: Col = "name";
      if (x >= firstNumeric - 0.04 || head.cols.has("name") === false) {
        col = columns.reduce((best, c) => (Math.abs(c[1] - x) < Math.abs(best[1] - x) ? c : best))[0];
      }
      if (!cells.has(col)) cells.set(col, []);
      cells.get(col)!.push(w);
    }
    const cell = (c: Col) => (cells.get(c) ?? []).map((w) => w.text).join(" ").trim() || null;
    const name = cell("name");
    const qty = parseNumber(cell("qty"));
    const amount = parseNumber(cell("amount"));
    if (!name || !/[A-Za-z]{2}/.test(name) || (qty === null && amount === null)) continue;
    const numbers = reconcileAmounts({
      quantity: qty !== null ? Math.round(qty) : null, rate: parseNumber(cell("rate")), amount,
      discountPercent: parseNumber(cell("disc")), taxAmount: parseNumber(cell("tax")),
    });
    parsed.push({
      rawText: words.map((w) => w.text).join(" "), name: name.replace(/^\d+[.)]?\s+/, ""), batchNumber: cell("batch")?.replace(/\s+/g, "").toUpperCase() ?? null,
      expiryDate: cell("expiry") ? parseExpiryCell(cell("expiry")!) : null, ...numbers,
      bonusQty: parseNumber(cell("bonus")) !== null ? Math.round(parseNumber(cell("bonus"))!) : null,
      confidence: Math.min(...words.map((w) => w.conf), 1), box: unionBox(words.map((w) => w.box)),
    });
  }
  return { header: header(lines), lines: parsed };
}

// ---------------------------------------------------------------- stock lists

/** One handwritten or printed list line: name, quantity, and maybe batch and expiry, in loose order. */
export function parseListLine(line: OcrLine): ParsedLine | null {
  let text = line.words.length ? line.words.filter((w) => !isNoise(w)).map((w) => w.text).join(" ") : line.text.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{3}/.test(text)) return null;
  let expiryDate: string | null = null;
  const exp = text.match(/\b(?:exp(?:iry)?|ex)\.?\s*[:.-]?\s*([A-Za-z]{3,4}[\s/.-]?\d{2,4}|\d{1,2}\s*[/.-]\s*\d{2,4})/i);
  let beforeExpiry: string | null = null;
  if (exp) {
    expiryDate = parseExpiry(exp[1]);
    // what stands just before "exp" is a batch only when the quantity comes after the expiry
    if (/\d/.test(text.slice(exp.index! + exp[0].length))) beforeExpiry = text.slice(0, exp.index).trim().split(" ").pop() ?? null;
    text = text.replace(exp[0], " ");
  } else {
    const bare = text.match(/\b(\d{1,2})\s*\/\s*(\d{2}|\d{4})\b/);
    if (bare && Number(bare[1]) <= 12) {
      expiryDate = parseExpiry(bare[0]);
      text = text.replace(bare[0], " ");
    }
  }
  let batchNumber: string | null = null;
  const batch = text.match(/\b(?:batch|b\.?\s*no|b#)\.?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,})\b/i); // not a bare "B", as in Vitamin B12
  if (batch && /\d/.test(batch[1])) {
    batchNumber = batch[1].toUpperCase();
    text = text.replace(batch[0], " ");
  } else {
    // no "batch" label: a code like AX8508 or L212, or whatever stands just before "exp" (not a strength like 500mg)
    const code = text.match(/(?:^|\s)([A-Z]{1,3}-?\d{3,8}[A-Z]?)(?=\s|$)/i)
      ?? (beforeExpiry && /\d/.test(beforeExpiry) && !/\d\s*(mg|ml|mcg|g|iu|%)$/i.test(beforeExpiry) && text.split(" ").length > 2 ? [` ${beforeExpiry}`, beforeExpiry] : null);
    if (code) {
      batchNumber = code[1].toUpperCase();
      text = text.replace(code[0], " ");
    }
  }
  // the quantity: the last standalone number (not a strength like 500mg)
  const numbers = [...text.matchAll(/(?:^|\s)(?:x\s*|qty[:.]?\s*)?(\d{1,6})(?=\s|$|\s*(?:pcs|pc|nos|box|boxes|tab|tabs|strips?)\b)/gi)];
  const last = numbers[numbers.length - 1];
  const quantity = last ? Number(last[1]) : null;
  const name = (last ? text.slice(0, last.index) : text).replace(/[-:,]+\s*$/, "").replace(/^\d+[.)]\s*/, "").trim();
  if (!name || quantity === null) return null;
  return {
    rawText: line.text, name, batchNumber, expiryDate, quantity, bonusQty: null, rate: null, discountPercent: null, taxAmount: null, amount: null,
    confidence: Math.min(line.conf, ...line.words.map((w) => w.conf)), box: line.box,
  };
}

export function parseStockList(lines: OcrLine[]): ParsedIntake {
  return {
    header: { supplierName: null, invoiceNo: null, billDate: null, billTotal: null, confidence: 1 },
    lines: lines.map(parseListLine).filter((l): l is ParsedLine => l !== null),
  };
}

/** The parse for a document: what a vision model structured, else the bill table, else loose list lines. */
export function parseDocument(doc: ExtractedDocument, kind: IntakeKindName): ParsedIntake {
  if (doc.structured) return doc.structured;
  const lines = doc.pages.flatMap((p) => p.lines);
  if (kind === "PURCHASE_BILL") {
    const bill = parseBill(lines);
    if (bill && bill.lines.length) return bill;
  }
  const list = parseStockList(lines);
  return kind === "PURCHASE_BILL" ? { ...list, header: header(lines) } : list;
}
