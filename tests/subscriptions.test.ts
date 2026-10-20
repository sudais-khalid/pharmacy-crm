import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { checkSubscriptions, setPharmacyStatus } from "@/modules/tenancy";
import { resetDb, pharmacyId } from "./helpers";

beforeEach(resetDb);

const DAY = 86_400_000;
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const endOn = (iso: string | null) => platformDb.pharmacy.update({ where: { id: pharmacyId }, data: { subscriptionEndsAt: iso ? new Date(`${iso}T23:59:59Z`) : null } });
const state = async () => {
  const p = await platformDb.pharmacy.findUniqueOrThrow({ where: { id: pharmacyId }, select: { status: true, statusReason: true } });
  const open = await platformDb.notification.findMany({ where: { pharmacyId, type: { startsWith: "SUBSCRIPTION_" }, resolvedAt: null }, select: { type: true } });
  return { status: p.status, reason: p.statusReason, open: open.map((n) => n.type).sort() };
};

describe("subscription check", () => {
  it("warns a week before, moves to grace when it ends, and suspends after the grace days", async () => {
    await endOn("2026-11-10");
    await checkSubscriptions(at("2026-10-20"), 7);
    expect(await state()).toMatchObject({ status: "ACTIVE", open: [] });
    await checkSubscriptions(at("2026-11-05"), 7);
    expect(await state()).toMatchObject({ status: "ACTIVE", open: ["SUBSCRIPTION_ENDING"] });
    await checkSubscriptions(at("2026-11-11"), 7);
    expect(await state()).toEqual({ status: "GRACE", reason: "Subscription ended on 2026-11-10", open: ["SUBSCRIPTION_GRACE"] });
    // running again on the same day changes nothing and raises nothing new
    expect(await checkSubscriptions(at("2026-11-11"), 7)).toEqual({ grace: 0, suspended: 0, active: 0, notified: 0 });
    await checkSubscriptions(at("2026-11-17"), 7);
    expect((await state()).status).toBe("GRACE");
    await checkSubscriptions(new Date(new Date("2026-11-10T23:59:59Z").getTime() + 7 * DAY), 7);
    expect(await state()).toMatchObject({ status: "SUSPENDED", reason: "Subscription ended on 2026-11-10" });
    const log = await platformDb.auditLog.findMany({ where: { pharmacyId, action: { startsWith: "pharmacy.status." } }, orderBy: { id: "asc" }, select: { action: true, realm: true } });
    expect(log).toEqual([{ action: "pharmacy.status.grace", realm: "PLATFORM" }, { action: "pharmacy.status.suspended", realm: "PLATFORM" }]);
  });

  it("brings back a pharmacy it suspended once the subscription is extended, and clears the notices", async () => {
    await endOn("2026-10-01");
    await checkSubscriptions(at("2026-10-20"), 7);
    expect((await state()).status).toBe("SUSPENDED");
    await endOn("2027-10-01");
    await checkSubscriptions(at("2026-10-21"), 7);
    expect(await state()).toEqual({ status: "ACTIVE", reason: "Subscription renewed", open: [] });
  });

  it("leaves a status the Developer set by hand alone, and pharmacies without an end date", async () => {
    await setPharmacyStatus({ devId: "dev-1" }, pharmacyId, { status: "SUSPENDED", reason: "Asked to pause" });
    await endOn("2030-01-01");
    await checkSubscriptions(at("2026-10-20"), 7);
    expect(await state()).toMatchObject({ status: "SUSPENDED", reason: "Asked to pause" });
    await setPharmacyStatus({ devId: "dev-1" }, pharmacyId, { status: "ACTIVE", reason: "Resumed" });
    await endOn(null);
    await checkSubscriptions(at("2040-01-01"), 7);
    expect((await state()).status).toBe("ACTIVE");
  });
});
