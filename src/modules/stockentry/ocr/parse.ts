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
const isNoise = (w: OcrWord) => w.conf < 0.05 || (!/[A-Za-z0-9]/.test(w.text) && w.text !== "/"); // "/" separates a name from its code

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

/**
 * Column kinds on Pakistani distributor invoices. "qty" is the billed quantity (N.Qty), "tqty" the total
 * with bonus (T.Qty); "gross" is quantity x rate before discount and tax, "amount" the line's net value.
 */
type Col = "code" | "name" | "batch" | "expiry" | "batchExpiry" | "qty" | "tqty" | "bonus" | "rate" | "gross" | "disc" | "discAmt" | "tax" | "amount" | "skip";
const PHRASES: [Col, string[]][] = [
  ["code", ["code", "sr", "s no", "sno", "sno code", "sr no", "product code", "s"]],
  ["name", ["description", "item", "items", "item name", "product", "product name", "product description", "particulars", "medicine", "name", "item description", "medicine name"]],
  ["batchExpiry", ["batch expiry", "batch exp"]],
  ["batch", ["batch", "batch no", "b no", "bno", "lot", "batch number", "batch#", "batchno"]],
  ["expiry", ["exp", "expiry", "exp date", "expiry date", "expdate"]],
  ["qty", ["qty", "n qty", "nqty", "quantity", "units", "unit", "pcs"]],
  ["tqty", ["t qty", "tqty", "total qty"]],
  ["bonus", ["bonus", "bns", "bon", "free", "f qty", "fqty", "bonus qty", "scheme"]],
  ["rate", ["rate", "tp", "t p", "price", "trade price", "rate unit", "unit price", "tp rate", "unit rate"]],
  ["gross", ["gross", "gross amt", "gross amount", "pack value", "value of goods", "values of goods"]],
  ["disc", ["disc", "dis", "disc %", "dis %", "discount", "disc%", "dis%", "d%", "disc %"]],
  ["discAmt", ["dis amt", "disc amount", "discount amount", "disc amt", "disc value"]],
  ["tax", ["s tax", "gst", "sales tax", "f tax", "further tax", "adv tax", "awht", "add gst", "add tax", "tax", "sale tax", "taxamt", "tax amt"]],
  ["amount", ["amount", "amt", "net amt", "net amount", "net", "net total", "value including", "netamount", "total", "value", "net value"]],
  ["skip", ["retail", "mrp", "m r p", "sch", "ctn", "u c", "ctns", "t o", "comp disc", "dist disc", "extra disc", "pack size", "2"]],
];
const PHRASE_OF = new Map<string, Col>(PHRASES.flatMap(([c, ps]) => ps.map((p) => [p, c] as [string, Col])));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%#]+/g, " ").trim();
function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** A heading phrase, allowing one wrong letter per word of four or more letters ("Exp1ry", "Gros"). */
function headingOf(text: string): Col | null {
  const n = norm(text);
  if (!n) return null;
  const exact = PHRASE_OF.get(n);
  if (exact) return exact;
  const words = n.split(" ");
  for (const [p, c] of PHRASE_OF) {
    const pw = p.split(" ");
    if (pw.length !== words.length) continue;
    // one wrong letter only in longer words, and never the first ("Gros" yes, "TATE" for "rate" no)
    if (pw.every((x, i) => x === words[i] || (x.length >= 5 && x[0] === words[i][0] && lev(x, words[i]) <= 1) || (x.length >= 7 && x.endsWith(words[i]) && words[i].length >= 5))) return c;
  }
  return null;
}
const QUALIFIERS = new Set(["amt", "amount", "no", "name", "date", "value", "tax", "%", "unit", "price", "qty", "disc", "expiry", "exp", "including", "of", "goods", "total", "description", "code", "size", "number"]);

