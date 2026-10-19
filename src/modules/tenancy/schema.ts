import { z } from "zod";
import { FEATURE_KEYS } from "@/modules/platform";

/** URL name of a pharmacy, used in /p/<slug>/login. */
export const RESERVED_SLUGS = ["platform", "api", "login", "admin", "www", "app", "static", "support", "invite", "reset", "account", "p"];
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3 to 40 letters, digits or dashes, not starting or ending with a dash")
  .refine((s) => !RESERVED_SLUGS.includes(s), "This name is reserved");

const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export { usernameSchema } from "@/modules/identity";
import { usernameSchema } from "@/modules/identity";

export const pharmacyProfileSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  legalName: optText(160),
  address: z.string().trim().max(250).default(""),
  city: optText(80),
  phone: z.string().trim().max(50).default(""),
  whatsapp: optText(50),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal("").transform(() => null)),
  licenseNumber: optText(80),
  taxNumber: optText(80),
});

export const pharmacyPlanSchema = z.object({
  plan: z.string().trim().min(1).max(40).default("STANDARD"),
  maxUsers: z.coerce.number().int().min(1).max(500).default(10),
  ocrMonthlyLimit: z.coerce.number().int().min(0).max(100000).default(300),
  subscriptionEndsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
});

export const createPharmacySchema = z.object({
  pharmacy: pharmacyProfileSchema.extend({ slug: slugSchema }),
  plan: pharmacyPlanSchema,
  features: z.array(z.enum(FEATURE_KEYS as [string, ...string[]])).default([]),
  admin: z.object({
    name: z.string().trim().min(2, "Name is required").max(100),
    username: usernameSchema,
    email: z.string().trim().toLowerCase().email("A valid email is required").max(120),
  }),
  credentials: z.enum(["invite", "password"]),
});

export const statusChangeSchema = z.object({
  status: z.enum(["ACTIVE", "GRACE", "SUSPENDED", "DEACTIVATED"]),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

export const featureChangeSchema = z.object({ key: z.enum(FEATURE_KEYS as [string, ...string[]]), enabled: z.boolean() });

export type CreatePharmacyInput = z.infer<typeof createPharmacySchema>;
