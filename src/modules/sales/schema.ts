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
  note: optText,
});

export const cancelSchema = z.object({ reason: z.string().trim().min(3, "Please give a reason").max(300) });
