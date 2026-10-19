import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { createPurchase, paySupplier, supplierBalance } from "@/modules/procurement";
import { adjustStock } from "@/modules/inventory";
import { SYSTEM_ROLES, can } from "@/modules/identity";
import { resetDb, makeUser, makeMedicine, makeBatch, makeSupplier, inDays, ctxOf } from "./helpers";

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
    const p = await createPurchase(ctxOf(u), input(s.id, m.id, { discount: 100, paid: 1000 }));
    expect(p.subtotal.toString()).toBe("4000");
    expect(p.total.toString()).toBe("3900");
    const b = await platformDb.batch.findFirstOrThrow({ where: { medicineId: m.id } });
    expect(b.quantity).toBe(100);
    expect(await platformDb.stockMovement.count({ where: { type: "PURCHASE", batchId: b.id } })).toBe(1);
    expect((await supplierBalance(platformDb, s.id)).toString()).toBe("2900");
    await paySupplier(ctxOf(u), s.id, { amount: 2900, method: "CASH" });
    expect((await supplierBalance(platformDb, s.id)).toString()).toBe("0");
    await expect(paySupplier(ctxOf(u), s.id, { amount: 1, method: "CASH" })).rejects.toThrow(/more than the outstanding/);
  });

  it("adds to an existing batch but refuses a different expiry for the same batch number", async () => {
    const u = await makeUser("ADMIN");
    const s = await makeSupplier();
    const m = await makeMedicine();
    await createPurchase(ctxOf(u), input(s.id, m.id));
    await createPurchase(ctxOf(u), input(s.id, m.id));
    expect((await platformDb.batch.findFirstOrThrow({ where: { medicineId: m.id } })).quantity).toBe(200);
    const bad = input(s.id, m.id, { items: [{ medicineId: m.id, batchNumber: "B1", expiryDate: inDays(10), quantity: 5, purchasePrice: 40, salePrice: 50 }] });
    await expect(createPurchase(ctxOf(u), bad)).rejects.toThrow(/different expiry/);
    expect(await platformDb.purchase.count()).toBe(2); // failed purchase rolled back
  });

  it("rejects already-expired stock and overpayment", async () => {
    const u = await makeUser("ADMIN");
    const s = await makeSupplier();
    const m = await makeMedicine();
    const expired = input(s.id, m.id, { items: [{ medicineId: m.id, batchNumber: "E", expiryDate: inDays(-1), quantity: 5, purchasePrice: 1, salePrice: 2 }] });
    await expect(createPurchase(ctxOf(u), expired)).rejects.toThrow(/expired/);
    await expect(createPurchase(ctxOf(u), input(s.id, m.id, { paid: 999999 }))).rejects.toThrow(/exceed/);
  });
});

describe("stock adjustments", () => {
  it("cannot remove more than the batch holds and records a movement", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine();
    const b = await makeBatch(m.id, "A", 60, 10);
    await expect(adjustStock(ctxOf(u), { batchId: b.id, kind: "REMOVE", quantity: 11, note: "count" })).rejects.toThrow(/Only 10/);
    await adjustStock(ctxOf(u), { batchId: b.id, kind: "EXPIRY", quantity: 4, note: "expired stock" });
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: b.id } })).quantity).toBe(6);
    expect(await platformDb.stockMovement.findFirstOrThrow({ where: { type: "EXPIRY" } })).toMatchObject({ quantity: -4, balanceAfter: 6 });
  });
});

describe("role permissions", () => {
  it("cashiers cannot manage users or delete medicines; admins can", () => {
    const [cashier, pharmacist, admin] = (["CASHIER", "PHARMACIST", "PHARMACY_ADMIN"] as const).map((k) => ({ permissions: SYSTEM_ROLES[k].permissions }));
    expect(can(cashier, "pos.use")).toBe(true);
    expect(can(cashier, "medicines.delete")).toBe(false);
    expect(can(cashier, "users.manage")).toBe(false);
    expect(can(cashier, "sales.overrideCredit")).toBe(false);
    expect(can(cashier, "cost.view")).toBe(false);
    expect(can(pharmacist, "purchases.create")).toBe(true);
    expect(can(pharmacist, "users.manage")).toBe(false);
    expect(can(admin, "users.manage")).toBe(true);
  });
});

describe("bill lines with bonus, discount and tax", () => {
  it("cost every received unit, raise stock by paid plus free units, and refuse the same bill twice", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine("Brufen");
    const s = await makeSupplier();
    // 100 at 2.80, 10% off, 12.60 tax, 10 free: line 252 + 12.60 = 264.60 over 110 units
    const p = await createPurchase(ctxOf(u), {
      supplierId: s.id, supplierInvoice: "INV-77", purchaseDate: inDays(0), discount: 0, paid: 0, paymentMethod: "CASH",
      items: [{ medicineId: m.id, batchNumber: "K19", expiryDate: inDays(400), quantity: 100, bonusQty: 10, purchasePrice: 2.8, discountPercent: 10, taxAmount: 12.6, salePrice: 4 }],
    });
    expect(p).toMatchObject({ subtotal: expect.anything(), taxTotal: expect.anything() });
    expect(Number(p.subtotal)).toBe(252);
    expect(Number(p.taxTotal)).toBe(12.6);
    expect(Number(p.total)).toBe(264.6);
    const batch = await platformDb.batch.findFirstOrThrow({ where: { medicineId: m.id } });
    expect(batch.quantity).toBe(110);
    expect(Number(batch.purchasePrice)).toBeCloseTo(2.4055, 4);
    const item = await platformDb.purchaseItem.findFirstOrThrow({ where: { purchaseId: p.id } });
    expect(item).toMatchObject({ bonusQty: 10 });
    expect(Number(item.effectiveCost)).toBeCloseTo(2.4055, 4);
    expect(Number(item.lineTotal)).toBe(264.6);
    const debit = await platformDb.supplierLedger.findFirstOrThrow({ where: { purchaseId: p.id, kind: "INVOICE" } });
    expect(Number(debit.debit)).toBe(264.6);
    expect((await platformDb.stockMovement.findFirstOrThrow({ where: { reference: p.number } })).quantity).toBe(110);

    await expect(createPurchase(ctxOf(u), {
      supplierId: s.id, supplierInvoice: "INV-77", purchaseDate: inDays(0), discount: 0, paid: 0, paymentMethod: "CASH",
      items: [{ medicineId: m.id, batchNumber: "K20", expiryDate: inDays(400), quantity: 1, purchasePrice: 3, salePrice: 4 }],
    })).rejects.toThrow(/already recorded as PUR-/);
  });
});
