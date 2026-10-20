import { z } from "zod";
import { medicineSchema } from "@/modules/catalog";
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

const optStr = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const qty = z.coerce.number().int().min(1, "Quantity must be at least 1").max(100_000);

export const catalogItemSchema = z.object({
  medicineId: z.string().uuid().optional().nullable(),
  newMedicine: medicineSchema.optional().nullable(),
  supplierCode: optStr(40),
  packSize: optStr(40),
  lastPrice: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  lastBonusRule: z.string().trim().max(20).regex(/^(\d+\s*\+\s*\d+)?$/, "Write a bonus like 10+1").optional().nullable().transform((v) => v || null),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(2),
  preferred: z.boolean().default(false),
}).refine((v) => v.medicineId || v.newMedicine, { message: "Choose a medicine or add a new one", path: ["medicineId"] });

export const catalogImportSchema = z.object({
  rows: z.array(z.object({
    name: z.string().trim().min(1).max(200), supplierCode: optStr(40), barcode: optStr(64),
    lastPrice: z.coerce.number().min(0).max(10_000_000).optional().nullable(), packSize: optStr(40), lastBonusRule: optStr(20),
  })).min(1, "The file has no rows").max(5000),
});

const orderItems = z.array(z.object({ medicineId: z.string().uuid(), orderedQty: qty, expectedPrice: z.coerce.number().min(0).max(10_000_000).optional().nullable() })).min(1, "Add at least one medicine").max(500);
export const orderSchema = z.object({ supplierId: z.string().uuid("Select a supplier"), items: orderItems, expectedDate: dateStr.optional().nullable(), note: optStr(500) });
export const orderUpdateSchema = z.object({ items: orderItems, expectedDate: dateStr.optional().nullable(), note: optStr(500) });
export const endOrderSchema = z.object({ reason: z.string().trim().min(3, "Please give a reason").max(300) });
export const suggestionPicksSchema = z.object({ picks: z.array(z.object({ medicineId: z.string().uuid(), supplierId: z.string().uuid("Choose a supplier"), quantity: qty })).min(1, "Choose at least one medicine").max(1000) });
export const supplierReturnSchema = z.object({
  supplierId: z.string().uuid("Select a supplier"),
  items: z.array(z.object({ batchId: z.string().uuid(), quantity: qty })).min(1, "Choose at least one batch").max(500),
  reason: z.string().trim().min(3, "Please give a reason").max(300),
});