const center = (b: Box) => b.x + b.w / 2;
const unionBox = (boxes: Box[]): Box | null => {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { page: boxes[0].page, x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

type Phrase = { text: string; x0: number; x1: number };
/** Words on a heading line grouped into phrases: neighbours close together, or a qualifier after a word ("Gross Amt"). */
function phrases(words: OcrWord[]): Phrase[] {
  const out: Phrase[] = [];
  for (const w of [...words].sort((a, b) => a.box.x - b.box.x)) {
    const last = out.at(-1);
    const gap = last ? w.box.x - last.x1 : 1;
    const joined = last ? `${last.text} ${w.text}` : "";
    if (last && ((gap < 0.006 && (!headingOf(w.text) || headingOf(joined))) || (gap < 0.03 && QUALIFIERS.has(norm(w.text)) && headingOf(joined)) || (gap < 0.02 && headingOf(joined) && !headingOf(w.text)))) {
      last.text = joined;
      last.x1 = w.box.x + w.box.w;
    } else out.push({ text: w.text, x0: w.box.x, x1: w.box.x + w.box.w });
  }
  return out;
}

type Heading = { index: number; cols: { col: Col; x: number }[] };

/** The heading row: a line (or two stacked lines) naming at least three known columns, among them a quantity or money column. */
function findHeading(lines: OcrLine[]): Heading | null {
  let best: (Heading & { score: number }) | null = null;
  for (let i = 0; i < lines.length; i++) {
    const below = lines[i + 1] && lines[i + 1].box.y - lines[i].box.y < 0.03 ? lines[i + 1] : null;
    const top = phrases(lines[i].words.filter((w) => w.conf > 0.02));
    const bottom = below ? phrases(below.words.filter((w) => w.conf > 0.02)) : [];
    const cols: { col: Col; x: number }[] = [];
    const usedBottom = new Set<number>();
    for (const p of top) {
      // a heading split over two rows ("Expiry" above "Date")
      const k = bottom.findIndex((q, j) => !usedBottom.has(j) && q.x0 < p.x1 + 0.01 && q.x1 > p.x0 - 0.01 && headingOf(`${p.text} ${q.text}`));
      const both = k >= 0 ? headingOf(`${p.text} ${bottom[k].text}`) : null;
      const col = both ?? headingOf(p.text);
      if (k >= 0 && both) usedBottom.add(k);
      if (col) cols.push({ col, x: (p.x0 + p.x1) / 2 });
    }
    bottom.forEach((q, j) => { const c = !usedBottom.has(j) && headingOf(q.text); if (c && !cols.some((x) => Math.abs(x.x - (q.x0 + q.x1) / 2) < 0.02)) cols.push({ col: c, x: (q.x0 + q.x1) / 2 }); });
    const kinds = new Set<Col>(cols.map((c) => c.col).filter((c) => c !== "skip"));
    const money = ["qty", "tqty", "amount", "gross", "rate"].filter((c) => kinds.has(c as Col)).length;
    // a real heading names what is bought (the item, its batch or quantity) and leaves room for the numbers
    const item = ["name", "batch", "batchExpiry", "qty", "tqty"].some((c) => kinds.has(c as Col));
    const firstMoney = Math.min(...cols.filter((c) => ["qty", "tqty", "rate", "gross", "amount", "batch", "batchExpiry", "expiry"].includes(c.col)).map((c) => c.x));
    if (kinds.size >= 3 && money >= 1 && item && firstMoney < 0.55) {
      const score = kinds.size + money;
      if (!best || score > best.score) best = { index: below && cols.length > top.length ? i + 1 : i, cols: cols.sort((a, b) => a.x - b.x), score };
    }
  }
  if (!best) return null;
  // the same kind twice ("Amt" under Gross and under Net): keep the first for gross-like, the last for amount
  const seen = new Map<Col, number>();
  best.cols.forEach((c, i) => { if (c.col === "amount" || !seen.has(c.col)) seen.set(c.col, i); });
  return { index: best.index, cols: best.cols.filter((c, i) => seen.get(c.col) === i || c.col === "skip" || c.col === "tax") };
}

/** Rows that end the table, and subtotal rows inside it. */
const END_LINE = /\b(net\s*total|grand\s*total|net\s*payable|invoice\s*total|amount\s*summary|gross\s*amount|this\s*page\s*total|no\.?\s*of\s*items?|warranty|value\s*of\s*goods\s*excluding)\b/i;
const SUBTOTAL_LINE = /\b(total\s*for|sub\s*total|advance\s*(wh)?\s*tax|carried\s*forward|page\s*total)\b/i;
const TOTAL_LINE = /\b(net\s*total|grand\s*total|net\s*amount|total\s*amount|net\s*payable|payable|bill\s*total|total\s*value\s*of\s*invoice|total)\b/i;

/** Item names carry the distributor's codes: "055/ESSO 40MG" and "MONITOR 5MG TAB / 808". */
export function cleanItemName(raw: string): { name: string; code: string | null } {
  let s = raw.replace(/\s+/g, " ").trim();
  let code: string | null = null;
  const tail = s.match(/\s*\/\s*(\d{2,6})\s*$/);
  if (tail) { code = tail[1]; s = s.slice(0, tail.index).trim(); }
  const head = s.match(/^(?:\d{1,3}[.)]?\s+)?(?:\d{3,6}\s+)?\*?\s*(\d{2,4})\s*\/\s*(?=[A-Za-z])/);
  if (head) { code ??= head[1]; s = s.slice(head[0].length); }
  s = s.replace(/^(?:\d{1,3}[.)]?\s+)?(?:\d{3,6}\s+)?\*\s*/, "").replace(/^\d{1,3}[.)]?\s+\d{3,6}\s+(?=[A-Za-z])/, "").replace(/^\d{1,3}[.)]\s+/, "").replace(/^\|\s*/, "").trim();
  return { name: s, code };
}

