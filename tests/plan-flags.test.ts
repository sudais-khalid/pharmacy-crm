import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { getFeatureFlags } from "@/modules/platform";
import { createUser, updateUser } from "@/modules/identity";
import { setFeatureFlag, setPharmacyPlan, setAccountActive } from "@/modules/tenancy";
import { resetDb, makeUser, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const dev = { devId: "dev-1" };

describe("feature switches", () => {
  it("fall back to defaults, can be changed, and are audited", async () => {
    expect(await getFeatureFlags(platformDb, pharmacyId)).toMatchObject({ ocr: true, cashSessions: false });
    await setFeatureFlag(dev, pharmacyId, "ocr", false);
    await setFeatureFlag(dev, pharmacyId, "cashSessions", true);
    expect(await getFeatureFlags(platformDb, pharmacyId)).toMatchObject({ ocr: false, cashSessions: true, returns: true });
    const rows = await platformDb.auditLog.findMany({ where: { action: "pharmacy.feature.update" }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.before, r.after])).toEqual([[{ ocr: true }, { ocr: false }], [{ cashSessions: false }, { cashSessions: true }]]);
    await expect(setFeatureFlag(dev, "00000000-0000-0000-0000-000000000000", "ocr", true)).rejects.toThrow(/not found/);
  });
});

describe("plan and limits", () => {
  it("update the plan with an audit of old and new values", async () => {
    await setPharmacyPlan(dev, pharmacyId, { plan: "PREMIUM", maxUsers: 3, ocrMonthlyLimit: 1000, subscriptionEndsAt: "2027-12-31" });
    const p = await platformDb.pharmacy.findUniqueOrThrow({ where: { id: pharmacyId } });
    expect(p).toMatchObject({ plan: "PREMIUM", maxUsers: 3, ocrMonthlyLimit: 1000 });
    expect(p.subscriptionEndsAt?.toISOString().slice(0, 10)).toBe("2027-12-31");
    const row = await platformDb.auditLog.findFirstOrThrow({ where: { action: "pharmacy.plan.update" } });
    expect(row.before).toMatchObject({ plan: "STANDARD", maxUsers: 10 });
  });

  it("cap active staff when creating and reactivating accounts", async () => {
    await setPharmacyPlan(dev, pharmacyId, { plan: "SMALL", maxUsers: 2, ocrMonthlyLimit: 0 });
    const admin = await makeUser("ADMIN");
    const second = await createUser(ctxOf(admin), { name: "Second", email: "second@t.test", password: "Second-password-1", role: "CASHIER" });
    await expect(createUser(ctxOf(admin), { name: "Third", email: "third@t.test", password: "Third-password-1", role: "CASHIER" })).rejects.toThrow(/allows 2 active staff/);

    await updateUser(ctxOf(admin), second.id, { active: false });
    const third = await createUser(ctxOf(admin), { name: "Third", email: "third@t.test", password: "Third-password-1", role: "CASHIER" });
    await expect(updateUser(ctxOf(admin), second.id, { active: true })).rejects.toThrow(/allows 2 active staff/);
    await expect(setAccountActive(dev, second.id, true)).rejects.toThrow(/allows 2 active staff/);

    await setPharmacyPlan(dev, pharmacyId, { plan: "SMALL", maxUsers: 3, ocrMonthlyLimit: 0 });
    await expect(setAccountActive(dev, second.id, true)).resolves.toEqual({ active: true });
    expect(third.id).toBeTruthy();
  });
});
