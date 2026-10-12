import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { createSale, cancelSale } from "@/modules/sales";
import { receiveCustomerPayment, customerBalance } from "@/modules/customers";
import { resetDb, makeUser, makeMedicine, makeBatch, makeCustomer, ctxOf } from "./helpers";

const line = (medicineId: string, quantity: number) => ({ medicineId, quantity });
const base = { discountType: "AMOUNT" as const, discountValue: 0, paymentMethod: "CASH" as const };

beforeEach(resetDb);

describe("FEFO allocation", () => {
  it("sells from the earliest-expiring batch first and spans batches", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 30, 20, 50);
    const b = await makeBatch(m.id, "B", 200, 50, 52);
    const sale = await createSale(ctxOf(u), { ...base, items: [line(m.id, 25)] });
    const items = await platformDb.saleItem.findMany({ where: { saleId: sale.id }, orderBy: { quantity: "desc" } });
    expect(items.map((i) => [i.batchId, i.quantity])).toEqual([[a.id, 20], [b.id, 5]]);
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: a.id } })).quantity).toBe(0);
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: b.id } })).quantity).toBe(45);
    expect(sale.subtotal.toString()).toBe("1260"); // 20*50 + 5*52
  });

  it("never sells expired batches", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "OLD", -5, 100);
    await makeBatch(m.id, "NEW", 100, 5);
    await expect(createSale(ctxOf(u), { ...base, items: [line(m.id, 10)] })).rejects.toThrow(/Insufficient stock/);
    const ok = await createSale(ctxOf(u), { ...base, items: [line(m.id, 5)] });
    expect(ok.total.toString()).toBe("250");
    expect((await platformDb.batch.findFirstOrThrow({ where: { batchNumber: "OLD" } })).quantity).toBe(100);
  });
});

describe("sale integrity", () => {
  it("rolls back everything when any line fails", async () => {
    const u = await makeUser();
    const m1 = await makeMedicine("One");
    const m2 = await makeMedicine("Two");
    await makeBatch(m1.id, "X", 90, 10);
    await makeBatch(m2.id, "Y", 90, 1);
    await expect(createSale(ctxOf(u), { ...base, items: [line(m1.id, 5), line(m2.id, 3)] })).rejects.toThrow(/Insufficient/);
    expect((await platformDb.batch.findFirstOrThrow({ where: { batchNumber: "X" } })).quantity).toBe(10);
    expect(await platformDb.sale.count()).toBe(0);
    expect(await platformDb.stockMovement.count()).toBe(0);
  });

  it("calculates percent discounts and records movements", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 10, 50);
    const sale = await createSale(ctxOf(u), { ...base, items: [line(m.id, 2)], discountType: "PERCENT", discountValue: 10 });
    expect(sale.subtotal.toString()).toBe("100");
    expect(sale.discount.toString()).toBe("10");
    expect(sale.total.toString()).toBe("90");
    expect(sale.amountPaid.toString()).toBe("90");
    const mv = await platformDb.stockMovement.findMany();
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ type: "SALE", quantity: -2, balanceAfter: 8, reference: sale.invoiceNo });
  });

  it("rejects archived medicines and discounts above the subtotal", async () => {
    const u = await makeUser();
    const m = await makeMedicine("Archived", { active: false });
    await makeBatch(m.id, "A", 90, 10);
    await expect(createSale(ctxOf(u), { ...base, items: [line(m.id, 1)] })).rejects.toThrow(/archived/);
    const m2 = await makeMedicine("Active");
    await makeBatch(m2.id, "B", 90, 10, 50);
    await expect(createSale(ctxOf(u), { ...base, items: [line(m2.id, 1)], discountValue: 500 })).rejects.toThrow(/Discount/);
  });

  it("generates unique invoice numbers", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 50);
    const s = await Promise.all([1, 2, 3, 4, 5].map(() => createSale(ctxOf(u), { ...base, items: [line(m.id, 1)] })));
    expect(new Set(s.map((x) => x.invoiceNo)).size).toBe(5);
    expect((await platformDb.batch.findFirstOrThrow()).quantity).toBe(45);
  });

  it("concurrent sales cannot oversell", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 5);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => createSale(ctxOf(u), { ...base, items: [line(m.id, 2)] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await platformDb.batch.findFirstOrThrow()).quantity).toBe(1);
  });
});

