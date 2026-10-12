import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { signSession, verifySession } from "@/lib/session-token";
import { startSupportSession, endSupportSession, loadSupportSession, serviceContext } from "@/modules/identity";
import { createPharmacy, createPharmacySchema, setPharmacyStatus } from "@/modules/tenancy";
import { createSale } from "@/modules/sales";
import { resetDb, makeMedicine, makeBatch, pharmacyId as testPharmacy } from "./helpers";

beforeEach(resetDb);

async function setup() {
  const dev = await platformDb.platformUser.create({ data: { name: "Sudais", email: "dev@t.test", passwordHash: "x", totpEnabledAt: new Date() } });
  const r = await createPharmacy({ devId: dev.id }, createPharmacySchema.parse({ pharmacy: { name: "City Care", slug: "city-care" }, plan: {}, admin: { name: "Admin One", username: "admin", email: "admin@city.example" }, credentials: "invite" }));
  return { dev, pharmacyId: r.pharmacy.id };
}
const tokenFor = (devId: string, sv: number, pid: string, ssid: string) => signSession("support", { sub: devId, sv, pid, ssid });
const load = async (t: string) => loadSupportSession(await verifySession("support", t));

describe("platform support sessions", () => {
  it("open a pharmacy as its hidden support account, even while suspended", async () => {
    const { dev, pharmacyId } = await setup();
    await expect(startSupportSession(dev.id, pharmacyId, "")).rejects.toThrow(/reason/);
    const session = await startSupportSession(dev.id, pharmacyId, "Owner asked for help");
    const token = await tokenFor(dev.id, dev.sessionVersion, pharmacyId, session.id);
    const user = await load(token);
    expect(user).toMatchObject({ username: "platform-support", role: "ADMIN", pharmacyId, support: { sessionId: session.id, devId: dev.id, devName: "Sudais" } });

    await setPharmacyStatus({ devId: dev.id }, pharmacyId, { status: "SUSPENDED", reason: "test" });
    expect(await load(token)).not.toBeNull();
  });

  it("end when ended, when the Developer session is revoked, after two hours, or for another pharmacy", async () => {
    const { dev, pharmacyId } = await setup();
    let s = await startSupportSession(dev.id, pharmacyId, "check stock");
    const token = await tokenFor(dev.id, dev.sessionVersion, pharmacyId, s.id);
    expect(await load(await tokenFor(dev.id, dev.sessionVersion, testPharmacy, s.id))).toBeNull();
    await endSupportSession(s.id, dev.id);
    expect(await load(token)).toBeNull();

    s = await startSupportSession(dev.id, pharmacyId, "again");
    const t2 = await tokenFor(dev.id, dev.sessionVersion, pharmacyId, s.id);
    await platformDb.supportSession.update({ where: { id: s.id }, data: { startedAt: new Date(Date.now() - 3 * 3600 * 1000) } });
    expect(await load(t2)).toBeNull();

    s = await startSupportSession(dev.id, pharmacyId, "third");
    const t3 = await tokenFor(dev.id, dev.sessionVersion, pharmacyId, s.id);
    await platformDb.platformUser.update({ where: { id: dev.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await load(t3)).toBeNull();
  });

  it("starting a new session closes the previous one for that pharmacy", async () => {
    const { dev, pharmacyId } = await setup();
    const a = await startSupportSession(dev.id, pharmacyId, "first");
    await startSupportSession(dev.id, pharmacyId, "second");
    expect((await platformDb.supportSession.findUniqueOrThrow({ where: { id: a.id } })).endedAt).not.toBeNull();
  });

  it("work done in support is stored against the support account and audited as the Developer", async () => {
    const { dev, pharmacyId } = await setup();
    const session = await startSupportSession(dev.id, pharmacyId, "fix a sale");
    const user = (await load(await tokenFor(dev.id, dev.sessionVersion, pharmacyId, session.id)))!;
    const ctx = Object.assign(serviceContext(user, pharmacyId), { realm: "PLATFORM" as const, supportSessionId: session.id, auditActorId: dev.id });
    const m = await makeMedicine("Panadol", {}, pharmacyId);
    await makeBatch(m.id, "A", 90, 10, 50, 40, pharmacyId);
    const sale = await createSale(ctx, { items: [{ medicineId: m.id, quantity: 1 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CASH" });
    expect(sale.userId).toBe(user.id);
    const row = await platformDb.auditLog.findFirstOrThrow({ where: { action: "sale.create" } });
    expect(row).toMatchObject({ realm: "PLATFORM", actorId: dev.id, supportSessionId: session.id, pharmacyId });
  });

  it("create the support account for pharmacies that have none (carried over from a single shop)", async () => {
    const dev = await platformDb.platformUser.create({ data: { name: "Dev", email: "d@t.test", passwordHash: "x", totpEnabledAt: new Date() } });
    expect(await platformDb.user.count({ where: { pharmacyId: testPharmacy, isSystem: true } })).toBe(0);
    const s = await startSupportSession(dev.id, testPharmacy, "help");
    const user = await load(await tokenFor(dev.id, dev.sessionVersion, testPharmacy, s.id));
    expect(user).toMatchObject({ username: "platform-support", pharmacyId: testPharmacy });
    await startSupportSession(dev.id, testPharmacy, "help again");
    expect(await platformDb.user.count({ where: { pharmacyId: testPharmacy, isSystem: true } })).toBe(1);
  });
});
