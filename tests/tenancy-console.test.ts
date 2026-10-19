import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { platformDb } from "@/lib/platform-db";
import { tenantTransaction } from "@/lib/db";
import { createPharmacy, createPharmacySchema, listPharmacies, getPharmacyDetail, updatePharmacyProfile, slugSchema } from "@/modules/tenancy";
import { SYSTEM_ROLES, inspectStaffToken, redeemStaffToken } from "@/modules/identity";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const dev = { devId: "dev-1" };
const input = (over: Record<string, unknown> = {}) =>
  createPharmacySchema.parse({
    pharmacy: { name: "City Care", slug: "city-care", city: "Rawalpindi", phone: "051-1234567" },
    plan: { plan: "STANDARD", maxUsers: 5, ocrMonthlyLimit: 100, subscriptionEndsAt: "2027-10-12" },
    features: ["ocr", "returns"],
    admin: { name: "Ayesha Khan", username: "ayesha", email: "ayesha@citycare.example" },
    credentials: "invite",
    ...over,
  });

describe("creating a pharmacy", () => {
  it("sets up the pharmacy, settings, flags, a hidden support account and an invited admin", async () => {
    const r = await createPharmacy(dev, input());
    expect(r.credentials.kind).toBe("invite");
    const p = await platformDb.pharmacy.findUniqueOrThrow({ where: { id: r.pharmacy.id }, include: { settings: true } });
    expect(p).toMatchObject({ slug: "city-care", status: "ACTIVE", maxUsers: 5, ocrMonthlyLimit: 100, createdById: "dev-1" });
    expect(p.settings).not.toBeNull();

    const users = await platformDb.user.findMany({ where: { pharmacyId: p.id }, orderBy: { username: "asc" } });
    expect(users.map((u) => [u.username, u.roleId, u.isSystem])).toEqual([["ayesha", SYSTEM_ROLES.PHARMACY_ADMIN.id, false], ["platform-support", SYSTEM_ROLES.PHARMACY_ADMIN.id, true]]);

    const flags = Object.fromEntries((await platformDb.featureFlag.findMany({ where: { pharmacyId: p.id } })).map((f) => [f.key, f.enabled]));
    expect(flags).toEqual({ ocr: true, returns: true, purchaseOrders: false, cashSessions: false, expenses: false });

    // the invite works and is the only way in
    if (r.credentials.kind !== "invite") throw new Error("expected invite");
    const token = r.credentials.path.split("/").pop()!;
    expect(await inspectStaffToken(token)).toMatchObject({ valid: true, username: "ayesha", pharmacy: { slug: "city-care" } });
    await redeemStaffToken(token, "Chooses-a-strong-one");
    const admin = await platformDb.user.findFirstOrThrow({ where: { username: "ayesha" } });
    expect(await bcrypt.compare("Chooses-a-strong-one", admin.passwordHash)).toBe(true);

    const audit = await platformDb.auditLog.findFirstOrThrow({ where: { action: "pharmacy.create" } });
    expect(audit).toMatchObject({ realm: "PLATFORM", pharmacyId: p.id, actorId: "dev-1" });
  });

  it("can hand out a temporary password that must be changed", async () => {
    const r = await createPharmacy(dev, input({ credentials: "password" }));
    if (r.credentials.kind !== "password") throw new Error("expected password");
    expect(r.credentials.password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    const admin = await platformDb.user.findFirstOrThrow({ where: { username: "ayesha" } });
    expect(admin.mustChangePassword).toBe(true);
    expect(await bcrypt.compare(r.credentials.password, admin.passwordHash)).toBe(true);
  });

  it("works with tenant isolation from the first minute", async () => {
    const r = await createPharmacy(dev, input());
    const visible = await tenantTransaction(r.pharmacy.id, (tx) => tx.user.findMany({ select: { username: true } }));
    expect(visible.map((u) => u.username).sort()).toEqual(["ayesha", "platform-support"]);
  });

  it("refuses taken URL names and invalid or reserved names", async () => {
    await createPharmacy(dev, input());
    await expect(createPharmacy(dev, input())).rejects.toThrow(/URL name already exists/);
    // the same person may administer two pharmacies: emails are unique per pharmacy only
    await expect(createPharmacy(dev, input({ pharmacy: { name: "Other", slug: "other" } }))).resolves.toMatchObject({ pharmacy: { slug: "other" } });
    for (const bad of ["platform", "a", "-bad", "bad-", "has space", "x".repeat(41)]) expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    expect(slugSchema.parse("Al-Shifa-2")).toBe("al-shifa-2");
  });
});

describe("console listing and detail", () => {
  it("count staff without the hidden support account and keep it out of the detail", async () => {
    const r = await createPharmacy(dev, input());
    const [row] = await listPharmacies();
    expect(row).toMatchObject({ slug: "city-care", staffCount: 1, invoicesThisMonth: 0 });
    expect(await listPharmacies({ q: "rawal" })).toHaveLength(1);
    expect(await listPharmacies({ status: "SUSPENDED" })).toHaveLength(0);
    const detail = await getPharmacyDetail(r.pharmacy.id);
    expect(detail.staff.map((s) => s.username)).toEqual(["ayesha"]);
    expect(detail.flags).toHaveLength(5);
  });

  it("audit profile edits with the old and new values", async () => {
    const r = await createPharmacy(dev, input());
    await updatePharmacyProfile(dev, r.pharmacy.id, { name: "City Care Plus" });
    const row = await platformDb.auditLog.findFirstOrThrow({ where: { action: "pharmacy.profile.update" } });
    expect(row.before).toMatchObject({ name: "City Care" });
    expect(row.after).toMatchObject({ name: "City Care Plus" });
  });
});