/** Expiry in any of the printed forms, including full dates (30/06/2028) and month names (DEC/2028). */
export function parseExpiryAny(text: string | null): string | null {
  if (!text) return null;
  const full = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
  if (full && Number(full[2]) >= 1 && Number(full[2]) <= 12) return monthEnd(year(full[3]), Number(full[2]));
  return parseExpiryCell(text.replace(/^[/\s]+/, ""));
}

/**
 * Fills and checks the numbers of a line. A faint quantity column is common: the quantity then follows
 * from gross / rate, total quantity minus bonus, or the net amount / rate when that is a whole number
 * within the small taxes these bills add.
 */
export function settleLine(n: { quantity: number | null; tqty: number | null; bonusQty: number | null; rate: number | null; gross: number | null; amount: number | null; discountPercent: number | null; taxAmount: number | null }) {
  let { quantity, rate, gross, amount } = n;
  const whole = (v: number, tol: number) => v >= 0.9 && v <= 100_000 && Math.abs(v - Math.round(v)) <= tol * Math.max(1, Math.round(v));
  // readings an engine slip allows: a lost decimal point (62295 for 622.95) or a thousands comma read as a point (1.246 for 1,246)
  const variants = (v: number | null) => (v === null ? [null] : [v, v / 100, ...(Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6 && v < 100 && v % 1 !== 0 ? [Math.round(v * 1000)] : [])]);
  if (quantity === null && n.tqty !== null) quantity = Math.max(0, n.tqty - (n.bonusQty ?? 0));
  const quantities = [...new Set([quantity, n.tqty !== null ? n.tqty - (n.bonusQty ?? 0) : null].filter((q): q is number => q !== null && q > 0))];
  // the combination where quantity x rate gives the gross (or the net, which adds a little tax)
  let settled = false;
  for (const target of [gross, amount]) {
    if (settled || target === null || !rate) continue;
    for (const r of variants(rate)) {
      for (const t of variants(target)) {
        if (settled || !r || !t) continue;
        // the net amount is after the printed discount
        const base = target === amount && n.discountPercent ? t / (1 - Math.min(n.discountPercent, 99) / 100) : t;
        const tol = base * 0.015 + (base >= 50 ? 0.51 : 0); // gross is often printed rounded to the rupee
        const q = base / r;
        const okQ = quantities.length ? quantities.find((x) => Math.abs(x * r - base) <= tol) : whole(q, 0.012) ? Math.round(q) : undefined;
        if (okQ !== undefined) {
          rate = r;
          quantity = okQ;
          if (target === gross) gross = t; else amount = t;
          settled = true;
        }
      }
    }
  }
  // a quantity misread (a tick mark, a stray digit) that gross / rate contradicts
  if (!settled && rate && gross && whole(gross / rate, 0.012)) quantity = Math.round(gross / rate);
  if (quantity === null && rate && amount && !n.discountPercent && whole(amount / rate, 0.012)) quantity = Math.round(amount / rate);
  if (gross === null && quantity && rate) gross = Math.round(quantity * rate * 100) / 100;
  if (amount === null) amount = gross;
  return { quantity, rate, amount, bonusQty: n.bonusQty, discountPercent: n.discountPercent, taxAmount: n.taxAmount };
}

