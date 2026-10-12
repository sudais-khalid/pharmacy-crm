import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { signSession, verifySession } from "@/lib/session-token";
import { base32Decode, codeAt, timeStep } from "@/lib/totp";
import { open } from "@/lib/secret-box";
import { loadStaffSession, ensurePlatformOwner, startTotpEnrolment, confirmTotpEnrolment, reauthenticateDeveloper, issueStaffToken, inspectStaffToken } from "@/modules/identity";
import { setPharmacyStatus } from "@/modules/tenancy";
import { resetDb, makeUser, pharmacyId } from "./helpers";

beforeEach(resetDb);

const dev = { devId: "dev-1" };
const tokenFor = (u: { id: string; pharmacyId: string; sessionVersion: number }) => signSession("staff", { sub: u.id, pid: u.pharmacyId, sv: u.sessionVersion });

describe("pharmacy status", () => {
  it("suspension ends staff sessions at once and reactivation restores them", async () => {
    const u = await makeUser("CASHIER");
    const token = await tokenFor(u);
    const load = async () => loadStaffSession(await verifySession("staff", token));
    expect(await load()).not.toBeNull();

    await setPharmacyStatus(dev, pharmacyId, { status: "GRACE", reason: "Subscription ended" });
    expect(await load()).not.toBeNull();
    await setPharmacyStatus(dev, pharmacyId, { status: "SUSPENDED", reason: "Unpaid" });
    expect(await load()).toBeNull();
    await setPharmacyStatus(dev, pharmacyId, { status: "DEACTIVATED", reason: "Closed" });
    expect(await load()).toBeNull();
    await setPharmacyStatus(dev, pharmacyId, { status: "ACTIVE", reason: "Paid" });
    expect(await load()).not.toBeNull();

    const actions = (await platformDb.auditLog.findMany({ where: { entity: "Pharmacy" }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["pharmacy.status.grace", "pharmacy.status.suspended", "pharmacy.status.deactivated", "pharmacy.status.active"]);
    await expect(setPharmacyStatus(dev, pharmacyId, { status: "ACTIVE", reason: "again" })).rejects.toThrow(/already/);
  });

  it("invite links cannot be used while suspended, and keep working after reactivation", async () => {
    const u = await makeUser("CASHIER");
    const { token } = await issueStaffToken(u.id, "INVITE", { realm: "PLATFORM", id: "dev-1" });
    await setPharmacyStatus(dev, pharmacyId, { status: "SUSPENDED", reason: "Unpaid" });
    expect(await inspectStaffToken(token)).toMatchObject({ valid: false });
    await setPharmacyStatus(dev, pharmacyId, { status: "ACTIVE", reason: "Paid" });
    expect(await inspectStaffToken(token)).toMatchObject({ valid: true });
  });
});

describe("re-authentication for dangerous actions", () => {
  it("needs a fresh, unused authenticator code", async () => {
    await ensurePlatformOwner({ PLATFORM_OWNER_EMAIL: "owner@example.com", PLATFORM_OWNER_PASSWORD: "Correct-Horse-42" });
    const owner = await platformDb.platformUser.findFirstOrThrow();
    await startTotpEnrolment(owner.id);
    const secret = async () => base32Decode(open((await platformDb.platformUser.findUniqueOrThrow({ where: { id: owner.id } })).totpSecret!));
    await confirmTotpEnrolment(owner.id, codeAt(await secret(), timeStep() - 1));

    await expect(reauthenticateDeveloper(owner.id, undefined)).rejects.toThrow(/Enter a code/);
    await expect(reauthenticateDeveloper(owner.id, "000000")).rejects.toThrow(/not valid/);
    const fresh = codeAt(await secret(), timeStep());
    await expect(reauthenticateDeveloper(owner.id, fresh)).resolves.toBeUndefined();
    await expect(reauthenticateDeveloper(owner.id, fresh)).rejects.toThrow(/not valid/);
  });
});
