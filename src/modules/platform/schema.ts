import { z } from "zod";

export const settingsSchema = z.object({
  pharmacyName: z.string().trim().min(1).max(120),
  address: z.string().trim().max(250).default(""),
  phone: z.string().trim().max(50).default(""),
  email: z.string().trim().max(120).default(""),
  invoiceFooter: z.string().trim().max(250).default(""),
  expiryWarningDays: z.coerce.number().int().min(1).max(730),
  currency: z.string().trim().min(1).max(8),
});
