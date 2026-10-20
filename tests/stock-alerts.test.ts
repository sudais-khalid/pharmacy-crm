import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { addDays, todayStr } from "@/lib/dates";
import { adjustStock, scanExpiry, scanStock } from "@/modules/inventory";
import { markNotificationsRead } from "@/modules/platform";
import { createSale } from "@/modules/sales";
import { resetDb, makeUser, makeMedicine, makeBatch, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const open = () => platformDb.notification.findMany({ where: { pharmacyId, resolvedAt: null }, orderBy: { createdAt: "asc" } });

describe("expiry alerts", () => {
  it("raise one notification per stage, not one per day, and clear when the batch is written off", async () => {
    const admin = await makeUser("ADMIN");
    const m = await makeMedicine("Calpol Syrup");
    const b = await makeBatch(m.id, "C1", 29, 12);
    const today = todayStr();

    expect(await scanExpiry(pharmacyId, today)).toMatchObject({ raised: 1, open: 1 });
    await markNotificationsRead(ctxOf(admin), "all");
    // the next days: still the same single notification, still read
    expect(await scanExpiry(pharmacyId, addDays(today, 1))).toMatchObject({ raised: 0, open: 1 });
    expect(await scanExpiry(pharmacyId, addDays(today, 2))).toMatchObject({ raised: 0 });
    const [n] = await open();
    expect(n).toMatchObject({ type: "EXPIRY_SOON", severity: "WARNING", audiencePermission: "inventory.view" });
    expect(await platformDb.notificationRead.count({ where: { notificationId: n.id } })).toBe(1);

    // a week left: the 7-day alert replaces the first one
    expect(await scanExpiry(pharmacyId, addDays(today, 23))).toMatchObject({ raised: 1, resolved: 1 });
    expect((await open()).map((x) => x.type)).toEqual(["EXPIRY_7"]);
    // expired
    await scanExpiry(pharmacyId, addDays(today, 30));
    expect((await open()).map((x) => [x.type, x.severity])).toEqual([["EXPIRED", "CRITICAL"]]);

    await adjustStock(ctxOf(admin), { batchId: b.id, kind: "EXPIRY", quantity: 12, note: "expired" });
    expect(await scanExpiry(pharmacyId, addDays(today, 30))).toMatchObject({ open: 0, resolved: 1 });
    expect(await open()).toHaveLength(0);
  });

  it("follow the pharmacy's alert window", async () => {
    const m = await makeMedicine("Brufen");
    await makeBatch(m.id, "B1", 45, 5);
    expect(await scanExpiry(pharmacyId)).toMatchObject({ raised: 0 });
    await platformDb.pharmacySettings.update({ where: { pharmacyId }, data: { expiryAlertDays: 60 } });
    expect(await scanExpiry(pharmacyId)).toMatchObject({ raised: 1 });
  });
});

describe("stock alerts", () => {
  it("warn at the minimum, escalate when out of stock, and clear on restock", async () => {
    const u = await makeUser("PHARMACIST");
    const tracked = await makeMedicine("Risek", { minStock: 10 });
    await makeMedicine("Never stocked"); // in the catalogue but never bought: no alert
    const b = await makeBatch(tracked.id, "R1", 300, 8);
    await makeBatch(tracked.id, "OLD", -5, 50); // expired stock does not count

    expect(await scanStock(pharmacyId)).toMatchObject({ raised: 1, open: 1 });
    expect((await open())[0]).toMatchObject({ type: "LOW_STOCK", title: "Risek is low: 8 left", link: `/medicines/${tracked.id}` });

    await createSale(ctxOf(u), { items: [{ medicineId: tracked.id, quantity: 8 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CASH" });
    // after a sale only that medicine is looked at
    expect(await scanStock(pharmacyId, todayStr(), [tracked.id])).toMatchObject({ raised: 1, resolved: 1 });
    expect((await open()).map((x) => x.type)).toEqual(["OUT_OF_STOCK"]);

    await adjustStock(ctxOf(u), { batchId: b.id, kind: "ADD", quantity: 30, note: "delivery" });
    expect(await scanStock(pharmacyId)).toMatchObject({ open: 0, resolved: 1 });
  });
});
