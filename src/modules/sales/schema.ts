import { z } from "zod";
import { money, optText } from "@/lib/validation";

export const saleSchema = z.object({
  customerId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  items: z
    .array(z.object({ medicineId: z.string().uuid(), quantity: z.coerce.number().int().min(1, "Quantity must be at least 1") }))
    .min(1, "Add at least one medicine"),
  discountType: z.enum(["AMOUNT", "PERCENT"]).default("AMOUNT"),
  discountValue: money.default(0),
  paymentMethod: z.enum(["CASH", "CARD", "CREDIT"]),
  amountPaid: z.coerce.number().min(0).optional(),
  cashTendered: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  note: optText,
  customerName: z.string().trim().max(100).optional().nullable(),
  customerPhone: z.string().trim().max(30).regex(/^[0-9+\-\s()]*$/, "Use digits only").optional().nullable(),
});

export const returnSchema = z.object({
  saleId: z.string().uuid(),
  items: z.array(z.object({ saleItemId: z.string().uuid(), quantity: z.coerce.number().int().min(0).max(100_000), restock: z.boolean().default(true) })).min(1, "Choose at least one item to return").max(200),
  refundMethod: z.enum(["CASH", "CARD", "CREDIT"]),
  reason: z.string().trim().min(3, "Please give a reason").max(300),
});

export const openSessionSchema = z.object({ openingFloat: z.coerce.number().min(0).max(10_000_000) });
export const cashMovementSchema = z.object({ type: z.enum(["PAY_IN", "PAY_OUT"]), amount: z.coerce.number().positive("Enter an amount").max(10_000_000), reason: z.string().trim().min(3, "Please give a reason").max(200) });
export const closeSessionSchema = z.object({ countedCash: z.coerce.number().min(0).max(10_000_000), note: z.string().trim().max(500).optional().nullable() });

export const cancelSchema = z.object({ reason: z.string().trim().min(3, "Please give a reason").max(300) });
