import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { runInTx } from "@/lib/db";
import { withIdempotency, purgeIdempotencyKeys } from "@/lib/idempotency";
import { createSale } from "@/modules/sales";
import { audit, emit } from "@/modules/platform";
import { resetDb, makeUser, makeMedicine, makeBatch, ctxOf } from "./helpers";

beforeEach(resetDb);

const saleBody = (medicineId: string, quantity = 2) => ({
  items: [{ medicineId, quantity }],
  discountType: "AMOUNT" as const,
  discountValue: 0,
  paymentMethod: "CASH" as const,
});

describe("idempotency", () => {
  async function setup() {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 50);
    return { u, m };
  }
  const sell = (u: { id: string; role: "ADMIN" | "PHARMACIST" | "CASHIER"; pharmacyId: string }, body: ReturnType<typeof saleBody>, key: string) =>
    withIdempotency({ key, actorId: u.id, pharmacyId: u.pharmacyId, route: "POST /api/sales", rawBody: JSON.stringify(body) }, async (tx) => {
      const sale = await createSale({ ...ctxOf(u), tx }, body);
      return { id: sale.id, invoiceNo: sale.invoiceNo };
    });

  it("returns the stored response for a repeated key and creates only one sale", async () => {
    const { u, m } = await setup();
    const first = await sell(u, saleBody(m.id), "key-retry-0001");
    const second = await sell(u, saleBody(m.id), "key-retry-0001");
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body);
    expect(await platformDb.sale.count()).toBe(1);
    expect((await platformDb.batch.findFirstOrThrow()).quantity).toBe(48);
  });

  it("serialises concurrent duplicates into one sale", async () => {
    const { u, m } = await setup();
    const results = await Promise.all([1, 2, 3].map(() => sell(u, saleBody(m.id), "key-concurrent-01")));
    expect(await platformDb.sale.count()).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it("rejects a key reused for a different request", async () => {
    const { u, m } = await setup();
    await sell(u, saleBody(m.id, 2), "key-reuse-00001");
    await expect(sell(u, saleBody(m.id, 3), "key-reuse-00001")).rejects.toThrow(/different request/);
    expect(await platformDb.sale.count()).toBe(1);
  });

  it("stores nothing for a failed request, so it can be retried", async () => {
    const { u, m } = await setup();
    await expect(sell(u, saleBody(m.id, 500), "key-failure-001")).rejects.toThrow(/Insufficient/);
    expect(await platformDb.idempotencyKey.count()).toBe(0);
    const ok = await sell(u, saleBody(m.id, 5), "key-failure-001");
    expect(ok.replayed).toBe(false);
  });

  it("keys are per user", async () => {
    const { u, m } = await setup();
    const other = await makeUser("PHARMACIST");
    await sell(u, saleBody(m.id), "key-shared-0001");
    const r = await sell(other, saleBody(m.id), "key-shared-0001");
    expect(r.replayed).toBe(false);
    expect(await platformDb.sale.count()).toBe(2);
  });

  it("rejects malformed keys and purges expired ones", async () => {
    const { u, m } = await setup();
    await expect(sell(u, saleBody(m.id), "short")).rejects.toThrow(/Idempotency-Key/);
    await sell(u, saleBody(m.id), "key-purge-00001");
    expect(await purgeIdempotencyKeys(new Date(Date.now() + 25 * 3600 * 1000))).toBe(1);
  });
});

