import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { recordHit } from "@/lib/rate-limit";
import { signSession, verifySession } from "@/lib/session-token";
import { loadStaffSession, inspectStaffToken } from "@/modules/identity";
import { listAccounts, setAccountActive, forceLogoutAccount, issueAccountReset, unlockAccount, createPharmacy, createPharmacySchema } from "@/modules/tenancy";
import { resetDb, makeUser, makePharmacy, pharmacyId } from "./helpers";

beforeEach(resetDb);

const dev = { devId: "dev-1" };
const sessionOf = async (u: { id: string; pharmacyId: string; sessionVersion: number }) => {
  const token = await signSession("staff", { sub: u.id, pid: u.pharmacyId, sv: u.sessionVersion });
  return () => verifySession("staff", token).then(loadStaffSession);
};

describe("accounts across pharmacies", () => {
  it("lists staff of every pharmacy without hidden support accounts, with search and filter", async () => {
    await makeUser("CASHIER");
    const other = await makePharmacy("other");
    await makeUser("ADMIN", other.id);
    await createPharmacy(dev, createPharmacySchema.parse({ pharmacy: { name: "Third", slug: "third" }, plan: {}, admin: { name: "Third Admin", username: "boss", email: "boss@third.example" }, credentials: "invite" }));
    const all = await listAccounts();
    expect(all.total).toBe(3);
    expect(all.items.every((a) => a.username !== "platform-support")).toBe(true);
    expect((await listAccounts({ q: "boss" })).items.map((a) => a.pharmacy.slug)).toEqual(["third"]);
    expect((await listAccounts({ pharmacyId: other.id })).total).toBe(1);
  });

  it("deactivation and forced logout end sessions; reactivation does not revive old tokens", async () => {
    const u = await makeUser("CASHIER");
    const load = await sessionOf(u);
    await forceLogoutAccount(dev, u.id);
    expect(await load()).toBeNull();

    const fresh = await platformDb.user.findUniqueOrThrow({ where: { id: u.id } });
    const load2 = await sessionOf(fresh);
    await setAccountActive(dev, u.id, false);
    expect(await load2()).toBeNull();
    await setAccountActive(dev, u.id, true);
    expect(await load2()).toBeNull(); // the old token stays dead, the person signs in again
    const actions = (await platformDb.auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => [a.action, a.realm, a.pharmacyId]);
    expect(actions).toEqual([["user.logout.force", "PLATFORM", pharmacyId], ["user.deactivate", "PLATFORM", pharmacyId], ["user.activate", "PLATFORM", pharmacyId]]);
  });

  it("issues a reset link that works for that person", async () => {
    const u = await makeUser("PHARMACIST");
    const { path } = await issueAccountReset(dev, u.id);
    expect(path).toMatch(/^\/reset\//);
    expect(await inspectStaffToken(path.split("/").pop()!)).toMatchObject({ valid: true, purpose: "RESET", username: u.username });
  });

  it("shows and clears a sign-in lock", async () => {
    const u = await makeUser("CASHIER");
    for (let i = 0; i < 8; i++) await recordHit(`login:local:${u.email}`);
    await recordHit("login:local:someone-else@t.test");
    expect((await listAccounts()).items.find((a) => a.id === u.id)?.locked).toBe(true);
    expect(await unlockAccount(dev, u.id)).toEqual({ clearedAttempts: 8 });
    expect((await listAccounts()).items.find((a) => a.id === u.id)?.locked).toBe(false);
    expect(await platformDb.rateLimitHit.count()).toBe(1);
  });

  it("refuses hidden support accounts and unknown ids", async () => {
    const r = await createPharmacy(dev, createPharmacySchema.parse({ pharmacy: { name: "Fourth", slug: "fourth" }, plan: {}, admin: { name: "Admin Four", username: "four", email: "four@x.example" }, credentials: "invite" }));
    const support = await platformDb.user.findFirstOrThrow({ where: { pharmacyId: r.pharmacy.id, isSystem: true } });
    await expect(setAccountActive(dev, support.id, false)).rejects.toThrow(/not found/);
    await expect(issueAccountReset(dev, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });
});
