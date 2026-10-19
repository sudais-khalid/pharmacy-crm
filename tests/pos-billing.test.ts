import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { customerBalance } from "@/modules/customers";
import { addCashMovement, cancelSale, closeSession, createReturn, createSale, getSession, mySession, openSession } from "@/modules/sales";
import { resetDb, makeUser, makeMedicine, makeBatch, makeCustomer, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const base = { discountType: "AMOUNT" as const, discountValue: 0, paymentMethod: "CASH" as const };
const sessionsOn = () => platformDb.featureFlag.create({ data: { pharmacyId, key: "cashSessions", enabled: true } });

describe("counter sales", () => {
  it("print the walk-in name and phone, record the cash handed over and the change, and stamp the receipt format", async () => {
    const u = await makeUser("CASHIER");
    const m = await makeMedicine("Panadol");
    await makeBatch(m.id, "B1", 300, 20, 35);
    const sale = await createSale(ctxOf(u), { ...base, items: [{ medicineId: m.id, quantity: 2 }], cashTendered: 100, customerName: " Ahmed Raza ", customerPhone: "0300-1234567" });
    expect(sale).toMatchObject({ customerName: "Ahmed Raza", customerPhone: "0300-1234567", receiptFormat: "THERMAL_80", cashSessionId: null });
    expect(Number(sale.amountPaid)).toBe(70);
    expect(Number(sale.cashTendered)).toBe(100);
    expect(Number(sale.changeGiven)).toBe(30);
    await expect(createSale(ctxOf(u), { ...base, items: [{ medicineId: m.id, quantity: 1 }], cashTendered: 10, amountPaid: 35 })).rejects.toThrow(/less than the amount paid/);
  });
});

describe("cash drawer sessions", () => {
  it("block cash without an open drawer, and close with expected = float + cash sales - cash refunds + pay-ins - pay-outs", async () => {
    await sessionsOn();
    const cashier = await makeUser("CASHIER");
    const admin = await makeUser("ADMIN");
    const m = await makeMedicine("Brufen");
    await makeBatch(m.id, "B1", 300, 100, 10);
    const customer = await makeCustomer(5000);
    const c = ctxOf(cashier);

    await expect(createSale(c, { ...base, items: [{ medicineId: m.id, quantity: 1 }] })).rejects.toThrow(/Open your cash drawer/);
    const session = await openSession(c, { openingFloat: 500 });
    await expect(openSession(c, { openingFloat: 1 })).rejects.toThrow(/already open/);
    expect((await mySession(c)).session?.id).toBe(session.id);

    await createSale(c, { ...base, items: [{ medicineId: m.id, quantity: 10 }], cashTendered: 150 }); // 100 cash, 50 change
    await createSale(c, { ...base, paymentMethod: "CARD", items: [{ medicineId: m.id, quantity: 5 }] }); // 50 card, not in the drawer
    const credit = await createSale(c, { ...base, paymentMethod: "CREDIT", customerId: customer.id, amountPaid: 30, items: [{ medicineId: m.id, quantity: 8 }] }); // 80, 30 down in cash
    const cancelled = await createSale(c, { ...base, items: [{ medicineId: m.id, quantity: 2 }] });
    await cancelSale(ctxOf(admin), cancelled.id, "wrong item");
    await addCashMovement(c, session.id, { type: "PAY_IN", amount: 20, reason: "Change from the bank" });
    await addCashMovement(c, session.id, { type: "PAY_OUT", amount: 10, reason: "Tea" });
    await expect(addCashMovement(c, session.id, { type: "PAY_OUT", amount: 10_000, reason: "Too much" })).rejects.toThrow(/should only hold/);
    // a return needs at least one line
    await expect(createReturn(ctxOf(admin), { saleId: credit.id, refundMethod: "CASH", reason: "Not needed", items: [] })).rejects.toThrow(/at least one item/);

    const { summary } = await getSession(c, session.id);
    expect(summary).toMatchObject({ openingFloat: 500, cashSales: 130, cardSales: 50, creditSales: 50, payIns: 20, payOuts: 10, cashRefunds: 0, expectedCash: 640 });

    // a difference above the threshold (100) needs a note, and the managers hear about it
    await expect(closeSession(c, session.id, { countedCash: 500 })).rejects.toThrow(/short by 140.00/);
    const closed = await closeSession(c, session.id, { countedCash: 500, note: "Gave a refund from the drawer by mistake" });
    expect(closed).toMatchObject({ status: "CLOSED" });
    expect(Number(closed.difference)).toBe(-140);
    expect(await platformDb.notification.findFirst({ where: { type: "CASH_DIFFERENCE" } })).toMatchObject({ audiencePermission: "cash.manage", link: `/cash/${session.id}` });
    await expect(closeSession(c, session.id, { countedCash: 500 })).rejects.toThrow(/already closed/);

    // another cashier cannot see this drawer; a manager can
    const other = await makeUser("CASHIER");
    await expect(getSession(ctxOf(other), session.id)).rejects.toThrow(/not found/);
    expect((await getSession(ctxOf(admin), session.id)).id).toBe(session.id);
  });

  it("count cash refunds against the drawer they were paid from", async () => {
    await sessionsOn();
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine("Flagyl");
    await makeBatch(m.id, "F1", 300, 10, 25);
    const c = ctxOf(u);
    const session = await openSession(c, { openingFloat: 100 });
    const sale = await createSale(c, { ...base, items: [{ medicineId: m.id, quantity: 4 }] });
    const saleFull = await platformDb.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
    await createReturn(c, { saleId: sale.id, refundMethod: "CASH", reason: "Doctor changed it", items: [{ saleItemId: saleFull.items[0].id, quantity: 1, restock: true }] });
    expect((await getSession(c, session.id)).summary).toMatchObject({ cashSales: 100, cashRefunds: 25, expectedCash: 175 });
  });
});

describe("customer returns", () => {
  it("go back to the original batch, never exceed what was sold, refund the discounted price, and stop a later cancel", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine("Augmentin");
    const early = await makeBatch(m.id, "EARLY", 100, 3, 100);
    const late = await makeBatch(m.id, "LATE", 400, 10, 100);
    const c = ctxOf(u);
    // 5 units: 3 from EARLY, 2 from LATE (FEFO); 10 % off the invoice
    const sale = await createSale(c, { ...base, discountType: "PERCENT", discountValue: 10, items: [{ medicineId: m.id, quantity: 5 }] });
    const items = await platformDb.saleItem.findMany({ where: { saleId: sale.id }, include: { batch: true } });
    const fromEarly = items.find((i) => i.batch.batchNumber === "EARLY")!;
    const fromLate = items.find((i) => i.batch.batchNumber === "LATE")!;

    await expect(createReturn(c, { saleId: sale.id, refundMethod: "CASH", reason: "Too many", items: [{ saleItemId: fromEarly.id, quantity: 4, restock: true }] })).rejects.toThrow(/Only 3 of Augmentin/);

    const r1 = await createReturn(c, { saleId: sale.id, refundMethod: "CASH", reason: "Too many", items: [{ saleItemId: fromEarly.id, quantity: 2, restock: true }, { saleItemId: fromLate.id, quantity: 1, restock: false }] });
    expect(r1.number).toMatch(/^RET-\d{8}-00001$/);
    expect(Number(r1.total)).toBe(270); // 3 x 100 less 10 %
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: early.id } })).quantity).toBe(2); // 3 sold, 2 back
    expect((await platformDb.batch.findUniqueOrThrow({ where: { id: late.id } })).quantity).toBe(8); // damaged one written off
    const moves = await platformDb.stockMovement.findMany({ where: { reference: r1.number }, orderBy: { createdAt: "asc" } });
    expect(moves.map((mv) => [mv.type, mv.quantity])).toEqual(expect.arrayContaining([["SALE_RETURN", 2], ["SALE_RETURN", 1], ["DAMAGE", -1]]));
    expect(moves.find((mv) => mv.type === "SALE_RETURN" && mv.quantity === 2)?.batchId).toBe(early.id);

    // what is left: 1 from EARLY, 1 from LATE; the refund cannot exceed what was paid (450 - 270 = 180)
    await expect(createReturn(c, { saleId: sale.id, refundMethod: "CASH", reason: "Again", items: [{ saleItemId: fromEarly.id, quantity: 2, restock: true }] })).rejects.toThrow(/Only 1 of Augmentin/);
    await expect(createReturn(c, { saleId: sale.id, refundMethod: "CREDIT", reason: "Again", items: [{ saleItemId: fromEarly.id, quantity: 1, restock: true }] })).rejects.toThrow(/credit note needs a customer/);
    await expect(cancelSale(c, sale.id, "changed mind")).rejects.toThrow(/has returns/);
  });

  it("credit the customer's account for a credit note, and keep the balance unchanged for a cash refund", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine("Risek");
    await makeBatch(m.id, "R1", 300, 10, 60);
    const customer = await makeCustomer(10_000);
    const c = ctxOf(u);
    const sale = await createSale(c, { ...base, paymentMethod: "CREDIT", customerId: customer.id, amountPaid: 0, items: [{ medicineId: m.id, quantity: 5 }] });
    expect(Number(await customerBalance(platformDb, customer.id))).toBe(300);
    const [item] = await platformDb.saleItem.findMany({ where: { saleId: sale.id } });
    // nothing was paid, so no cash can be handed back
    await expect(createReturn(c, { saleId: sale.id, refundMethod: "CASH", reason: "Unused", items: [{ saleItemId: item.id, quantity: 1, restock: true }] })).rejects.toThrow(/Only 0.00 was paid/);
    await createReturn(c, { saleId: sale.id, refundMethod: "CREDIT", reason: "Unused", items: [{ saleItemId: item.id, quantity: 2, restock: true }] });
    expect(Number(await customerBalance(platformDb, customer.id))).toBe(180);
  });

  it("are refused for a cancelled invoice and for someone else's invoice without sales.viewAll", async () => {
    const pharmacist = await makeUser("PHARMACIST");
    const cashier = await makeUser("CASHIER");
    const m = await makeMedicine("Disprin");
    await makeBatch(m.id, "D1", 300, 10, 5);
    const sale = await createSale(ctxOf(pharmacist), { ...base, items: [{ medicineId: m.id, quantity: 2 }] });
    const [item] = await platformDb.saleItem.findMany({ where: { saleId: sale.id } });
    const line = [{ saleItemId: item.id, quantity: 1, restock: true }];
    await expect(createReturn(ctxOf(cashier, ["returns.create", "sales.view"]), { saleId: sale.id, refundMethod: "CASH", reason: "Mine?", items: line })).rejects.toThrow(/Invoice not found/);
    await cancelSale(ctxOf(pharmacist), sale.id, "test");
    await expect(createReturn(ctxOf(pharmacist), { saleId: sale.id, refundMethod: "CASH", reason: "Late", items: line })).rejects.toThrow(/cancelled invoice/);
  });
});
