import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPurchase } from "@/services/purchases";
import { paySupplier } from "@/services/ledger";
import { adjustStock } from "@/services/inventory";
import { supplierBalance } from "@/services/common";
import { can } from "@/lib/permissions";
import { resetDb, makeUser, makeMedicine, makeBatch, makeSupplier, inDays } from "./helpers";

beforeEach(resetDb);

const input = (supplierId: string, medicineId: string, over: Record<string, unknown> = {}) => ({
  supplierId, purchaseDate: inDays(0), discount: 0, paid: 0, paymentMethod: "CASH" as const,
  items: [{ medicineId, batchNumber: "B1", expiryDate: inDays(365), quantity: 100, purchasePrice: 40, salePrice: 50 }],
  ...over,
});

describe("purchases", () => {
  it("creates a batch, increases stock, writes a movement and the supplier ledger", async () => {
    const u = await makeUser("ADMIN");
    const s = await makeSupplier();
    const m = await makeMedicine();
    const p = await createPurchase(input(s.id, m.id, { discount: 100, paid: 1000 }), u.id);
    expect(p.subtotal.toString()).toBe("4000");
    expect(p.total.toString()).toBe("3900");
    const b = await prisma.batch.findFirstOrThrow({ where: { medicineId: m.id } });
    expect(b.quantity).toBe(100);
    expect(await prisma.stockMovement.count({ where: { type: "PURCHASE", batchId: b.id } })).toBe(1);
    expect((await supplierBalance(prisma, s.id)).toString()).toBe("2900");
    await paySupplier(s.id, { amount: 2900, method: "CASH" }, u.id);
    expect((await supplierBalance(prisma, s.id)).toString()).toBe("0");
    await expect(paySupplier(s.id, { amount: 1, method: "CASH" }, u.id)).rejects.toThrow(/more than the outstanding/);
  });

  it("adds to an existing batch but refuses a different expiry for the same batch number", async () => {
    const u = await makeUser("ADMIN");
    const s = await makeSupplier();
    const m = await makeMedicine();
    await createPurchase(input(s.id, m.id), u.id);
    await createPurchase(input(s.id, m.id), u.id);
    expect((await prisma.batch.findFirstOrThrow({ where: { medicineId: m.id } })).quantity).toBe(200);
    const bad = input(s.id, m.id, { items: [{ medicineId: m.id, batchNumber: "B1", expiryDate: inDays(10), quantity: 5, purchasePrice: 40, salePrice: 50 }] });
    await expect(createPurchase(bad, u.id)).rejects.toThrow(/different expiry/);
    expect(await prisma.purchase.count()).toBe(2); // failed purchase rolled back
  });

  it("rejects already-expired stock and overpayment", async () => {
    const u = await makeUser("ADMIN");
    const s = await makeSupplier();
    const m = await makeMedicine();
    const expired = input(s.id, m.id, { items: [{ medicineId: m.id, batchNumber: "E", expiryDate: inDays(-1), quantity: 5, purchasePrice: 1, salePrice: 2 }] });
    await expect(createPurchase(expired, u.id)).rejects.toThrow(/expired/);
    await expect(createPurchase(input(s.id, m.id, { paid: 999999 }), u.id)).rejects.toThrow(/exceed/);
  });
});

describe("stock adjustments", () => {
  it("cannot remove more than the batch holds and records a movement", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine();
    const b = await makeBatch(m.id, "A", 60, 10);
    await expect(adjustStock({ batchId: b.id, kind: "REMOVE", quantity: 11, note: "count" }, u.id)).rejects.toThrow(/Only 10/);
    await adjustStock({ batchId: b.id, kind: "EXPIRY", quantity: 4, note: "expired stock" }, u.id);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: b.id } })).quantity).toBe(6);
    expect(await prisma.stockMovement.findFirstOrThrow({ where: { type: "EXPIRY" } })).toMatchObject({ quantity: -4, balanceAfter: 6 });
  });
});

describe("role permissions", () => {
  it("cashiers cannot manage users or delete medicines; admins can", () => {
    expect(can("CASHIER", "pos.use")).toBe(true);
    expect(can("CASHIER", "medicines.delete")).toBe(false);
    expect(can("CASHIER", "users.manage")).toBe(false);
    expect(can("CASHIER", "sales.overrideCredit")).toBe(false);
    expect(can("PHARMACIST", "purchases.create")).toBe(true);
    expect(can("PHARMACIST", "users.manage")).toBe(false);
    expect(can("ADMIN", "users.manage")).toBe(true);
  });
});
