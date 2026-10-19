import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { prisma } from "@/lib/prisma";
import { tenantTransaction } from "@/lib/db";
import { createSale } from "@/modules/sales";
import { getSettings, updateSettings } from "@/modules/platform";
import { SYSTEM_ROLES } from "@/modules/identity";
import { resetDb, makePharmacy, makeUser, makeMedicine, makeBatch, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const sale = (medicineId: string) => ({ items: [{ medicineId, quantity: 1 }], discountType: "AMOUNT" as const, discountValue: 0, paymentMethod: "CASH" as const });

describe("tenant scoping", () => {
  it("fills pharmacyId from the tenant transaction and refuses rows without a pharmacy", async () => {
    const created = await tenantTransaction(pharmacyId, (tx) => tx.category.create({ data: { name: "Analgesics" } }));
    expect(created.pharmacyId).toBe(pharmacyId);
    await expect(prisma.category.create({ data: { name: "Orphan" } })).rejects.toThrow();
  });

  it("numbers invoices per pharmacy, each series starting at 1", async () => {
    const other = await makePharmacy("other");
    const numbers: string[] = [];
    for (const pid of [pharmacyId, other.id, pharmacyId]) {
      const u = await makeUser("CASHIER", pid);
      const m = await makeMedicine("Panadol", {}, pid);
      await makeBatch(m.id, "A", 90, 10, 50, 40, pid);
      numbers.push((await createSale(ctxOf(u), sale(m.id))).invoiceNo);
    }
    expect(numbers.map((n) => n.slice(-5))).toEqual(["00001", "00001", "00002"]);
    const counters = await platformDb.tenantCounter.findMany({ orderBy: { value: "asc" } });
    expect(counters.map((c) => [c.pharmacyId === pharmacyId ? "test" : "other", c.key, Number(c.value)])).toEqual([["other", "INVOICE", 1], ["test", "INVOICE", 2]]);
  });

  it("allows the same invoice number, barcode and username in different pharmacies", async () => {
    const other = await makePharmacy("other");
    await makeMedicine("Panadol", { barcode: "8901" });
    await makeMedicine("Panadol", { barcode: "8901" }, other.id);
    await expect(makeMedicine("Copy", { barcode: "8901" })).rejects.toThrow();
    await platformDb.user.create({ data: { pharmacyId, name: "Ali", email: "ali-a@t.test", username: "ali", passwordHash: "x", roleId: SYSTEM_ROLES.CASHIER.id } });
    await platformDb.user.create({ data: { pharmacyId: other.id, name: "Ali", email: "ali-b@t.test", username: "ali", passwordHash: "x", roleId: SYSTEM_ROLES.CASHIER.id } });
    expect(await platformDb.user.count({ where: { username: "ali" } })).toBe(2);
  });
});

describe("pharmacy settings", () => {
  it("reads and updates the pharmacy profile and settings, with an audit row", async () => {
    const u = await makeUser("ADMIN");
    const before = await tenantTransaction(pharmacyId, (tx) => getSettings(tx, pharmacyId));
    expect(before).toMatchObject({ pharmacyName: "Pharmacy test", currency: "PKR", expiryWarningDays: 90 });
    const after = await updateSettings(ctxOf(u), { ...before, pharmacyName: "City Care", expiryWarningDays: 60, email: "" });
    expect(after).toMatchObject({ pharmacyName: "City Care", expiryWarningDays: 60, email: "" });
    const row = await platformDb.auditLog.findFirstOrThrow({ where: { action: "settings.update" } });
    expect(row.pharmacyId).toBe(pharmacyId);
    expect(row.after).toMatchObject({ pharmacyName: "City Care" });
  });
});