describe("audit log and outbox", () => {
  it("audit rows are append-only", async () => {
    const u = await makeUser();
    await runInTx(ctxOf(u), (tx) => audit(tx, ctxOf(u), { action: "test.write", entity: "Test", entityId: "1", after: { a: 1 } }));
    const row = await platformDb.auditLog.findFirstOrThrow();
    expect(row.after).toEqual({ a: 1 });
    await expect(platformDb.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(platformDb.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("audit and outbox rows roll back with the business transaction", async () => {
    const u = await makeUser();
    await expect(
      runInTx(ctxOf(u), async (tx) => {
        await audit(tx, ctxOf(u), { action: "test.write", entity: "Test", entityId: "1" });
        await emit(tx, "MedicineCreated", { medicineId: "x" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await platformDb.auditLog.count()).toBe(0);
    expect(await platformDb.outboxEvent.count()).toBe(0);
  });
});

describe("write paths are audited and emit events", () => {
  const rows = async () => ({
    audit: await platformDb.auditLog.findMany({ orderBy: { id: "asc" } }),
    events: await platformDb.outboxEvent.findMany({ orderBy: { id: "asc" } }),
  });

  it("a sale writes exactly one audit row and one outbox event; a failed sale writes none", async () => {
    const u = await makeUser();
    const m = await makeMedicine();
    await makeBatch(m.id, "A", 90, 5);
    const sale = await createSale(ctxOf(u), saleBody(m.id, 2));
    let r = await rows();
    expect(r.audit.map((a) => a.action)).toEqual(["sale.create"]);
    expect(r.audit[0]).toMatchObject({ actorId: u.id, entity: "Sale", entityId: sale.id });
    expect(r.events.map((e) => e.type)).toEqual(["SaleCompleted"]);
    expect(r.events[0].payload).toMatchObject({ saleId: sale.id, medicineIds: [m.id] });

    await expect(createSale(ctxOf(u), saleBody(m.id, 99))).rejects.toThrow(/Insufficient/);
    r = await rows();
    expect(r.audit).toHaveLength(1);
    expect(r.events).toHaveLength(1);
  });

  it("cancel, purchase, adjustment and payments are audited", async () => {
    const { cancelSale } = await import("@/modules/sales");
    const { createPurchase, paySupplier } = await import("@/modules/procurement");
    const { adjustStock } = await import("@/modules/inventory");
    const { receiveCustomerPayment } = await import("@/modules/customers");
    const { makeSupplier, makeCustomer, inDays } = await import("./helpers");

    const u = await makeUser("ADMIN");
    const m = await makeMedicine();
    const b = await makeBatch(m.id, "A", 90, 20);
    const s = await makeSupplier();
    const c = await makeCustomer(5000);

    const sale = await createSale(ctxOf(u), { ...saleBody(m.id, 2), paymentMethod: "CREDIT", customerId: c.id });
    await receiveCustomerPayment(ctxOf(u), c.id, { amount: 50, method: "CASH" });
    await cancelSale(ctxOf(u), sale.id, "entered by mistake");
    await createPurchase(ctxOf(u), {
      supplierId: s.id, purchaseDate: inDays(0), discount: 0, paid: 0, paymentMethod: "CASH",
      items: [{ medicineId: m.id, batchNumber: "P1", expiryDate: inDays(300), quantity: 10, purchasePrice: 30, salePrice: 50 }],
    });
    await paySupplier(ctxOf(u), s.id, { amount: 100, method: "CASH" });
    await adjustStock(ctxOf(u), { batchId: b.id, kind: "DAMAGE", quantity: 1, note: "broken bottle" });

    const r = await rows();
    expect(r.audit.map((a) => a.action)).toEqual(["sale.create", "customer.payment", "sale.cancel", "purchase.create", "supplier.payment", "stock.adjust"]);
    expect(r.events.map((e) => e.type)).toEqual(["SaleCompleted", "CustomerPaymentReceived", "SaleCancelled", "PurchasePosted", "SupplierPaid", "StockAdjusted"]);
    expect(r.audit.find((a) => a.action === "stock.adjust")).toMatchObject({ before: { quantity: 20 }, after: { quantity: 19, kind: "DAMAGE" } });
  });

  it("a price change records the old and new price", async () => {
    const { updateMedicine } = await import("@/modules/catalog");
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine("Brufen", { salePrice: 50 });
    const input = {
      name: "Brufen", genericName: null, categoryId: null, barcode: null, sku: null, unit: "Pack",
      purchasePrice: 40, salePrice: 65, minStock: 10, prescriptionRequired: false, description: null, active: true,
    };
    await updateMedicine(ctxOf(u), m.id, input);
    await updateMedicine(ctxOf(u), m.id, input); // no change: no audit row
    const r = await rows();
    expect(r.audit).toHaveLength(1);
    expect(r.audit[0]).toMatchObject({ action: "medicine.price.update", before: { salePrice: "50" }, after: { salePrice: "65" } });
  });

  it("user changes are audited without the password hash", async () => {
    const { createUser, updateUser } = await import("@/modules/identity");
    const admin = await makeUser("ADMIN");
    const created = await createUser(ctxOf(admin), { name: "Ali", email: "ali@t.test", password: "Secret@1234", role: "CASHIER" });
    await updateUser(ctxOf(admin), created.id, { password: "NewSecret@1234" });
    await updateUser(ctxOf(admin), created.id, { active: false });
    const r = await rows();
    expect(r.audit.map((a) => a.action)).toEqual(["user.create", "user.password.reset", "user.deactivate"]);
    const text = JSON.stringify(r.audit.map((a) => [a.before, a.after]));
    expect(text).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(r.audit[1].after).toEqual({ passwordChanged: true });
    await expect(updateUser(ctxOf(admin), admin.id, { active: false })).rejects.toThrow(/own account/);
  });
});
