import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
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
  const sell = (u: { id: string; role: "ADMIN" | "PHARMACIST" | "CASHIER" }, body: ReturnType<typeof saleBody>, key: string) =>
    withIdempotency({ key, actorId: u.id, route: "POST /api/sales", rawBody: JSON.stringify(body) }, async (tx) => {
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
    expect(await prisma.sale.count()).toBe(1);
    expect((await prisma.batch.findFirstOrThrow()).quantity).toBe(48);
  });

  it("serialises concurrent duplicates into one sale", async () => {
    const { u, m } = await setup();
    const results = await Promise.all([1, 2, 3].map(() => sell(u, saleBody(m.id), "key-concurrent-01")));
    expect(await prisma.sale.count()).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it("rejects a key reused for a different request", async () => {
    const { u, m } = await setup();
    await sell(u, saleBody(m.id, 2), "key-reuse-00001");
    await expect(sell(u, saleBody(m.id, 3), "key-reuse-00001")).rejects.toThrow(/different request/);
    expect(await prisma.sale.count()).toBe(1);
  });

  it("stores nothing for a failed request, so it can be retried", async () => {
    const { u, m } = await setup();
    await expect(sell(u, saleBody(m.id, 500), "key-failure-001")).rejects.toThrow(/Insufficient/);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    const ok = await sell(u, saleBody(m.id, 5), "key-failure-001");
    expect(ok.replayed).toBe(false);
  });

  it("keys are per user", async () => {
    const { u, m } = await setup();
    const other = await makeUser("PHARMACIST");
    await sell(u, saleBody(m.id), "key-shared-0001");
    const r = await sell(other, saleBody(m.id), "key-shared-0001");
    expect(r.replayed).toBe(false);
    expect(await prisma.sale.count()).toBe(2);
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
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.after).toEqual({ a: 1 });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
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
    expect(await prisma.auditLog.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});
