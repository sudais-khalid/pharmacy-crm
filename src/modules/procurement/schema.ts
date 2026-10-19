import { z } from "zod";
import { money, optText, dateStr } from "@/lib/validation";

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  contactPerson: optText,
  phone: optText,
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal("").transform(() => null)),
  address: optText,
  paymentTerms: optText,
  notes: optText,
  active: z.boolean().default(true),
});

export const purchaseSchema = z.object({
  supplierId: z.string().uuid("Select a supplier"),
  supplierInvoice: optText,
  purchaseDate: dateStr,
  items: z
    .array(
      z.object({
        medicineId: z.string().uuid("Select a medicine"),
        batchNumber: z.string().trim().min(1, "Batch number is required"),
        expiryDate: dateStr,
        quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
        purchasePrice: money,
        salePrice: money,
        bonusQty: z.coerce.number().int().min(0).max(1_000_000).default(0),
        discountPercent: z.coerce.number().min(0).max(100).default(0),
        taxAmount: money.default(0),
      }),
    )
    .min(1, "Add at least one item"),
  discount: money.default(0),
  paid: money.default(0),
  paymentMethod: z.enum(["CASH", "CARD"]).default("CASH"),
  note: optText,
});
