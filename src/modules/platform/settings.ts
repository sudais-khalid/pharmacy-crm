import type { Tx } from "@/lib/prisma";
import { runInTx, type DbContext } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit, type AuditContext } from "./audit";
import { readUsage } from "./counters";
import { getFeatureFlags } from "./flags";

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
  /** Days before expiry when a batch raises an alert (roadmap 6.1). */
  expiryAlertDays: number;
  currency: string;
  /** Photo reading: the providers the Developer allows, the pharmacy's choice and this month's pages. */
  ocrProviders: string[];
  ocrProvider: string;
  ocrMonthlyLimit: number;
  ocrUsedThisMonth: number;
  /** Receipts and the cash drawer (Phase 5). */
  receiptFormat: ReceiptFormat;
  autoPrintReceipt: boolean;
  receiptBatchLines: boolean;
  requireCashSession: boolean;
  cashDiffThreshold: number;
  /** Feature switches set by the Developer that change the counter. */
  cashSessionsOn: boolean;
  returnsOn: boolean;
};

export const RECEIPT_FORMATS = ["THERMAL_80", "THERMAL_58", "A4"] as const;
export type ReceiptFormat = (typeof RECEIPT_FORMATS)[number];
const receiptFormat = (v: string): ReceiptFormat => ((RECEIPT_FORMATS as readonly string[]).includes(v) ? (v as ReceiptFormat) : "THERMAL_80");

export async function getSettings(tx: Tx, pharmacyId: string): Promise<PharmacySettingsView> {
  const pharmacy = await tx.pharmacy.findUnique({ where: { id: pharmacyId }, include: { settings: true } });
  if (!pharmacy) throw new AppError(404, "Pharmacy not found.");
  const s = pharmacy.settings ?? (await tx.pharmacySettings.create({ data: { pharmacyId } }));
  const flags = await getFeatureFlags(tx, pharmacyId);
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
    expiryAlertDays: s.expiryAlertDays,
    currency: pharmacy.currency,
    ocrProviders: pharmacy.ocrProviders,
    ocrProvider: pharmacy.ocrProviders.includes(s.ocrProvider) ? s.ocrProvider : (pharmacy.ocrProviders[0] ?? "LOCAL"),
    ocrMonthlyLimit: pharmacy.ocrMonthlyLimit,
    ocrUsedThisMonth: await readUsage(tx, `USAGE_OCR_${new Date().toISOString().slice(0, 7).replace("-", "")}`),
    receiptFormat: receiptFormat(s.receiptFormat),
    autoPrintReceipt: s.autoPrintReceipt,
    receiptBatchLines: s.receiptBatchLines,
    requireCashSession: s.requireCashSession,
    cashDiffThreshold: Number(s.cashDiffThreshold),
    cashSessionsOn: flags.cashSessions,
    returnsOn: flags.returns,
  };
}

export type SettingsInput = {
  expiryWarningDays: number;
  expiryAlertDays?: number;
  currency: string;
  ocrProvider?: "LOCAL" | "CLOUD";
  receiptFormat?: ReceiptFormat;
  autoPrintReceipt?: boolean;
  receiptBatchLines?: boolean;
  requireCashSession?: boolean;
  cashDiffThreshold?: number;
};
const AUDITED = ["expiryWarningDays", "expiryAlertDays", "currency", "ocrProvider", "receiptFormat", "autoPrintReceipt", "receiptBatchLines", "requireCashSession", "cashDiffThreshold"] as const;

/** Operational settings (settings.manage). The profile and branding are edited in branding.ts. Fields left out keep their value. */
export async function updateSettings(ctx: DbContext & AuditContext, input: SettingsInput) {
  return runInTx(ctx, async (tx) => {
    const before = await getSettings(tx, ctx.pharmacyId);
    const ocrProvider = input.ocrProvider ?? before.ocrProvider;
    if (!before.ocrProviders.includes(ocrProvider)) throw new AppError(400, "This photo reader is not part of your plan.");
    await tx.pharmacy.update({ where: { id: ctx.pharmacyId }, data: { currency: input.currency } });
    await tx.pharmacySettings.update({
      where: { pharmacyId: ctx.pharmacyId },
      data: {
        expiryWarningDays: input.expiryWarningDays, ocrProvider,
        expiryAlertDays: input.expiryAlertDays ?? before.expiryAlertDays,
        receiptFormat: input.receiptFormat ?? before.receiptFormat,
        autoPrintReceipt: input.autoPrintReceipt ?? before.autoPrintReceipt,
        receiptBatchLines: input.receiptBatchLines ?? before.receiptBatchLines,
        requireCashSession: input.requireCashSession ?? before.requireCashSession,
        cashDiffThreshold: input.cashDiffThreshold ?? before.cashDiffThreshold,
      },
    });
    const after = await getSettings(tx, ctx.pharmacyId);
    // the basic fields always, the others when they changed
    const keys = AUDITED.filter((k) => k === "expiryWarningDays" || k === "currency" || k === "ocrProvider" || before[k] !== after[k]);
    await audit(tx, ctx, {
      action: "settings.update", entity: "Pharmacy", entityId: ctx.pharmacyId,
      before: Object.fromEntries(keys.map((k) => [k, before[k]])),
      after: Object.fromEntries(keys.map((k) => [k, after[k]])),
    });
    return after;
  });
}
