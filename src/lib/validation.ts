import { z } from "zod";

/** Shared field rules. Domain schemas live in each module's schema.ts. */
export const money = z.coerce.number().finite().min(0, "Must be 0 or more").max(99999999, "Too large");
export const optText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Payment against a customer or supplier ledger. */
export const paymentSchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than 0").max(99999999),
  method: z.enum(["CASH", "CARD"]).default("CASH"),
  note: optText,
});

export type PaymentInput = { amount: number; method: "CASH" | "CARD"; note?: string | null };
