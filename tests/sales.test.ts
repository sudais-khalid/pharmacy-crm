import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSale, cancelSale } from "@/services/sales";
import { receiveCustomerPayment } from "@/services/ledger";
import { customerBalance } from "@/services/common";
import { resetDb, makeUser, makeMedicine, makeBatch, makeCustomer } from "./helpers";

const line = (medicineId: string, quantity: number) => ({ medicineId, quantity });
const base = { discountType: "AMOUNT" as const, discountValue: 0, paymentMethod: "CASH" as const };

beforeEach(resetDb);

describe("FEFO allocation", () => {
  it("sells from the earliest-expiring batch first and spans batches", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 30, 20, 50);
    const b = await makeBatch(m.id, "B", 200, 50, 52);
    const sale = await createSale({ ...base, items: [line(m.id, 25)] }, u);
    const items = await prisma.saleItem.findMany({ where: { saleId: sale.id }, orderBy: { quantity: "desc" } });
    expect(items.map((i) => [i.batchId, i.quantity])).toEqual([[a.id, 20], [b.id, 5]]);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: a.id } })).quantity).toBe(0);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: b.id } })).quantity).toBe(45);
    expect(sale.subtotal.toString()).toBe("1260"); // 20*50 + 5*52
  });

  it("never sells expired batches", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "OLD", -5, 100);
    await makeBatch(m.id, "NEW", 100, 5);
    await expect(createSale({ ...base, items: [line(m.id, 10)] }, u)).rejects.toThrow(/Insufficient stock/);
    const ok = await createSale({ ...base, items: [line(m.id, 5)] }, u);
    expect(ok.total.toString()).toBe("250");
    expect((await prisma.batch.findFirstOrThrow({ where: { batchNumber: "OLD" } })).quantity).toBe(100);
  });
});

describe("sale integrity", () => {
  it("rolls back everything when any line fails", async () => {
    const u = await makeUser();
    const m1 = await makeMedicine("One");
    const m2 = await makeMedicine("Two");
    await makeBatch(m1.id, "X", 90, 10);
    await makeBatch(m2.id, "Y", 90, 1);
    await expect(createSale({ ...base, items: [line(m1.id, 5), line(m2.id, 3)] }, u)).rejects.toThrow(/Insufficient/);
    expect((await prisma.batch.findFirstOrThrow({ where: { batchNumber: "X" } })).quantity).toBe(10);
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("calculates percent discounts and records movements", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 10, 50);
    const sale = await createSale({ ...base, items: [line(m.id, 2)], discountType: "PERCENT", discountValue: 10 }, u);
    expect(sale.subtotal.toString()).toBe("100");
    expect(sale.discount.toString()).toBe("10");
    expect(sale.total.toString()).toBe("90");
    expect(sale.amountPaid.toString()).toBe("90");
    const mv = await prisma.stockMovement.findMany();
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ type: "SALE", quantity: -2, balanceAfter: 8, reference: sale.invoiceNo });
  });

  it("rejects archived medicines and discounts above the subtotal", async () => {
    const u = await makeUser();
    const m = await makeMedicine("Archived", { active: false });
    await makeBatch(m.id, "A", 90, 10);
    await expect(createSale({ ...base, items: [line(m.id, 1)] }, u)).rejects.toThrow(/archived/);
    const m2 = await makeMedicine("Active");
    await makeBatch(m2.id, "B", 90, 10, 50);
    await expect(createSale({ ...base, items: [line(m2.id, 1)], discountValue: 500 }, u)).rejects.toThrow(/Discount/);
  });

  it("generates unique invoice numbers", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 50);
    const s = await Promise.all([1, 2, 3, 4, 5].map(() => createSale({ ...base, items: [line(m.id, 1)] }, u)));
    expect(new Set(s.map((x) => x.invoiceNo)).size).toBe(5);
    expect((await prisma.batch.findFirstOrThrow()).quantity).toBe(45);
  });

  it("concurrent sales cannot oversell", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 5);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => createSale({ ...base, items: [line(m.id, 2)] }, u)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await prisma.batch.findFirstOrThrow()).quantity).toBe(1);
  });
});