/**
 * Finds quantity, rate and line amount among a row's numbers by arithmetic: quantity x rate gives the
 * gross, or the net amount within a small tax or the printed discount. Works wherever the columns are, which
 * matters because the heading row is often the least readable part of a photo. Numbers are in reading order.
 */
export function solveRow(nums: number[], hint: { discountPercent?: number | null; quantity?: number | null } = {}) {
  const variants = (v: number) => [v, ...(v >= 100 && Number.isInteger(v) ? [v / 100] : []), ...(v < 100 && v % 1 !== 0 && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6 ? [Math.round(v * 1000)] : [])];
  const disc = hint.discountPercent && hint.discountPercent < 99 ? hint.discountPercent : 0;
  let best: { quantity: number; rate: number; amount: number; score: number } | null = null;
  for (let i = 0; i < nums.length; i++) {
    const q = nums[i];
    if (!Number.isInteger(q) || q < 1 || q > 10_000) continue;
    for (let j = 0; j < nums.length; j++) {
      if (j === i) continue;
      for (const r of variants(nums[j])) {
        if (r <= 1 || r > 1_000_000) continue; // a rate of one is a quantity or a bonus, never a price
        for (let k = Math.max(i, j) + 1; k < nums.length; k++) {
          for (const t of variants(nums[k])) {
            for (const target of disc ? [t, t / (1 - disc / 100)] : [t]) {
              const err = Math.abs(q * r - target);
              const tol = target * 0.012 + (target >= 50 ? 0.51 : 0.011);
              if (err > tol) continue;
              // prefer the exact product, the quantity under the Qty heading, and the nearest amount (gross before a taxed net)
              const score = (err / Math.max(1, target)) * 50 + (k - Math.max(i, j)) * 0.1 + (hint.quantity != null && q !== hint.quantity ? 0.5 : 0) + (q === 1 && r === t ? 0.05 : 0) + (r !== nums[j] || t !== nums[k] ? 0.3 : 0) + (Number.isInteger(r) ? 0.2 : 0);
              if (!best || score < best.score) best = { quantity: q, rate: r, amount: t, score };
            }
          }
        }
      }
    }
  }
  if (best) return best;
  // no quantity readable: a rate that gives the amount on its own is one unit, or a whole multiple of it
  // (the smallest such quantity: 228.02 x 500 = 114010 is a lost decimal point, not 500 units)
  let implied: { quantity: number; rate: number; amount: number; score: number } | null = null;
  for (let j = 0; j < nums.length; j++) {
    for (const r of variants(nums[j])) {
      if (r <= 1 || r % 1 === 0) continue; // rates are printed with paisa
      for (let k = j + 1; k < nums.length; k++) {
        for (const t of variants(nums[k])) {
          const q = Math.round(t / r);
          if (q < 1 || q > 1000 || (hint.quantity != null && hint.quantity !== q && hint.quantity > 0)) continue;
          if (Math.abs(q * r - t) <= t * 0.006 + (t >= 50 ? 0.51 : 0.011) && (!implied || q < implied.quantity)) implied = { quantity: q, rate: r, amount: t, score: 9 };
        }
      }
    }
  }
  return implied;
}

