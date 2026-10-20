import { describe, it, expect, beforeEach } from "vitest";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { exportPharmacyData } from "@/modules/tenancy";
import { createSale } from "@/modules/sales";
import { resetDb, makePharmacy, makeUser, makeMedicine, makeBatch, makeCustomer, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

describe("pharmacy data export", () => {
  it("holds every record of the pharmacy, nothing of another one, and no secrets", async () => {
    const other = await makePharmacy("export-other");
    await makeMedicine("Other Pharmacy Syrup", {}, other.id);
    await makeUser("ADMIN", other.id);
    const u = await makeUser("ADMIN");
    const m = await makeMedicine("Export Panadol");
    await makeBatch(m.id, "EX1", 300, 20);
    const c = await makeCustomer(5000);
    await createSale(ctxOf(u), { items: [{ medicineId: m.id, quantity: 2 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CREDIT", customerId: c.id });

    const r = await exportPharmacyData(pharmacyId);
    expect(r.name).toMatch(/-data-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = await JSZip.loadAsync(r.file);
    const names = Object.keys(zip.files);
    expect(names).toEqual(expect.arrayContaining(["README.txt", "summary.xlsx", "csv/medicine.csv", "csv/sale.csv", "csv/sale-item.csv", "csv/customer-ledger.csv", "csv/user.csv"]));
    for (const skipped of ["csv/auth-token.csv", "csv/outbox-event.csv", "csv/support-session.csv"]) expect(names).not.toContain(skipped);

    const all = (await Promise.all(names.filter((n) => n.endsWith(".csv")).map((n) => zip.file(n)!.async("string")))).join("\n");
    expect(all).toContain("Export Panadol");
    expect(all).not.toContain("Other Pharmacy Syrup");
    expect(all).not.toContain(other.id);
    const users = await zip.file("csv/user.csv")!.async("string");
    expect(users.split("\n")[0]).not.toMatch(/passwordHash|totpSecret|recoveryCodes|pharmacyId/);
    expect(users).not.toMatch(/\$2[aby]\$/); // no bcrypt hash anywhere
    expect((await zip.file("csv/sale-item.csv")!.async("string")).trim().split("\n")).toHaveLength(2);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await zip.file("summary.xlsx")!.async("uint8array")) as unknown as ArrayBuffer);
    const meds = wb.getWorksheet("Medicines")!;
    expect(meds.getRow(2).getCell(1).value).toBe("Export Panadol");
    expect(meds.getRow(2).getCell(6).value).toBe(18); // 20 bought, 2 sold
    expect(Number(wb.getWorksheet("Customers")!.getRow(2).getCell(4).value)).toBeGreaterThan(0);
  });

  it("refuses an unknown pharmacy", async () => {
    await expect(exportPharmacyData("00000000-0000-4000-a000-00000000dead")).rejects.toThrow(/not found/i);
    await expect(exportPharmacyData("x'; DROP TABLE \"Sale\"; --")).rejects.toThrow(/not found/i);
  });
});
