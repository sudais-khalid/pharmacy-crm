import { describe, it, expect } from "vitest";
import { cleanItemName, parseBill, parseDate, parseDocument, parseExpiry, parseExpiryAny, parseExpiryCell, parseListLine, parseNumber, reconcileAmounts, solveRow, type OcrLine } from "@/modules/stockentry";

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

describe("real distributor invoices", () => {
  // word positions as on the photographed bills; values made up
  const words = (y: number, items: [string, number][]) => line(y, items);

  it("finds quantity, rate and amount by arithmetic, wherever the columns are", () => {
    expect(solveRow([2, 2, 330.2, 660, 0, 664])).toMatchObject({ quantity: 2, rate: 330.2, amount: 660 }); // Qty, T.Qty, TP, Gross ... Net
    expect(solveRow([149.6, 10, 0, 1496, 7.48, 1496])).toMatchObject({ quantity: 10, rate: 149.6, amount: 1496 }); // TP before Qty
    expect(solveRow([0, 230.84, 0, 231])).toMatchObject({ quantity: 1, rate: 230.84, amount: 231 }); // the quantity unreadable
    expect(solveRow([228.02, 1, 114010, 3])).toMatchObject({ quantity: 5, rate: 228.02, amount: 1140.1 }); // a lost decimal point
    expect(solveRow([62295, 2, 1.246])).toMatchObject({ quantity: 2, rate: 622.95, amount: 1246 }); // point lost, comma read as a point
    expect(solveRow([4, 0, 12])).toBeNull();
  });

  it("strips distributor codes from names and reads every expiry form", () => {
    expect(cleanItemName("MONITOR 5MG TAB / 808")).toEqual({ name: "MONITOR 5MG TAB", code: "808" });
    expect(cleanItemName("055/ESSO 40MG CAPSULE 14'S")).toEqual({ name: "ESSO 40MG CAPSULE 14'S", code: "055" });
    expect(cleanItemName("1 11149 * AVSAR PLUS TAB").name).toBe("AVSAR PLUS TAB");
    expect(parseExpiryAny("30/06/2028")).toBe("2028-06-30");
    expect(parseExpiryAny("DEC/2028")).toBe("2028-12-31");
    expect(parseExpiryAny("02-28")).toBe("2028-02-29");
    expect(parseExpiryAny("/5-28")).toBe("2028-05-31");
  });

  it("reads a Saif-style table with a two-word heading and an unreadable Exp. heading", () => {
    const head = words(0.30, [["Description", 0.06], ["Batch", 0.30], ["N.Qty", 0.36], ["BNS", 0.40], ["T.Qty", 0.44], ["xx.", 0.49], ["TP", 0.54], ["Gross", 0.59], ["Amt", 0.62], ["Net", 0.92], ["Amt", 0.95]]);
    const row = words(0.33, [["MONITOR 5MG TAB / 808", 0.04], ["UT274", 0.30], ["1", 0.36], ["1", 0.44], ["03-28", 0.49], ["186.63", 0.54], ["187", 0.61], ["0.50%", 0.85], ["188", 0.94]]);
    const total = plain(0.4, "INVOICE TOTAL 10 0 10 2,594 13 2,607");
    const r = parseBill([plain(0.05, "Saif Enterprises Mardan"), plain(0.1, "Invoice No.: 784679"), head, row, total])!;
    expect(r.header).toMatchObject({ supplierName: "Saif Enterprises Mardan", invoiceNo: "784679" });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ name: "MONITOR 5MG TAB", batchNumber: "UT274", expiryDate: "2028-03-31", quantity: 1, rate: 186.63 });
  });

  it("reads a Premier-style table: batch and expiry in one cell, manufacturer headings between groups", () => {
    const head = words(0.20, [["Description", 0.10], ["M.R.P", 0.30], ["TP", 0.36], ["Qty.", 0.42], ["Bon", 0.47], ["Batch/", 0.53], ["Amount", 0.62], ["Net", 0.92]]);
    const group = words(0.24, [["PHARMEVO (PVT) LIMITED", 0.10]]);
    const row = words(0.27, [["1 11149 * BYVAS 2.5MG TABLET", 0.04], ["0.00", 0.30], ["230.84", 0.36], ["I", 0.42], ["0", 0.47], ["6H231 /6-28", 0.52], ["231", 0.62], ["231", 0.93]]);
    const r = parseBill([head, group, row])!;
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ name: "BYVAS 2.5MG TABLET", batchNumber: "6H231", expiryDate: "2028-06-30", quantity: 1, rate: 230.84 });
  });
});
