import { z } from "zod";
import { money, optText, dateStr } from "@/lib/validation";

export const medicineSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  genericName: optText,
  categoryId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  barcode: z.string().trim().max(64).optional().nullable().transform((v) => (v ? v : null)),
  sku: z.string().trim().max(64).optional().nullable().transform((v) => (v ? v : null)),
  unit: z.string().trim().min(1).max(30).default("Pack"),
  purchasePrice: money.default(0),
  salePrice: money.default(0),
  minStock: z.coerce.number().int().min(0).default(10),
  prescriptionRequired: z.boolean().default(false),
  description: optText,
  active: z.boolean().default(true),
  // optional opening stock (create only)
  opening: z
    .object({
      batchNumber: z.string().trim().min(1, "Batch number is required"),
      expiryDate: dateStr,
      quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
    })
    .optional()
    .nullable(),
});

export const categorySchema = z.object({ name: z.string().trim().min(1).max(80) });
