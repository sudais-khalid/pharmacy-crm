/** Pure helpers for the stock entry grid (kept apart so they can be tested without a browser). */

export type GridLine = {
  key: string;
  medicine: { id: string; name: string; salePrice?: string; purchasePrice?: string } | null;
  name: string;
  rawText: string | null;
  batchNumber: string;
  expiry: string; // MM/YY as typed
  quantity: string;
  bonusQty: string;
  rate: string;
  discountPercent: string;
  taxAmount: string;
  amount: string; // from the bill (OCR); empty for typed lines
  salePrice: string;
  matchMethod: string | null;
  confidence: number | null;
  boxes: unknown;
  ignored: boolean;
};

let seq = 0;
export const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export const blankLine = (): GridLine => ({
  key: newKey(), medicine: null, name: "", rawText: null, batchNumber: "", expiry: "", quantity: "", bonusQty: "", rate: "",
  discountPercent: "", taxAmount: "", amount: "", salePrice: "", matchMethod: null, confidence: null, boxes: null, ignored: false,
});

/** "04/28", "4/2028", "04-28" -> "2028-04-30" (stock expires at the end of the month). Null when not a date. */
export function expiryToIso(text: string): string | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return t;
  const m = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const month = Number(m[1]);
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** "2028-04-30" -> "04/28". */
export const isoToExpiry = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "");

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

/** The line total as the server computes it: rate x quantity less discount, plus tax. */
export function lineTotal(l: GridLine): number | null {
  const q = num(l.quantity);
  const r = num(l.rate);
  if (q === null || r === null || Number.isNaN(q) || Number.isNaN(r)) return null;
  const net = Math.round(r * q * (100 - (num(l.discountPercent) ?? 0))) / 100;
  return Math.round((net + (num(l.taxAmount) ?? 0)) * 100) / 100;
}

export const isEmptyLine = (l: GridLine) => !l.medicine && !l.name && !l.batchNumber && !l.expiry && !l.quantity && !l.rate;

/** The draft as the API takes it. */
export function toApiLine(l: GridLine) {
  const n = (v: string) => {
    const x = num(v);
    return x === null || Number.isNaN(x) ? null : x;
  };
  const int = (v: string) => {
    const x = n(v);
    return x === null ? null : Math.round(x);
  };
  return {
    rawText: l.rawText, name: l.name || null, medicineId: l.medicine?.id ?? null, batchNumber: l.batchNumber || null,
    expiryDate: expiryToIso(l.expiry), quantity: int(l.quantity), bonusQty: int(l.bonusQty), rate: n(l.rate), discountPercent: n(l.discountPercent),
    taxAmount: n(l.taxAmount), amount: n(l.amount), salePrice: n(l.salePrice), matchMethod: l.matchMethod, confidence: l.confidence,
    boxes: l.boxes ?? undefined, ignored: l.ignored,
  };
}

type ApiLine = {
  lineNo: number; rawText: string | null; name: string | null; medicineId: string | null; batchNumber: string | null; expiryDate: string | null;
  quantity: number | null; bonusQty: number | null; rate: string | null; discountPercent: string | null; taxAmount: string | null; amount: string | null;
  salePrice: string | null; matchMethod: string | null; confidence: number | null; boxes: unknown; ignored: boolean;
  medicine: { id: string; name: string; salePrice: string; purchasePrice?: string } | null;
};

export function fromApiLine(l: ApiLine): GridLine {
  const s = (v: string | number | null) => (v === null || v === undefined ? "" : String(Number(v)));
  return {
    key: newKey(), medicine: l.medicine ? { id: l.medicine.id, name: l.medicine.name, salePrice: l.medicine.salePrice, purchasePrice: l.medicine.purchasePrice } : null,
    name: l.name ?? "", rawText: l.rawText, batchNumber: l.batchNumber ?? "", expiry: isoToExpiry(l.expiryDate ? l.expiryDate.slice(0, 10) : null),
    quantity: s(l.quantity), bonusQty: l.bonusQty ? String(l.bonusQty) : "", rate: s(l.rate), discountPercent: l.discountPercent && Number(l.discountPercent) ? s(l.discountPercent) : "",
    taxAmount: l.taxAmount && Number(l.taxAmount) ? s(l.taxAmount) : "", amount: s(l.amount), salePrice: s(l.salePrice), matchMethod: l.matchMethod,
    confidence: l.confidence, boxes: l.boxes, ignored: l.ignored,
  };
}

/** Grid columns in keyboard order. */
export const COLUMNS = ["medicine", "batchNumber", "expiry", "quantity", "bonusQty", "rate", "discountPercent", "taxAmount", "salePrice"] as const;
export type Column = (typeof COLUMNS)[number];