describe("credit (udhaar)", () => {
  it("records a debit, enforces the limit, allows override and payments", async () => {
    const cashier = await makeUser("CASHIER");
    const pharmacist = await makeUser("PHARMACIST");
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 100, 100);
    const c = await makeCustomer(1000);

    await createSale(ctxOf(cashier), { ...base, paymentMethod: "CREDIT", customerId: c.id, items: [line(m.id, 5)] }); // 500 owed
    expect((await customerBalance(platformDb, c.id)).toString()).toBe("500");

    await expect(createSale(ctxOf(cashier), { ...base, paymentMethod: "CREDIT", customerId: c.id, items: [line(m.id, 6)] })).rejects.toThrow(/Credit limit exceeded/);
    expect((await customerBalance(platformDb, c.id)).toString()).toBe("500");

    await createSale(ctxOf(pharmacist), { ...base, paymentMethod: "CREDIT", customerId: c.id, items: [line(m.id, 6)] }); // override
    expect((await customerBalance(platformDb, c.id)).toString()).toBe("1100");

    await receiveCustomerPayment(ctxOf(cashier), c.id, { amount: 300, method: "CASH" });
    expect((await customerBalance(platformDb, c.id)).toString()).toBe("800");
    await expect(receiveCustomerPayment(ctxOf(cashier), c.id, { amount: 900, method: "CASH" })).rejects.toThrow(/more than the outstanding/);
  });

  it("partial payment at the till leaves the remainder on credit", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 100, 100);
    const c = await makeCustomer(5000);
    await createSale(ctxOf(u), { ...base, paymentMethod: "CASH", amountPaid: 150, customerId: c.id, items: [line(m.id, 4)] });
    expect((await customerBalance(platformDb, c.id)).toString()).toBe("250");
  });

  it("requires a customer for credit sales", async () => {
    const u = await makeUser("ADMIN");
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 10);
    await expect(createSale(ctxOf(u), { ...base, paymentMethod: "CREDIT", items: [line(m.id, 1)] })).rejects.toThrow(/customer/i);
  });
});

describe("cancel sale", () => {
  it("restores the exact batches and reverses the ledger", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 30, 20);
    const b = await makeBatch(m.id, "B", 200, 50);
    const c = await makeCustomer(10000);
    const sale = await createSale(ctxOf(u), { ...base, paymentMethod: "CASH", amountPaid: 500, customerId: c.id, items: [line(m.id, 25)] });
    expect((await customerBalance(platformDb, c.id)).toString()).toBe("750");
    await cancelSale(ctxOf(u), sale.id, "Customer changed mind");
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: a.id } })).quantity).toBe(20);
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: b.id } })).quantity).toBe(50);
    expect((await customerBalance(platformDb, c.id)).toString()).toBe("0");
    await expect(cancelSale(ctxOf(u), sale.id, "again")).rejects.toThrow(/already cancelled/);
  });
});

describe("invariants", () => {
  it("batch quantity always equals the sum of its stock movements", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 60, 0);
    await platformDb.stockMovement.create({ data: { pharmacyId: m.pharmacyId, medicineId: m.id, batchId: a.id, type: "OPENING", quantity: 0, balanceAfter: 0 } });
    const { adjustStock } = await import("@/modules/inventory");
    await adjustStock(ctxOf(u), { batchId: a.id, kind: "ADD", quantity: 40, note: "opening count" });
    await createSale(ctxOf(u), { ...base, items: [line(m.id, 7)] });
    await adjustStock(ctxOf(u), { batchId: a.id, kind: "DAMAGE", quantity: 3, note: "broken" });
    const sum = await platformDb.stockMovement.aggregate({ where: { batchId: a.id }, _sum: { quantity: true } });
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: a.id } })).quantity).toBe(sum._sum.quantity);
  });

  it("database refuses negative stock", async () => {
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 60, 3);
    await expect(platformDb.$executeRawUnsafe(`UPDATE "Batch" SET quantity = -1 WHERE id = '${a.id}'`)).rejects.toThrow();
  });
});

describe("service context", () => {
  it("composes several services into one caller transaction that rolls back as a whole", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 60, 10);
    const { adjustStock } = await import("@/modules/inventory");
    const { runInTx } = await import("@/lib/db");

    await expect(
      runInTx(ctxOf(u), async (tx) => {
        const ctx = { ...ctxOf(u), tx };
        await createSale(ctx, { ...base, items: [line(m.id, 4)] });
        await adjustStock(ctx, { batchId: a.id, kind: "DAMAGE", quantity: 2, note: "broken in transit" });
        throw new Error("abort after both writes");
      }),
    ).rejects.toThrow(/abort/);

    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: a.id } })).quantity).toBe(10);
    expect(await platformDb.sale.count()).toBe(0);
    expect(await platformDb.stockMovement.count({ where: { batchId: a.id } })).toBe(0);
  });
});
