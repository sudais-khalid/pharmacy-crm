import { z } from "zod";

/** Operational settings; the profile and branding have their own schema (branding.ts). */
export const settingsSchema = z.object({
  expiryWarningDays: z.coerce.number().int().min(1).max(730),
  currency: z.string().trim().min(1).max(8),
  ocrProvider: z.enum(["LOCAL", "CLOUD"]).optional(),
});
