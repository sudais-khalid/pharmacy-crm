import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { addDays, todayStr } from "@/lib/dates";
import { adjustStock, batchTrace, setAsideBatches, stockCard, supplierReturnList, writeOffBatches } from "@/modules/inventory";
import { createPurchase } from "@/modules/procurement";
import { createReturn, createSale } from "@/modules/sales";
import { resetDb, makeUser, makeMedicine, makeBatch, makeCustomer, makeSupplier, ctxOf, inDays } from "./helpers";

beforeEach(resetDb);

const cash = { discountType: "AMOUNT" as const, discountValue: 0, paymentMethod: "CASH" as const };

describe("expiry handling", () => {
  it("writes off whole batches and sets others aside for the supplier, where they are not sold", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const m = await makeMedicine("Amoxil");
    const s = await makeSupplier();
    const expired = await makeBatch(m.id, "OLD", -3, 7);
    await createPurchase(c, { supplierId: s.id, purchaseDate: inDays(-30), discount: 0, paid: 0, paymentMethod: "CASH", items: [{ medicineId: m.id, batchNumber: "NEAR", expiryDate: inDays(20), quantity: 10, purchasePrice: 30, salePrice: 50 }] });
    const near = await platformDb.batch.findFirstOrThrow({ where: { batchNumber: "NEAR" } });

    expect(await writeOffBatches(c, { batchIds: [expired.id], note: "Expired on the shelf" })).toEqual({ batches: 1, units: 7 });
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: expired.id } })).quantity).toBe(0);
    expect(await platformDb.stockMovement.findFirst({ where: { batchId: expired.id, type: "EXPIRY" } })).toMatchObject({ quantity: -7, balanceAfter: 0 });

    await setAsideBatches(c, { batchIds: [near.id], aside: true, note: "Return to Test Supplier" });
    await expect(createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 1 }] })).rejects.toThrow(/Insufficient stock.*set aside/);
    const list = await supplierReturnList(c);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ batchNumber: "NEAR", quantity: 10, setAsideNote: "Return to Test Supplier", source: { supplier: { name: "Test Supplier" } } });

    await setAsideBatches(c, { batchIds: [near.id], aside: false });
    expect((await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 1 }] })).invoiceNo).toMatch(/^INV-/);
  });
});

describe("stock card", () => {
  it("balances: opening plus ins minus outs is the closing, and the closing today is the stock on the shelf", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const m = await makeMedicine("Panadol");
    const s = await makeSupplier();
    await makeBatch(m.id, "LEGACY", 200, 40); // stock from before movements were kept
    await createPurchase(c, { supplierId: s.id, purchaseDate: todayStr(), discount: 0, paid: 0, paymentMethod: "CASH", items: [{ medicineId: m.id, batchNumber: "P1", expiryDate: inDays(300), quantity: 50, bonusQty: 5, purchasePrice: 2, salePrice: 3 }] });
    const sale = await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 12 }] });
    const [line] = await platformDb.saleItem.findMany({ where: { saleId: sale.id } });
    await createReturn(c, { saleId: sale.id, refundMethod: "CASH", reason: "unused", items: [{ saleItemId: line.id, quantity: 2, restock: true }] });
    const p1 = await platformDb.batch.findFirstOrThrow({ where: { batchNumber: "P1" } });
    await adjustStock(c, { batchId: p1.id, kind: "DAMAGE", quantity: 1, note: "dropped" });

    const card = await stockCard(c, m.id, { from: addDays(todayStr(), -7), to: todayStr() });
    expect(card.opening).toBe(40);
    expect(card.in).toMatchObject({ PURCHASE: 55, SALE_RETURN: 2 });
    expect(card.out).toMatchObject({ SALE: 12, DAMAGE: 1 });
    expect(card.closing).toBe(card.opening + card.totalIn - card.totalOut);
    const shelf = await platformDb.batch.aggregate({ where: { medicineId: m.id }, _sum: { quantity: true } });
    expect(card.closing).toBe(shelf._sum.quantity);
    expect(card.lines.at(-1)?.balance).toBe(card.closing);

    // a range before anything moved: nothing in or out
    const before = await stockCard(c, m.id, { from: addDays(todayStr(), -30), to: addDays(todayStr(), -20) });
    expect(before).toMatchObject({ opening: 40, closing: 40, totalIn: 0, totalOut: 0, lines: [] });
    await expect(stockCard(c, m.id, { from: todayStr(), to: addDays(todayStr(), -1) })).rejects.toThrow(/start date/);
  });
});

describe("batch trace", () => {
  it("shows where a batch came from and who still has it, for a recall", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const m = await makeMedicine("Flagyl");
    const s = await makeSupplier();
    const customer = await platformDb.customer.update({ where: { id: (await makeCustomer(1000)).id }, data: { name: "Ahmed", phone: "0300-1111111" } });
    await createPurchase(c, { supplierId: s.id, purchaseDate: todayStr(), discount: 0, paid: 0, paymentMethod: "CASH", supplierInvoice: "BILL-9", items: [{ medicineId: m.id, batchNumber: "RECALL-1", expiryDate: inDays(300), quantity: 20, purchasePrice: 5, salePrice: 8 }] });
    const batch = await platformDb.batch.findFirstOrThrow({ where: { batchNumber: "RECALL-1" } });
    await createSale(c, { ...cash, paymentMethod: "CREDIT", customerId: customer.id, items: [{ medicineId: m.id, quantity: 3 }] });
    const walkIn = await createSale(c, { ...cash, customerName: "Bilal", customerPhone: "0311-2222222", items: [{ medicineId: m.id, quantity: 2 }] });
    const [wl] = await platformDb.saleItem.findMany({ where: { saleId: walkIn.id } });
    await createReturn(c, { saleId: walkIn.id, refundMethod: "CASH", reason: "unused", items: [{ saleItemId: wl.id, quantity: 2, restock: true }] });

    const t = await batchTrace(c, batch.id);
    expect(t).toMatchObject({ purchased: 20, sold: 5, returned: 2, inStock: 17 });
    expect(t.purchases[0].purchase).toMatchObject({ supplierInvoice: "BILL-9", supplier: { name: "Test Supplier" } });
    expect(t.sales).toHaveLength(2);
    // Bilal brought everything back: only Ahmed needs a call
    expect(t.holders).toEqual([{ name: "Ahmed", phone: "0300-1111111", quantity: 3 }]);
  });
});
