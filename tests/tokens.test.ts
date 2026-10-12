import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { platformDb } from "@/lib/platform-db";
import { issueStaffToken, inspectStaffToken, redeemStaffToken, changeOwnPassword, loadStaffSession } from "@/modules/identity";
import { verifySession, signSession } from "@/lib/session-token";
import { resetDb, makeUser, pharmacyId } from "./helpers";

beforeEach(resetDb);

const dev = { realm: "PLATFORM" as const, id: "dev-1" };

describe("invite and reset links", () => {
  it("set a password once and end existing sessions", async () => {
    const u = await makeUser("ADMIN");
    const oldToken = await signSession("staff", { sub: u.id, pid: u.pharmacyId, sv: u.sessionVersion });
    const { token, path } = await issueStaffToken(u.id, "INVITE", dev);
    expect(path).toBe(`/invite/${token}`);
    expect(token.length).toBeGreaterThanOrEqual(43);

    const info = await inspectStaffToken(token);
    expect(info).toMatchObject({ valid: true, purpose: "INVITE", username: u.username, pharmacy: { slug: "test" } });

    await expect(redeemStaffToken(token, "short")).rejects.toThrow(/10 characters/);
    await expect(redeemStaffToken(token, `${u.username}-password`)).rejects.toThrow(/username/);
    await redeemStaffToken(token, "A-good-new-password");
    const after = await platformDb.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare("A-good-new-password", after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(u.sessionVersion + 1);
    expect(await loadStaffSession(await verifySession("staff", oldToken))).toBeNull();

    await expect(redeemStaffToken(token, "Another-good-password")).rejects.toThrow(/already been used/);
    expect(await inspectStaffToken(token)).toMatchObject({ valid: false });
  });

  it("store only a hash, expire, and are revoked by a newer link", async () => {
    const u = await makeUser("CASHIER");
    const first = await issueStaffToken(u.id, "RESET", dev);
    const second = await issueStaffToken(u.id, "RESET", dev);
    const rows = await platformDb.authToken.findMany({ where: { subjectId: u.id } });
    expect(JSON.stringify(rows)).not.toContain(first.token);
    expect(await inspectStaffToken(first.token)).toMatchObject({ valid: false, problem: expect.stringMatching(/replaced/) });
    expect(await inspectStaffToken(second.token)).toMatchObject({ valid: true, purpose: "RESET" });
    expect(second.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600 * 1000);

    await platformDb.authToken.updateMany({ where: { subjectId: u.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await inspectStaffToken(second.token)).toMatchObject({ valid: false, problem: expect.stringMatching(/expired/) });
    await expect(redeemStaffToken(second.token, "A-good-new-password")).rejects.toThrow(/expired/);
  });

  it("refuse unknown tokens, deactivated accounts and suspended pharmacies", async () => {
    expect(await inspectStaffToken("nope")).toMatchObject({ valid: false });
    const u = await makeUser("CASHIER");
    const { token } = await issueStaffToken(u.id, "INVITE", dev);
    await platformDb.pharmacy.update({ where: { id: pharmacyId }, data: { status: "SUSPENDED" } });
    expect(await inspectStaffToken(token)).toMatchObject({ valid: false });
    await platformDb.pharmacy.update({ where: { id: pharmacyId }, data: { status: "ACTIVE" } });
    await platformDb.user.update({ where: { id: u.id }, data: { active: false } });
    await expect(redeemStaffToken(token, "A-good-new-password")).rejects.toThrow(/cannot be activated/);
  });

  it("only one of two simultaneous submissions succeeds", async () => {
    const u = await makeUser("CASHIER");
    const { token } = await issueStaffToken(u.id, "INVITE", dev);
    const results = await Promise.allSettled([redeemStaffToken(token, "First-good-password"), redeemStaffToken(token, "Second-good-password")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("are audited against the pharmacy", async () => {
    const u = await makeUser("CASHIER");
    const { token } = await issueStaffToken(u.id, "INVITE", dev);
    await redeemStaffToken(token, "A-good-new-password");
    const rows = await platformDb.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.action, r.realm, r.pharmacyId])).toEqual([
      ["user.invite.issue", "PLATFORM", pharmacyId],
      ["user.invite.accept", "STAFF", pharmacyId],
    ]);
  });
});

describe("changing one's own password", () => {
  it("needs the current password and clears the temporary-password flag", async () => {
    const u = await makeUser("CASHIER");
    await platformDb.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash("Temporary-pass-1", 4), mustChangePassword: true } });
    await expect(changeOwnPassword(u.id, "wrong", "A-good-new-password")).rejects.toThrow(/not correct/);
    await expect(changeOwnPassword(u.id, "Temporary-pass-1", "Temporary-pass-1")).rejects.toThrow(/different/);
    const updated = await changeOwnPassword(u.id, "Temporary-pass-1", "A-good-new-password");
    const row = await platformDb.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mustChangePassword).toBe(false);
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
  });
});