describe("credit (udhaar)", () => {
  it("records a debit, enforces the limit, allows override and payments", async () => {
    const cashier = await makeUser("CASHIER");
    const pharmacist = await makeUser("PHARMACIST");
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 100, 100);
    const c = await makeCustomer(1000);

    await createSale({ ...base, paymentMethod: "CREDIT", customerId: c.id, items: [line(m.id, 5)] }, cashier); // 500 owed
    expect((await customerBalance(prisma, c.id)).toString()).toBe("500");

    await expect(createSale({ ...base, paymentMethod: "CREDIT", customerId: c.id, items: [line(m.id, 6)] }, cashier)).rejects.toThrow(/Credit limit exceeded/);
    expect((await customerBalance(prisma, c.id)).toString()).toBe("500");

    await createSale({ ...base, paymentMethod: "CREDIT", customerId: c.id, items: [line(m.id, 6)] }, pharmacist); // override
    expect((await customerBalance(prisma, c.id)).toString()).toBe("1100");

    await receiveCustomerPayment(c.id, { amount: 300, method: "CASH" }, cashier.id);
    expect((await customerBalance(prisma, c.id)).toString()).toBe("800");
    await expect(receiveCustomerPayment(c.id, { amount: 900, method: "CASH" }, cashier.id)).rejects.toThrow(/more than the outstanding/);
  });

  it("partial payment at the till leaves the remainder on credit", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 100, 100);
    const c = await makeCustomer(5000);
    await createSale({ ...base, paymentMethod: "CASH", amountPaid: 150, customerId: c.id, items: [line(m.id, 4)] }, u);
    expect((await customerBalance(prisma, c.id)).toString()).toBe("250");
  });

  it("requires a customer for credit sales", async () => {
    const u = await makeUser("ADMIN");
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 10);
    await expect(createSale({ ...base, paymentMethod: "CREDIT", items: [line(m.id, 1)] }, u)).rejects.toThrow(/customer/i);
  });
});

describe("cancel sale", () => {
  it("restores the exact batches and reverses the ledger", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 30, 20);
    const b = await makeBatch(m.id, "B", 200, 50);
    const c = await makeCustomer(10000);
    const sale = await createSale({ ...base, paymentMethod: "CASH", amountPaid: 500, customerId: c.id, items: [line(m.id, 25)] }, u);
    expect((await customerBalance(prisma, c.id)).toString()).toBe("750");
    await cancelSale(sale.id, "Customer changed mind", u.id);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: a.id } })).quantity).toBe(20);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: b.id } })).quantity).toBe(50);
    expect((await customerBalance(prisma, c.id)).toString()).toBe("0");
    await expect(cancelSale(sale.id, "again", u.id)).rejects.toThrow(/already cancelled/);
  });
});

describe("invariants", () => {
  it("batch quantity always equals the sum of its stock movements", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 60, 0);
    await prisma.stockMovement.create({ data: { medicineId: m.id, batchId: a.id, type: "OPENING", quantity: 0, balanceAfter: 0 } });
    const { adjustStock } = await import("@/services/inventory");
    await adjustStock({ batchId: a.id, kind: "ADD", quantity: 40, note: "opening count" }, u.id);
    await createSale({ ...base, items: [line(m.id, 7)] }, u);
    await adjustStock({ batchId: a.id, kind: "DAMAGE", quantity: 3, note: "broken" }, u.id);
    const sum = await prisma.stockMovement.aggregate({ where: { batchId: a.id }, _sum: { quantity: true } });
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: a.id } })).quantity).toBe(sum._sum.quantity);
  });

  it("database refuses negative stock", async () => {
    const m = await makeMedicine();
    const a = await makeBatch(m.id, "A", 60, 3);
    await expect(prisma.$executeRawUnsafe(`UPDATE "Batch" SET quantity = -1 WHERE id = '${a.id}'`)).rejects.toThrow();
  });
});
