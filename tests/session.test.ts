import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { signSession, verifySession, needsRefresh } from "@/lib/session-token";
import { SYSTEM_ROLES, loadStaffSession, loadPlatformSession, updateUser, forceLogout, setTemporaryPassword } from "@/modules/identity";
import { resetDb, makePharmacy, makeUser, ctxOf } from "./helpers";

beforeEach(resetDb);

const staffToken = (u: { id: string; pharmacyId: string; sessionVersion: number }) => signSession("staff", { sub: u.id, pid: u.pharmacyId, sv: u.sessionVersion });

describe("session tokens", () => {
  it("are bound to their realm", async () => {
    const staff = await signSession("staff", { sub: "u1", pid: "p1", sv: 1 });
    const platform = await signSession("platform", { sub: "d1", sv: 1, mfa: true });
    expect(await verifySession("staff", staff)).toMatchObject({ sub: "u1", pid: "p1", sv: 1 });
    expect(await verifySession("platform", staff)).toBeNull();
    expect(await verifySession("staff", platform)).toBeNull();
    expect(await verifySession("platform", platform)).toMatchObject({ sub: "d1", mfa: true });
  });

  it("reject tampering, foreign keys and staff tokens without a pharmacy", async () => {
    const t = await signSession("staff", { sub: "u1", pid: "p1", sv: 1 });
    const [h, p, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "admin" })).toString("base64url");
    expect(await verifySession("staff", `${h}.${forged}.${sig}`)).toBeNull();
    expect(await verifySession("staff", "not-a-token")).toBeNull();
    expect(await verifySession("staff", await signSession("staff", { sub: "u1", sv: 1 }))).toBeNull();
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "another-secret-another-secret-another-1";
    const other = await signSession("staff", { sub: "u1", pid: "p1", sv: 1 });
    process.env.JWT_SECRET = original;
    expect(await verifySession("staff", other)).toBeNull();
  });

  it("refresh after half of the lifetime", async () => {
    const s = (await verifySession("staff", await signSession("staff", { sub: "u", pid: "p", sv: 1 })))!;
    expect(needsRefresh(s, s.iat + 60)).toBe(false);
    expect(needsRefresh(s, s.iat + (s.exp - s.iat) / 2 + 1)).toBe(true);
  });
});

describe("staff sessions", () => {
  it("load the account for a valid token", async () => {
    const u = await makeUser("CASHIER");
    const s = await loadStaffSession(await verifySession("staff", await staffToken(u)));
    expect(s).toMatchObject({ id: u.id, pharmacyId: u.pharmacyId, role: { key: "CASHIER", name: "Cashier" } });
    expect(s?.permissions).toContain("pos.use");
    expect(s?.permissions).not.toContain("cost.view");
  });

  it("end when the account is deactivated, its role or password changes, or logout is forced", async () => {
    const admin = await makeUser("ADMIN");
    for (const change of [{ active: false }, { roleId: SYSTEM_ROLES.PHARMACIST.id }, "password", "force"] as const) {
      const u = await makeUser("CASHIER");
      const token = await staffToken(u);
      expect(await loadStaffSession(await verifySession("staff", token))).not.toBeNull();
      if (change === "force") await forceLogout(ctxOf(admin), u.id);
      else if (change === "password") await setTemporaryPassword(ctxOf(admin), u.id);
      else await updateUser(ctxOf(admin), u.id, change);
      expect(await loadStaffSession(await verifySession("staff", token)), JSON.stringify(change)).toBeNull();
    }
  });

  it("keep sessions when only the name changes", async () => {
    const admin = await makeUser("ADMIN");
    const u = await makeUser("CASHIER");
    const token = await staffToken(u);
    await updateUser(ctxOf(admin), u.id, { name: "Renamed" });
    expect(await loadStaffSession(await verifySession("staff", token))).toMatchObject({ name: "Renamed" });
  });

  it("refuse a token naming another pharmacy and system accounts", async () => {
    const other = await makePharmacy("other");
    const u = await makeUser("CASHIER");
    expect(await loadStaffSession(await verifySession("staff", await signSession("staff", { sub: u.id, pid: other.id, sv: 1 })))).toBeNull();
    await platformDb.user.update({ where: { id: u.id }, data: { isSystem: true } });
    expect(await loadStaffSession(await verifySession("staff", await staffToken(u)))).toBeNull();
  });
});

describe("platform sessions", () => {
  it("carry the second-factor state and end when the session version changes", async () => {
    const dev = await platformDb.platformUser.create({ data: { name: "Dev", email: "dev@t.test", passwordHash: "x" } });
    const token = await signSession("platform", { sub: dev.id, sv: dev.sessionVersion, mfa: false });
    expect(await loadPlatformSession(await verifySession("platform", token))).toMatchObject({ id: dev.id, mfa: false, totpEnabled: false });
    await platformDb.platformUser.update({ where: { id: dev.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await loadPlatformSession(await verifySession("platform", token))).toBeNull();
  });
});