function header(lines: OcrLine[]): ParsedHeader {
  const text = lines.map((l) => l.text);
  const invoice = text
    .map((t) => t.match(/\b(?:inv(?:oice)?|bill|memo)\.?\s*(?:no|#|number|num)\b\.?\s*[:#.-]*\s*([A-Z0-9][A-Z0-9/-]{1,})/i)?.[1] ?? t.match(/\binvoice\s*#\s*([A-Z0-9][A-Z0-9/-]{2,})/i)?.[1])
    .find((v) => v && /\d/.test(v)) ?? null;
  const dateLine = text.find((t) => /\b(invoice\s*date|inv\.?\s*date|date)\b/i.test(t) && parseDate(t)) ?? text.find((t) => parseDate(t));
  const totalOf = (re: RegExp) => [...text].reverse().map((t) => {
    if (!re.test(t) || /balance|previous|rupees|only\b|page/i.test(t)) return null;
    const nums = t.replace(re, " ").match(/\d[\d,]*(?:\.\d+)?/g);
    return nums ? parseNumber(nums[nums.length - 1]) : null;
  }).find((v) => v !== null && v !== undefined && v > 0) ?? null;
  const billTotal = totalOf(/\b(net\s*total|grand\s*total|net\s*payable|net\s*amount|total\s*value\s*of\s*invoice)\b/i) ?? totalOf(TOTAL_LINE);
  // the supplier: a line near the top naming a business, else the first plain line of the page
  const top = lines.filter((l) => l.box.y < 0.3 && /[A-Za-z]{3}/.test(l.text) && l.conf > 0.5 && !/customer|invoice|ntn|strn|phone|tel|address|date|cash memo|estimate|proforma|pharmacy|medicose/i.test(l.text));
  const business = top.find((l) => /\b(enterprises?|traders?|company|co\.|medicine|pharma\w*|sales|distributors?|limited|ltd|pvt|agenc(y|ies)|stores?|medicos|solutions|point)\b/i.test(l.text));
  const supplier = (business ?? top[0])?.text.replace(/\s+/g, " ").trim() ?? null;
  return {
    supplierName: supplier,
    invoiceNo: invoice,
    billDate: dateLine ? parseDate(dateLine) : null,
    billTotal,
    confidence: lines.length ? Math.min(...lines.slice(0, 8).map((l) => l.conf)) : 0,
  };
}

/** Words of a line grouped into cells: a gap wider than a column gutter starts a new cell. */
function cellsOf(words: OcrWord[], gutter = 0.012): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.box.x - b.box.x);
  const out: OcrWord[][] = [];
  for (const w of sorted) {
    const last = out.at(-1);
    const prev = last?.at(-1);
    if (prev && w.box.x - (prev.box.x + prev.box.w) < gutter) last!.push(w);
    else out.push([w]);
  }
  return out;
}

const EXPIRY_TOKEN = /^(0?[1-9]|1[0-2])[-/.](\d{2}|\d{4})$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^[A-Za-z]{3}[-/]\d{2,4}$|^(0[1-9]|1[0-2])\d{2}$/;
const BATCH_TOKEN = /^(?=.*\d)[A-Z0-9][A-Z0-9-]{2,11}$/i;
const textOf = (ws: OcrWord[]) => ws.map((w) => w.text).join(" ").trim();

/**
 * Lines of a bill table. The heading row, when it can be read, says where the name, batch, expiry and
 * bonus columns are; quantity, rate and amount are found by arithmetic (solveRow), so a row still parses
 * when the heading is unreadable. Without a heading, a row counts when its numbers solve.
 */
export function parseBill(lines: OcrLine[]): ParsedIntake | null {
  const head = findHeading(lines);
  const debug = process.env.PCRM_OCR_DEBUG === "1";
  const cols = head?.cols ?? [];
  const bounds = cols.map((c, i) => ({ col: c.col, from: i ? (cols[i - 1].x + c.x) / 2 : -1, to: i < cols.length - 1 ? (c.x + cols[i + 1].x) / 2 : 2 }));
  const nameCol = cols.find((c) => c.col === "name");
  const firstData = cols.find((c) => c.col !== "name" && c.col !== "code" && (!nameCol || c.x > nameCol.x));
  // names are left-aligned and run long: they end just before the first data column, not halfway to it
  const headNameEnd = head && firstData ? firstData.x - 0.03 : null;
  const colAt = (x: number) => bounds.find((b) => x >= b.from && x < b.to)?.col ?? null;
  if (debug && head) console.log("HEADING", lines[head.index].text, JSON.stringify(cols.map((c) => `${c.col}@${c.x.toFixed(2)}`)), "nameEnd", headNameEnd?.toFixed(2));

  const parsed: ParsedLine[] = [];
  let pendingName: OcrWord[] = [];
  let lastRowY = -1;
  let rowHeight = 0.02;
  const start = head ? head.index + 1 : 0;
  for (const line of lines.slice(start)) {
    if (END_LINE.test(line.text) && parsed.length) break;
    if (SUBTOTAL_LINE.test(line.text) || (TOTAL_LINE.test(line.text) && !/[a-z]{3,}\s+\d+\s*(mg|ml)/i.test(line.text))) { pendingName = []; lastRowY = -1; continue; }
    const words = line.words.filter((w) => !isNoise(w));
    if (!words.length) continue;
    const cells = cellsOf(words);

    // the name: left of the first data column, or else the leading cells with words in them
    let nameWords: OcrWord[] = [];
    let rest: OcrWord[][] = [];
    if (headNameEnd !== null) {
      nameWords = words.filter((w) => center(w.box) < headNameEnd);
      rest = cellsOf(words.filter((w) => center(w.box) >= headNameEnd));
    } else {
      let i = 0;
      // serial numbers and codes before the name (often misread as a letter or two)
      while (i < cells.length - 1 && (textOf(cells[i]).match(/[A-Za-z]/g) ?? []).length < 3) i++;
      if (i < cells.length && /[A-Za-z]{3}/.test(textOf(cells[i]))) {
        nameWords = cells.slice(0, i + 1).flat();
        rest = cells.slice(i + 1);
      } else rest = cells;
    }
    const dataWords = rest.flat();
    const byCol = (c: Col) => dataWords.filter((w) => colAt(center(w.box)) === c);

    // batch and expiry: by heading when there is one, else by their shape
    let batch: string | null = null;
    let expiryText: string | null = null;
    const both = textOf(byCol("batchExpiry"));
    const combined = (both || dataWords.map((w) => w.text).join(" ")).match(/\b([A-Z0-9][A-Z0-9-]{2,11})\s*\/\s*((?:0?[1-9]|1[0-2])-\d{2})\b/i);
    if (combined) { batch = combined[1]; expiryText = combined[2]; }
    if (!batch && byCol("batch").length) batch = textOf(byCol("batch")).replace(/\s+/g, "");
    if (!expiryText && byCol("expiry").length) expiryText = textOf(byCol("expiry"));
    if (!expiryText) expiryText = dataWords.map((w) => w.text.replace(/^[[(|]+|[\])|]+$/g, "")).find((t) => EXPIRY_TOKEN.test(t)) ?? null;
    if (!batch && !cols.some((c) => c.col === "batch" || c.col === "batchExpiry")) {
      // the first cell after the name, when it looks like a batch code and not a price
      const first = rest[0] ? textOf(rest[0]).replace(/\s+/g, "") : "";
      if (BATCH_TOKEN.test(first) && !/^\d+\.\d+$/.test(first) && first !== expiryText) batch = first;
    }
    batch = batch ? batch.replace(/[^A-Za-z0-9-]/g, "").toUpperCase() || null : null;

    // numbers in reading order; a decimal point read as a space is joined back ("365 50")
    const sorted = [...dataWords].sort((a, b) => a.box.x - b.box.x);
    const nums: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      // in a number column a lone I, l or | is a 1 and an O is a 0
      const t = sorted[i].text.replace(/^[[(]+|[\]),]+$/g, "").replace(/^[Il|!]$/, "1").replace(/^[Oo]$/, "0");
      if (/%/.test(t) || (expiryText && t === expiryText) || (batch && t.toUpperCase() === batch)) continue;
      const next = sorted[i + 1];
      // "149 600" is 149.600 with the point missed (rates print with two or three decimals)
      if (/^\d{2,6}$/.test(t) && next && /^\d{2,3}$/.test(next.text) && next.box.x - (sorted[i].box.x + sorted[i].box.w) < 0.01) {
        nums.push(Number(`${t}.${next.text}`));
        i++;
      } else if (/^\d[\d,]*(\.\d+)?$/.test(t)) {
        const v = parseNumber(t);
        if (v !== null) nums.push(v);
      }
    }
    const colNum = (c: Col) => parseNumber(textOf(byCol(c)).replace(/[|\][]/g, "").replace(/^(\d{1,6}) (\d{2})$/, "$1.$2") || null);
    const discountPercent = colNum("disc");
    const solved = solveRow(nums, { discountPercent, quantity: colNum("qty") });
    const nameText = textOf(nameWords);
    if (debug) console.log("ROW", JSON.stringify({ name: nameText, batch, expiryText, nums, solved }));

    if (!solved) {
      const colQty = colNum("qty");
      const colAmount = colNum("amount") ?? colNum("gross");
      const usable = head && (colQty !== null || colAmount !== null) && /[A-Za-z]{2}/.test(nameText);
      if (!usable) {
        if (/[A-Za-z]{3}/.test(nameText) && !nums.length) {
          // a name that wraps onto the next line, or a name printed above its numbers (thermal slips)
          const prev = parsed.at(-1);
          if (prev && lastRowY >= 0 && line.box.y - lastRowY < rowHeight * 1.6 && !pendingName.length) {
            prev.name = cleanItemName(`${prev.name} ${nameText}`).name;
            prev.rawText += ` ${nameText}`;
            lastRowY = line.box.y;
          } else pendingName.push(...nameWords);
        }
        continue;
      }
    }

    // a held-over name belongs to a row printed without one (thermal slips), not before a named row
    const allName = /[A-Za-z]{3}/.test(textOf(nameWords)) ? nameWords : [...pendingName, ...nameWords];
    pendingName = [];
    const trimmed = [...allName];
    const speck = (w: OcrWord) => w.text.replace(/[^A-Za-z0-9]/g, "").length <= 2 && !/\d/.test(w.text) && w.conf < 0.7;
    while (trimmed.length > 1 && speck(trimmed[0])) trimmed.shift();
    while (trimmed.length > 1 && speck(trimmed[trimmed.length - 1])) trimmed.pop();
    const { name } = cleanItemName(textOf(trimmed));
    if (!name || !/[A-Za-z]{2}/.test(name)) continue;

    const bonus = colNum("bonus");
    const settled = solved
      ? { quantity: solved.quantity, rate: solved.rate, amount: colNum("amount") !== null && Math.abs(colNum("amount")! - solved.amount) <= solved.amount * 0.2 ? colNum("amount")! : solved.amount }
      : settleLine({ quantity: colNum("qty"), tqty: colNum("tqty"), bonusQty: bonus, rate: colNum("rate"), gross: colNum("gross"), amount: colNum("amount"), discountPercent, taxAmount: null });
    if (lastRowY >= 0) rowHeight = Math.min(0.05, Math.max(0.008, line.box.y - lastRowY));
    lastRowY = line.box.y;
    parsed.push({
      rawText: words.map((w) => w.text).join(" "), name, batchNumber: batch,
      expiryDate: parseExpiryAny(expiryText),
      quantity: settled.quantity, bonusQty: bonus !== null && bonus < 10_000 ? Math.round(bonus) : null, rate: settled.rate,
      discountPercent, taxAmount: null, amount: settled.amount,
      confidence: Math.min(...words.map((w) => w.conf), 1), box: unionBox([...allName, ...words].map((w) => w.box)),
    });
  }
  return parsed.length || head ? { header: header(lines), lines: parsed } : null;
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
