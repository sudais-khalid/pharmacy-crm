import { describe, it, expect } from "vitest";
import { parseBill, parseDate, parseDocument, parseExpiry, parseExpiryCell, parseListLine, parseNumber, reconcileAmounts, type OcrLine } from "@/modules/stockentry";

/** A line of OCR words: [text, x] pairs at row y (fractions of the page). */
function line(y: number, cells: [string, number][], conf = 0.95): OcrLine {
  const words = cells.flatMap(([text, x]) => text.split(" ").map((t, i) => ({ text: t, conf, box: { page: 1, x: x + i * 0.035, y, w: 0.03, h: 0.02 } })));
  return { text: words.map((w) => w.text).join(" "), conf, box: { page: 1, x: 0.05, y, w: 0.9, h: 0.02 }, words };
}
const plain = (y: number, text: string, conf = 0.9) => line(y, [[text, 0.05]], conf);

describe("number and date reading", () => {
  it("reads amounts and dates as bills print them", () => {
    expect(parseNumber("Rs. 1,234.50/-")).toBe(1234.5);
    expect(parseNumber("12.5%")).toBe(12.5);
    expect(parseNumber("2O0")).toBe(200); // O read for zero
    expect(parseNumber("none")).toBeNull();
    expect(parseDate("Date: 12/10/2026")).toBe("2026-10-12");
    expect(parseDate("12-10-26")).toBe("2026-10-12");
    expect(parseDate("12 Oct 2026")).toBe("2026-10-12");
    expect(parseExpiry("04/28")).toBe("2028-04-30");
    expect(parseExpiry("APR-28")).toBe("2028-04-30");
    expect(parseExpiry("Feb 2028")).toBe("2028-02-29");
  });
});

describe("supplier bill", () => {
  const cols: [string, number][] = [["Item", 0.05], ["Batch", 0.4], ["Exp", 0.5], ["Qty", 0.58], ["Bonus", 0.65], ["Rate", 0.72], ["Disc%", 0.8], ["Amount", 0.9]];
  const row = (y: number, v: string[], conf?: number) => line(y, v.map((t, i) => [t, cols[i][1]] as [string, number]), conf);
  const doc = [
    plain(0.03, "Muller & Phipps Pakistan (Pvt) Ltd"),
    plain(0.06, "Invoice No: 45812 Date: 12/10/2026"),
    line(0.12, cols),
    row(0.15, ["Panadol 500mg Tab", "B771", "04/28", "100", "10", "2.80", "0", "280.00"]),
    row(0.18, ["Brufen 400mg Tab", "K19", "11/27", "50", "0", "4.10", "2", "200.90"], 0.6),
    plain(0.25, "Net Total 480.90"),
  ];

  it("maps cells by their column headings and reads the header fields", () => {
    const r = parseBill(doc)!;
    expect(r.header).toMatchObject({ supplierName: "Muller & Phipps Pakistan (Pvt) Ltd", invoiceNo: "45812", billDate: "2026-10-12", billTotal: 480.9 });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ name: "Panadol 500mg Tab", batchNumber: "B771", expiryDate: "2028-04-30", quantity: 100, bonusQty: 10, rate: 2.8, discountPercent: 0, amount: 280 });
    expect(r.lines[1]).toMatchObject({ name: "Brufen 400mg Tab", quantity: 50, rate: 4.1, discountPercent: 2, amount: 200.9 });
    expect(r.lines[1].confidence).toBeCloseTo(0.6);
    expect(r.lines[0].box).toMatchObject({ page: 1 });
  });

  it("falls back to loose lines when there is no table heading", () => {
    const r = parseDocument({ provider: "test", pages: [{ pageNo: 1, lines: [plain(0.1, "Panadol 500mg 20 exp 3/27")] }] }, "PURCHASE_BILL");
    expect(r.lines[0]).toMatchObject({ name: "Panadol 500mg", quantity: 20, expiryDate: "2027-03-31" });
  });
});

describe("stock list lines", () => {
  it("accepts the loose formats people write", () => {
    expect(parseListLine(plain(0.1, "Panadol 500mg 20 exp 3/27"))).toMatchObject({ name: "Panadol 500mg", quantity: 20, expiryDate: "2027-03-31" });
    expect(parseListLine(plain(0.1, "Augmentin 625 tab - 12 pcs exp Apr-28 batch AX12"))).toMatchObject({ name: "Augmentin 625 tab", quantity: 12, expiryDate: "2028-04-30", batchNumber: "AX12" });
    expect(parseListLine(plain(0.1, "1. Brufen syrup x 6 11/2027"))).toMatchObject({ name: "Brufen syrup", quantity: 6, expiryDate: "2027-11-30" });
    expect(parseListLine(plain(0.1, "Total 120"))).toMatchObject({ name: "Total" }); // the reviewer removes lines like this
    expect(parseListLine(plain(0.1, "--- 12 ---"))).toBeNull();
  });
});

describe("engine slips", () => {
  it("reads expiry cells that lost their slash, and batch codes without a label", () => {
    expect(parseExpiryCell("0529")).toBe("2029-05-31");
    expect(parseExpiryCell("01129")).toBe("2029-01-31");
    expect(parseExpiryCell("0312027")).toBe("2027-03-31");
    expect(parseExpiryCell("1329")).toBeNull();
    expect(parseListLine(plain(0.1, "Panadol 500mg Tablet AX8508 exp Mar-27 qty 10"))).toMatchObject({ name: "Panadol 500mg Tablet", batchNumber: "AX8508", quantity: 10 });
    expect(parseListLine(plain(0.1, "Disprin 300mg Tablet 2993 exp Aug-28 qty 30"))).toMatchObject({ name: "Disprin 300mg Tablet", batchNumber: "2993", quantity: 30 });
    expect(parseListLine(plain(0.1, "Vitamin B12 Injection 5"))).toMatchObject({ name: "Vitamin B12 Injection", batchNumber: null, quantity: 5 });
  });

  it("puts lost decimal points back when quantity x rate disagrees with the amount", () => {
    const base = { discountPercent: null, taxAmount: null };
    expect(reconcileAmounts({ ...base, quantity: 120, rate: 160.5, amount: 1926000 })).toMatchObject({ rate: 160.5, amount: 19260 });
    // both points lost agrees with itself and cannot be told apart from a large bill: left for the reviewer
    expect(reconcileAmounts({ ...base, quantity: 120, rate: 16050, amount: 1926000 })).toMatchObject({ rate: 16050 });
    expect(reconcileAmounts({ ...base, quantity: 10, rate: 2062, amount: 206.2 })).toMatchObject({ rate: 20.62, amount: 206.2 });
    expect(reconcileAmounts({ ...base, quantity: null, rate: 5.78, amount: 578 })).toMatchObject({ quantity: 100 });
    // a discount or tax makes the check unreliable, so nothing changes
    expect(reconcileAmounts({ quantity: 10, rate: 2062, amount: 206.2, discountPercent: 5, taxAmount: null })).toMatchObject({ rate: 2062 });
  });
});
