import { z } from "zod";
import { runInTx, type DbContext } from "@/lib/db";
import { brandColorProblem } from "@/lib/brand";
import { AppError } from "@/lib/errors";
import { storeFile } from "@/lib/files";
import { sniffImage } from "@/lib/images";
import { audit, type AuditContext } from "./audit";
import { getSettings, type PharmacySettingsView } from "./settings";

/**
 * The pharmacy's own profile and branding (docs/plan/05-roadmap.md, task 3.6), edited by people with
 * branding.manage. Status, plan, limits and the sign-in code stay with the Developer.
 */
const text = (max: number) => z.string().trim().max(max).default("");

export const profileSchema = z.object({
  pharmacyName: z.string().trim().min(2, "Name is required").max(120),
  legalName: text(160),
  address: text(250),
  city: text(80),
  phone: text(50),
  whatsapp: text(50),
  email: z.string().trim().toLowerCase().max(120).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "A valid email, or leave it empty").default(""),
  licenseNumber: text(80),
  taxNumber: text(80),
  receiptHeader: text(200),
  invoiceFooter: text(250),
  brandColor: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((v) => (v ? `#${v.replace(/^#/, "").toUpperCase()}` : null))
    .superRefine((v, c) => {
      const problem = v ? brandColorProblem(v) : null;
      if (problem) c.addIssue({ code: "custom", message: problem });
    }),
});
export type ProfileInput = z.infer<typeof profileSchema>;

const PROFILE_KEYS = Object.keys(profileSchema.shape) as (keyof ProfileInput & keyof PharmacySettingsView)[];

export async function updateProfile(ctx: DbContext & AuditContext, input: ProfileInput) {
  return runInTx(ctx, async (tx) => {
    const before = await getSettings(tx, ctx.pharmacyId);
    const empty = (v: string) => v || null;
    await tx.pharmacy.update({
      where: { id: ctx.pharmacyId },
      data: {
        name: input.pharmacyName, legalName: empty(input.legalName), address: input.address, city: empty(input.city), phone: input.phone,
        whatsapp: empty(input.whatsapp), email: empty(input.email), licenseNumber: empty(input.licenseNumber), taxNumber: empty(input.taxNumber),
        brandColor: input.brandColor,
      },
    });
    await tx.pharmacySettings.update({ where: { pharmacyId: ctx.pharmacyId }, data: { receiptHeader: input.receiptHeader, invoiceFooter: input.invoiceFooter } });
    const after = await getSettings(tx, ctx.pharmacyId);
    const changed = PROFILE_KEYS.filter((k) => before[k] !== after[k]);
    if (changed.length) {
      await audit(tx, ctx, {
        action: "pharmacy.profile.update", entity: "Pharmacy", entityId: ctx.pharmacyId,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
    }
    return after;
  });
}

const LOGO_LIMITS = { logo: { max: 512, min: 64, bytes: 400_000 }, icon: { max: 128, min: 32, bytes: 100_000 } } as const;

function checkLogo(kind: keyof typeof LOGO_LIMITS, data: Buffer) {
  const limit = LOGO_LIMITS[kind];
  const info = sniffImage(data);
  if (!info || info.mime !== "image/png") throw new AppError(400, "The logo must be a PNG picture.");
  if (data.length > limit.bytes) throw new AppError(400, "The logo file is too large.");
  if (Math.max(info.width, info.height) > limit.max || Math.min(info.width, info.height) < limit.min) {
    throw new AppError(400, `The ${kind === "logo" ? "logo" : "small logo"} must be between ${limit.min} and ${limit.max} pixels on each side.`);
  }
  return info;
}

/** Sets the logo from two PNGs the browser prepared: 512 px for receipts and 128 px for the header. */
export async function setLogo(ctx: DbContext & AuditContext, files: { logo: Buffer; icon: Buffer }) {
  const logoInfo = checkLogo("logo", files.logo);
  const iconInfo = checkLogo("icon", files.icon);
  return runInTx(ctx, async (tx) => {
    const logo = await storeFile(tx, { purpose: "LOGO", mime: "image/png", data: files.logo, width: logoInfo.width, height: logoInfo.height, uploadedById: ctx.actor.id });
    const icon = await storeFile(tx, { purpose: "LOGO_ICON", mime: "image/png", data: files.icon, width: iconInfo.width, height: iconInfo.height, uploadedById: ctx.actor.id });
    await tx.pharmacy.update({ where: { id: ctx.pharmacyId }, data: { logoFileId: logo.id, logoIconFileId: icon.id } });
    await audit(tx, ctx, { action: "pharmacy.logo.update", entity: "Pharmacy", entityId: ctx.pharmacyId, after: { logoFileId: logo.id, logoIconFileId: icon.id } });
    return { logoFileId: logo.id, logoIconFileId: icon.id };
  });
}

export async function removeLogo(ctx: DbContext & AuditContext) {
  return runInTx(ctx, async (tx) => {
    await tx.pharmacy.update({ where: { id: ctx.pharmacyId }, data: { logoFileId: null, logoIconFileId: null } });
    await audit(tx, ctx, { action: "pharmacy.logo.remove", entity: "Pharmacy", entityId: ctx.pharmacyId });
    return { ok: true };
  });
}
