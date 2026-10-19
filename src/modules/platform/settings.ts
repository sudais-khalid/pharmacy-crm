import type { Tx } from "@/lib/prisma";
import { runInTx, type DbContext } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit, type AuditContext } from "./audit";

/** Pharmacy profile, branding and operational settings, as the app, receipts and the sign-in page use them. */
export type PharmacySettingsView = {
  pharmacyName: string;
  legalName: string;
  address: string;
  city: string;
  phone: string;
  whatsapp: string;
  email: string;
  licenseNumber: string;
  taxNumber: string;
  receiptHeader: string;
  invoiceFooter: string;
  brandColor: string | null;
  logoFileId: string | null;
  logoIconFileId: string | null;
  expiryWarningDays: number;
  currency: string;
};

export async function getSettings(tx: Tx, pharmacyId: string): Promise<PharmacySettingsView> {
  const pharmacy = await tx.pharmacy.findUnique({ where: { id: pharmacyId }, include: { settings: true } });
  if (!pharmacy) throw new AppError(404, "Pharmacy not found.");
  const s = pharmacy.settings ?? (await tx.pharmacySettings.create({ data: { pharmacyId } }));
  return {
    pharmacyName: pharmacy.name,
    legalName: pharmacy.legalName ?? "",
    address: pharmacy.address,
    city: pharmacy.city ?? "",
    phone: pharmacy.phone,
    whatsapp: pharmacy.whatsapp ?? "",
    email: pharmacy.email ?? "",
    licenseNumber: pharmacy.licenseNumber ?? "",
    taxNumber: pharmacy.taxNumber ?? "",
    receiptHeader: s.receiptHeader,
    invoiceFooter: s.invoiceFooter,
    brandColor: pharmacy.brandColor,
    logoFileId: pharmacy.logoFileId,
    logoIconFileId: pharmacy.logoIconFileId,
    expiryWarningDays: s.expiryWarningDays,
    currency: pharmacy.currency,
  };
}

/** Operational settings (settings.manage). The profile and branding are edited in branding.ts. */
export async function updateSettings(ctx: DbContext & AuditContext, input: { expiryWarningDays: number; currency: string }) {
  return runInTx(ctx, async (tx) => {
    const before = await getSettings(tx, ctx.pharmacyId);
    await tx.pharmacy.update({ where: { id: ctx.pharmacyId }, data: { currency: input.currency } });
    await tx.pharmacySettings.update({ where: { pharmacyId: ctx.pharmacyId }, data: { expiryWarningDays: input.expiryWarningDays } });
    const after = await getSettings(tx, ctx.pharmacyId);
    await audit(tx, ctx, {
      action: "settings.update", entity: "Pharmacy", entityId: ctx.pharmacyId,
      before: { expiryWarningDays: before.expiryWarningDays, currency: before.currency },
      after: { expiryWarningDays: after.expiryWarningDays, currency: after.currency },
    });
    return after;
  });
}
