import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { tenantTransaction } from "@/lib/db";
import { addDays, todayStr } from "@/lib/dates";
import { cancelExpense, compareWithPrevious, createExpense, dailyFigures, listCategories, listExpenses, profitAndLoss, rebuildSummaries, rollup, summaryRange } from "@/modules/finance";
import { adjustStock } from "@/modules/inventory";
import { cancelSale, createReturn, createSale, getSession, openSession } from "@/modules/sales";
import { addUsage, setLogo } from "@/modules/platform";
import { platformUsage } from "@/modules/tenancy";
import { testPng } from "./png";
import { resetDb, makeUser, makeMedicine, makeBatch, makePharmacy, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const cash = { discountType: "AMOUNT" as const, discountValue: 0, paymentMethod: "CASH" as const };

describe("expenses", () => {
  it("come with the usual categories, can be cancelled, and cancelled ones count nowhere", async () => {
    const u = await makeUser("ADMIN");
    const c = ctxOf(u);
    const cats = await listCategories(c);
    expect(cats.map((x) => x.name)).toContain("Rent");
    const rent = cats.find((x) => x.name === "Rent")!;
    const e1 = await createExpense(c, { categoryId: rent.id, amount: 30000, date: todayStr(), method: "CARD", description: "October rent" });
    expect(e1.number).toMatch(/^EXP-\d{8}-00001$/);
    const e2 = await createExpense(c, { categoryId: rent.id, amount: 500, date: todayStr(), method: "CASH", description: "Typed twice" });
    await cancelExpense(c, e2.id, "Entered twice");
    await expect(cancelExpense(c, e2.id, "again")).rejects.toThrow(/already cancelled/);
    await expect(createExpense(c, { categoryId: rent.id, amount: 1, date: addDays(todayStr(), 1), method: "CASH", description: "Later" })).rejects.toThrow(/future/);
    const list = await listExpenses(c, {});
    expect(Number(list.sum)).toBe(30000);
    expect(list.items).toHaveLength(1);
    expect(list.byCategory).toEqual([{ category: "Rent", amount: expect.anything() }]);
  });

  it("paid from a drawer come out of its expected cash", async () => {
    await platformDb.featureFlag.create({ data: { pharmacyId, key: "cashSessions", enabled: true } });
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const session = await openSession(c, { openingFloat: 1000 });
    const [other] = (await listCategories(ctxOf(await makeUser("ADMIN")))).filter((x) => x.name === "Transport");
    await createExpense(c, { categoryId: other.id, amount: 150, date: todayStr(), method: "CASH", description: "Delivery rickshaw", fromDrawer: true });
    expect((await getSession(c, session.id)).summary).toMatchObject({ expensesPaid: 150, expectedCash: 850 });
  });
});

describe("profit and loss", () => {
  it("nets returns, restocked cost, write-offs and expenses, and leaves cancelled sales out", async () => {
    const u = await makeUser("ADMIN");
    const c = ctxOf(u);
    const m = await makeMedicine("Panadol");
    const b = await makeBatch(m.id, "P1", 300, 100, 10, 6); // sells at 10, costs 6
    const sale = await createSale(c, { ...cash, discountType: "AMOUNT", discountValue: 10, items: [{ medicineId: m.id, quantity: 20 }] }); // 200 - 10
    const [item] = await platformDb.saleItem.findMany({ where: { saleId: sale.id } });
    await createReturn(c, { saleId: sale.id, refundMethod: "CASH", reason: "unused", items: [{ saleItemId: item.id, quantity: 5, restock: true }] }); // refund 5 x 10 x 190/200 = 47.50
    const cancelled = await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 3 }] });
    await cancelSale(c, cancelled.id, "wrong");
    await adjustStock(c, { batchId: b.id, kind: "DAMAGE", quantity: 2, note: "dropped" }); // 2 x 6
    const [rent] = (await listCategories(c)).filter((x) => x.name === "Rent");
    await createExpense(c, { categoryId: rent.id, amount: 40, date: todayStr(), method: "CARD", description: "Share of rent" });

    const today = todayStr();
    const { totals } = await profitAndLoss(c, { from: today, to: today, unit: "day" });
    expect(totals).toMatchObject({
      grossSales: 200, discounts: 10, returns: 47.5, netSales: 142.5,
      cogs: 90, // 20 x 6 sold - 5 x 6 back in stock
      grossProfit: 52.5, stockLosses: 12, expenses: 40, netProfit: 0.5, invoiceCount: 1,
    });
  });

  it("for a month equals the sum of its days, and a rebuilt summary matches the rolled-up one", async () => {
    const u = await makeUser("ADMIN");
    const c = ctxOf(u);
    const m = await makeMedicine("Brufen");
    await makeBatch(m.id, "B1", 300, 500, 20, 12);
    const today = todayStr();
    // sales on three different days of this month (back-dated), and one today
    for (const [back, qty] of [[2, 3], [1, 5], [0, 7]] as const) {
      const at = new Date(`${addDays(today, -back)}T07:00:00Z`);
      if (at.toISOString().slice(0, 7) === today.slice(0, 7)) await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: qty }] }, { createdAt: at });
    }
    const from = `${today.slice(0, 7)}-01`;
    const month = await profitAndLoss(c, { from, to: today, unit: "month" });
    const days = await tenantTransaction(pharmacyId, (tx) => dailyFigures(tx, from, today));
    const sum = [...days.values()].reduce((s, f) => s + f.netProfit, 0);
    expect(month.rows).toHaveLength(1);
    expect(month.rows[0].netProfit).toBeCloseTo(sum, 2);
    expect(month.totals.netSales).toBeCloseTo([...days.values()].reduce((s, f) => s + f.netSales, 0), 2);

    await rollup(pharmacyId, from, today);
    const rolled = await tenantTransaction(pharmacyId, (tx) => summaryRange(tx, from, today));
    await rebuildSummaries(pharmacyId);
    const rebuilt = await tenantTransaction(pharmacyId, (tx) => summaryRange(tx, from, today));
    expect(rebuilt.filter((f) => f.invoiceCount)).toEqual(rolled.filter((f) => f.invoiceCount));
    expect(rolled.reduce((s, f) => s + f.netSales, 0)).toBeCloseTo(month.totals.netSales, 2);
  });

  it("compares a range with the same number of days before it", async () => {
    const u = await makeUser("ADMIN");
    const c = ctxOf(u);
    const m = await makeMedicine("Calpol");
    await makeBatch(m.id, "C1", 300, 100, 50, 30);
    const today = todayStr();
    await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 2 }] });
    await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 1 }] }, { createdAt: new Date(`${addDays(today, -1)}T07:00:00Z`) });
    const r = await compareWithPrevious(c, today, today);
    expect(r).toMatchObject({ previousFrom: addDays(today, -1), previousTo: addDays(today, -1) });
    expect(r.current.netSales).toBe(100);
    expect(r.previous.netSales).toBe(50);
  });
});

describe("platform usage (Developer console)", () => {
  it("counts each pharmacy's invoices, active staff, OCR pages and stored files on its own", async () => {
    const other = await makePharmacy("usage-other");
    const u = await makeUser("ADMIN");
    const c = ctxOf(u);
    const m = await makeMedicine();
    await makeBatch(m.id, "U1", 200, 10);
    await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 1 }] });
    const gone = await createSale(c, { ...cash, items: [{ medicineId: m.id, quantity: 1 }] });
    await cancelSale(c, gone.id, "test");
    await platformDb.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
    await tenantTransaction(pharmacyId, (tx) => addUsage(tx, `USAGE_OCR_${new Date().toISOString().slice(0, 7).replace("-", "")}`, 3));
    await setLogo(c, { logo: testPng(64, "usage"), icon: testPng(32, "usage") });
    const usage = await platformUsage();
    const mine = usage.find((p) => p.id === pharmacyId)!;
    expect(mine).toMatchObject({ invoices: 1, activeUsers: 1, ocrPages: 3 });
    expect(mine.storageBytes).toBeGreaterThan(0);
    expect(usage.find((p) => p.id === other.id)).toMatchObject({ invoices: 0, activeUsers: 0, ocrPages: 0, storageBytes: 0 });
  });
});
