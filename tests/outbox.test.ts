import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { runInTx } from "@/lib/db";
import { emit, dispatchOutbox, outboxBackoffMs, OUTBOX_MAX_ATTEMPTS, type OutboxHandlers } from "@/modules/platform";
import { resetDb, makeUser, ctxOf } from "./helpers";

beforeEach(resetDb);

async function emitMany(n: number) {
  const u = await makeUser();
  await runInTx(ctxOf(u), async (tx) => {
    for (let i = 0; i < n; i++) await emit(tx, "MedicineCreated", { medicineId: `m${i}` });
  });
}

describe("outbox dispatcher", () => {
  it("delivers events in order and marks them processed", async () => {
    await emitMany(3);
    const seen: string[] = [];
    const handlers: OutboxHandlers = { MedicineCreated: [async (e) => void seen.push(e.payload.medicineId)] };
    expect(await dispatchOutbox(handlers)).toEqual({ claimed: 3, delivered: 3, failed: 0 });
    expect(seen).toEqual(["m0", "m1", "m2"]);
    expect(await prisma.outboxEvent.count({ where: { processedAt: null } })).toBe(0);
    expect((await dispatchOutbox(handlers)).claimed).toBe(0);
  });

  it("marks events without handlers as processed", async () => {
    await emitMany(1);
    expect(await dispatchOutbox({})).toEqual({ claimed: 1, delivered: 1, failed: 0 });
  });

  it("retries a failing handler later with backoff and records the error", async () => {
    await emitMany(1);
    const r = await dispatchOutbox({ MedicineCreated: [async () => { throw new Error("mail server down"); }] });
    expect(r).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    const ev = await prisma.outboxEvent.findFirstOrThrow();
    expect(ev.attempts).toBe(1);
    expect(ev.processedAt).toBeNull();
    expect(ev.lastError).toMatch(/mail server down/);
    expect(ev.availableAt.getTime()).toBeGreaterThan(Date.now() + 3000);
    expect((await dispatchOutbox({})).claimed).toBe(0); // not due yet
    expect(outboxBackoffMs(1)).toBe(5000);
    expect(outboxBackoffMs(30)).toBe(3600 * 1000);
  });

  it("parks events after the maximum number of attempts", async () => {
    await emitMany(1);
    await prisma.outboxEvent.updateMany({ data: { attempts: OUTBOX_MAX_ATTEMPTS, availableAt: new Date(0) } });
    expect((await dispatchOutbox({})).claimed).toBe(0);
  });

  it("concurrent dispatchers never deliver the same event twice", async () => {
    await emitMany(40);
    const counts = new Map<string, number>();
    const handlers: OutboxHandlers = {
      MedicineCreated: [async (e) => {
        counts.set(e.payload.medicineId, (counts.get(e.payload.medicineId) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 2));
      }],
    };
    const results = await Promise.all([1, 2, 3].map(() => dispatchOutbox(handlers, { batchSize: 15 })));
    const total = results.reduce((s, r) => s + r.delivered, 0);
    expect(total).toBeLessThanOrEqual(40);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
    while ((await dispatchOutbox(handlers)).claimed > 0);
    expect(counts.size).toBe(40);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
  });
});
