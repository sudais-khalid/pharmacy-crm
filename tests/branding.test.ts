import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { tenantTransaction } from "@/lib/db";
import { getSettings, profileSchema, removeLogo, setLogo, updateProfile } from "@/modules/platform";
import { publicPharmacyInfo } from "@/modules/tenancy";
import { resetDb, makeUser, ctxOf, pharmacyId } from "./helpers";
import { testPng } from "./png";

beforeEach(resetDb);

const profile = (over: Record<string, unknown> = {}) =>
  profileSchema.parse({ pharmacyName: "City Care", address: "Main Road", phone: "0300-1234567", licenseNumber: "DSL-123", receiptHeader: "Open 24 hours", invoiceFooter: "Get well soon", brandColor: "0b3d91", ...over });

describe("profile and branding", () => {
  it("updates the profile, receipt texts and colour, auditing only what changed", async () => {
    const admin = await makeUser("ADMIN");
    const after = await updateProfile(ctxOf(admin), profile());
    expect(after).toMatchObject({ pharmacyName: "City Care", licenseNumber: "DSL-123", receiptHeader: "Open 24 hours", brandColor: "#0B3D91" });
    await updateProfile(ctxOf(admin), profile({ phone: "0300-7654321" }));
    const rows = await platformDb.auditLog.findMany({ where: { action: "pharmacy.profile.update" }, orderBy: { id: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[1].after).toEqual({ phone: "0300-7654321" });
    expect(await publicPharmacyInfo("test")).toMatchObject({ name: "City Care", brandColor: "#0B3D91", hasLogo: false });
  });

  it("refuses unreadable colours", () => {
    expect(() => profile({ brandColor: "#FFF3B0" })).toThrow(/too light/);
    expect(profile({ brandColor: "" }).brandColor).toBeNull();
  });

  it("stores a checked logo in two sizes and can remove it", async () => {
    const admin = await makeUser("ADMIN");
    const r = await setLogo(ctxOf(admin), { logo: testPng(512, "a"), icon: testPng(128, "a") });
    const s = await tenantTransaction(pharmacyId, (tx) => getSettings(tx, pharmacyId));
    expect(s).toMatchObject({ logoFileId: r.logoFileId, logoIconFileId: r.logoIconFileId });
    const file = await platformDb.storedFile.findUniqueOrThrow({ where: { id: r.logoFileId } });
    expect(file).toMatchObject({ purpose: "LOGO", mime: "image/png", width: 512, height: 512, pharmacyId });

    // the same picture again is stored once
    await setLogo(ctxOf(admin), { logo: testPng(512, "a"), icon: testPng(128, "a") });
    expect(await platformDb.storedFile.count()).toBe(2);

    await expect(setLogo(ctxOf(admin), { logo: testPng(1024), icon: testPng(128) })).rejects.toThrow(/between 64 and 512/);
    await expect(setLogo(ctxOf(admin), { logo: Buffer.from("<svg/>"), icon: testPng(128) })).rejects.toThrow(/PNG/);
    await removeLogo(ctxOf(admin));
    expect((await tenantTransaction(pharmacyId, (tx) => getSettings(tx, pharmacyId))).logoFileId).toBeNull();
  });
});
