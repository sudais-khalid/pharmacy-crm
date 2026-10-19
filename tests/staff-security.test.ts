import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { signSession, verifySession } from "@/lib/session-token";
import { base32Decode, codeAt, timeStep } from "@/lib/totp";
import {
  confirmStaffEnrolment, disableOwnSecondFactor, loadStaffSession, resetStaffSecondFactor, setStaffTotpRequired,
  setTemporaryPassword, startStaffEnrolment, verifyStaffSecondFactor,
} from "@/modules/identity";
import { listNotifications, markNotificationsRead, notify } from "@/modules/platform";
import { resetDb, makeUser, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const load = async (u: { id: string; pharmacyId: string }, mfa: boolean) => {
  const row = await platformDb.user.findUniqueOrThrow({ where: { id: u.id } });
  return loadStaffSession(await verifySession("staff", await signSession("staff", { sub: u.id, pid: u.pharmacyId, sv: row.sessionVersion, mfa })));
};
const secretOf = (s: string) => base32Decode(s.replace(/\s/g, ""));

describe("staff two-factor sign-in", () => {
  it("is optional per person: once set up, every sign-in needs a code", async () => {
    const u = await makeUser("CASHIER");
    expect((await load(u, false))?.secondFactor).toBeNull();
    const { secret } = await startStaffEnrolment(u.id);
    await expect(confirmStaffEnrolment(u.id, "000000")).rejects.toThrow(/not valid/);
    const { recoveryCodes } = await confirmStaffEnrolment(u.id, codeAt(secretOf(secret), timeStep() - 1));
    expect(recoveryCodes).toHaveLength(10);

    expect((await load(u, false))?.secondFactor).toBe("verify");
    expect((await load(u, true))?.secondFactor).toBeNull();
    const fresh = codeAt(secretOf(secret), timeStep());
    await expect(verifyStaffSecondFactor(u.id, { code: fresh })).resolves.toMatchObject({ method: "totp" });
    await expect(verifyStaffSecondFactor(u.id, { code: fresh })).rejects.toThrow(/not valid/); // each code once
    await expect(verifyStaffSecondFactor(u.id, { recoveryCode: recoveryCodes[0].toLowerCase() })).resolves.toMatchObject({ method: "recovery", recoveryCodesLeft: 9 });
    await expect(verifyStaffSecondFactor(u.id, { recoveryCode: recoveryCodes[0] })).rejects.toThrow(/not valid/);
  });

  it("can be required for everyone, and reset by an admin for a lost phone", async () => {
    const admin = await makeUser("ADMIN");
    const u = await makeUser("CASHIER");
    await setStaffTotpRequired(ctxOf(admin), true);
    expect((await load(u, false))?.secondFactor).toBe("enrol");

    const { secret } = await startStaffEnrolment(u.id);
    await confirmStaffEnrolment(u.id, codeAt(secretOf(secret), timeStep() - 1));
    await expect(disableOwnSecondFactor(u.id, codeAt(secretOf(secret), timeStep()))).rejects.toThrow(/requires two-factor/);

    const before = await platformDb.user.findUniqueOrThrow({ where: { id: u.id } });
    await resetStaffSecondFactor(ctxOf(admin), u.id);
    const after = await platformDb.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after).toMatchObject({ totpEnabledAt: null, totpSecret: null, recoveryCodes: [], sessionVersion: before.sessionVersion + 1 });
    expect((await load(u, false))?.secondFactor).toBe("enrol");
  });
});

describe("password reset requests", () => {
  it("reach the people who manage staff, once, and close when a new password is given", async () => {
    const admin = await makeUser("ADMIN");
    const cashier = await makeUser("CASHIER");
    const request = () => notify(platformDb, pharmacyId, { type: "RESET_REQUEST", audiencePermission: "users.manage", dedupeKey: `reset-request:${cashier.id}`, title: "Cashier asked for a new password", link: "/users" });
    await request();
    await request();
    const forAdmin = await listNotifications(ctxOf(admin));
    expect(forAdmin.items).toHaveLength(1);
    expect(forAdmin.unread).toBe(1);
    expect((await listNotifications(ctxOf(cashier))).items).toHaveLength(0);

    await markNotificationsRead(ctxOf(admin), "all");
    expect((await listNotifications(ctxOf(admin))).unread).toBe(0);
    await setTemporaryPassword(ctxOf(admin), cashier.id);
    expect((await listNotifications(ctxOf(admin))).items).toHaveLength(0);
  });
});
