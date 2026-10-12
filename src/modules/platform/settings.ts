import type { Tx } from "@/lib/prisma";
import { runInTx, type DbContext } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit, type AuditContext } from "./audit";

/** Pharmacy details and operational settings as the app and invoices use them. */
export type PharmacySettingsView = {
  pharmacyName: string;
  address: string;
  phone: string;
  email: string;
  invoiceFooter: string;
  expiryWarningDays: number;
  currency: string;
};

export async function getSettings(tx: Tx, pharmacyId: string): Promise<PharmacySettingsView> {
  const pharmacy = await tx.pharmacy.findUnique({ where: { id: pharmacyId }, include: { settings: true } });
  if (!pharmacy) throw new AppError(404, "Pharmacy not found.");
  const s = pharmacy.settings ?? (await tx.pharmacySettings.create({ data: { pharmacyId } }));
  return {
    pharmacyName: pharmacy.name,
    address: pharmacy.address,
    phone: pharmacy.phone,
    email: pharmacy.email ?? "",
    invoiceFooter: s.invoiceFooter,
    expiryWarningDays: s.expiryWarningDays,
    currency: pharmacy.currency,
  };
}

export async function updateSettings(ctx: DbContext & AuditContext, input: PharmacySettingsView) {
  return runInTx(ctx, async (tx) => {
    const before = await getSettings(tx, ctx.pharmacyId);
    await tx.pharmacy.update({
      where: { id: ctx.pharmacyId },
      data: { name: input.pharmacyName, address: input.address, phone: input.phone, email: input.email || null, currency: input.currency },
    });
    await tx.pharmacySettings.update({
      where: { pharmacyId: ctx.pharmacyId },
      data: { invoiceFooter: input.invoiceFooter, expiryWarningDays: input.expiryWarningDays },
    });
    const after = await getSettings(tx, ctx.pharmacyId);
    await audit(tx, ctx, { action: "settings.update", entity: "Pharmacy", entityId: ctx.pharmacyId, before, after });
    return after;
  });
}
