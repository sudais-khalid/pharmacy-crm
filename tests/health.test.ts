import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { getHealth } from "@/modules/platform";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("health", () => {
  it("is ok with a reachable database and an idle outbox", async () => {
    const h = await getHealth();
    expect(h.checks.database.ok).toBe(true);
    expect(h.checks.worker).toMatchObject({ ok: true, pendingEvents: 0 });
    expect(h.checks.disk).toHaveProperty("freeBytes");
    expect(["ok", "degraded"]).toContain(h.status); // degraded only if this machine is short of disk
  });

  it("reports the worker as behind when events wait more than five minutes", async () => {
    await platformDb.outboxEvent.create({ data: { type: "MedicineCreated", payload: {}, createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
    const h = await getHealth();
    expect(h.checks.worker).toMatchObject({ ok: false, pendingEvents: 1 });
    expect(h.checks.worker.oldestPendingSeconds as number).toBeGreaterThanOrEqual(590);
    expect(h.status).toBe("degraded");
  });

  it("does not count parked events as lag", async () => {
    await platformDb.outboxEvent.create({ data: { type: "MedicineCreated", payload: {}, attempts: 10, createdAt: new Date(Date.now() - 3600 * 1000) } });
    const h = await getHealth();
    expect(h.checks.worker).toMatchObject({ ok: true, pendingEvents: 0, parkedEvents: 1 });
  });
});
