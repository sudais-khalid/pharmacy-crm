/** File import helpers (task 4.5): a CSV reader and the guess of which column holds what. Pure, for tests. */

/** RFC 4180 style: commas or semicolons, quoted fields with "" for a quote, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const sep = (text.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) > (text.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export const TARGETS = [
  ["name", "Medicine name"], ["barcode", "Barcode"], ["batchNumber", "Batch"], ["expiry", "Expiry"], ["quantity", "Quantity"],
  ["bonusQty", "Bonus"], ["rate", "Rate / cost"], ["discountPercent", "Discount %"], ["taxAmount", "Tax"], ["salePrice", "Sale price"],
] as const;
export type Target = (typeof TARGETS)[number][0];

const GUESS: [Target, RegExp][] = [
  ["barcode", /barcode|ean|upc|gtin/i],
  ["batchNumber", /batch|lot|b\.?\s*no/i],
  ["expiry", /exp/i],
  ["bonusQty", /bonus|free|scheme/i],
  ["discountPercent", /disc/i],
  ["taxAmount", /tax|gst/i],
  ["salePrice", /sale|retail|mrp|selling/i],
  ["rate", /rate|cost|purchase|t\.?p|price/i],
  ["quantity", /qty|quantity|stock|units|balance/i],
  ["name", /name|item|product|medicine|description|particular/i],
];

/** For each column heading, the field it most likely holds (each field used once). */
export function guessMapping(headings: string[]): (Target | "")[] {
  const used = new Set<Target>();
  return headings.map((h) => {
    const hit = GUESS.find(([t, re]) => !used.has(t) && re.test(h));
    if (!hit) return "";
    used.add(hit[0]);
    return hit[0];
  });
}
