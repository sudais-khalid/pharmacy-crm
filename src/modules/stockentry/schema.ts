import { z } from "zod";

/**
 * Stock entry drafts (docs/plan/05-roadmap.md, tasks 4.2 to 4.4). A draft is saved whole, as often as the
 * grid likes (autosave), and may be incomplete; the rules that block posting are checked by validate().
 */
const optNum = (schema: z.ZodNumber) => z.union([schema, z.null()]).optional().transform((v) => (v === undefined ? null : v));
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-04-30");

export const intakeLineSchema = z.object({
  rawText: optText(500),
  name: optText(200),
  medicineId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  batchNumber: optText(60),
  expiryDate: dateStr.optional().nullable().transform((v) => v ?? null),
  quantity: optNum(z.number().int().min(-1_000_000).max(1_000_000)),
  bonusQty: optNum(z.number().int().min(0).max(1_000_000)),
  rate: optNum(z.number().min(0).max(10_000_000)),
  discountPercent: optNum(z.number().min(0).max(100)),
  taxAmount: optNum(z.number().min(0).max(10_000_000)),
  amount: optNum(z.number().min(0).max(100_000_000)),
  salePrice: optNum(z.number().min(0).max(10_000_000)),
  matchMethod: z.enum(["BARCODE", "SUPPLIER_CODE", "ALIAS", "TRIGRAM", "MANUAL"]).optional().nullable().transform((v) => v ?? null),
  confidence: optNum(z.number().min(0).max(1)),
  boxes: z.unknown().optional(),
  ignored: z.boolean().default(false),
});
export type IntakeLineInput = z.infer<typeof intakeLineSchema>;

export const intakeDraftSchema = z.object({
  supplierId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  purchaseOrderId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  supplierInvoice: optText(60),
  billDate: dateStr.optional().nullable().transform((v) => v ?? null),
  billTotal: optNum(z.number().min(0).max(100_000_000)),
  billDiscount: z.number().min(0).max(100_000_000).default(0),
  paid: z.number().min(0).max(100_000_000).default(0),
  paymentMethod: z.enum(["CASH", "CARD"]).optional().nullable().transform((v) => v ?? null),
  note: optText(500),
  lines: z.array(intakeLineSchema).max(2000),
});
export type IntakeDraftInput = z.infer<typeof intakeDraftSchema>;

export const newIntakeSchema = z.object({
  kind: z.enum(["PURCHASE_BILL", "STOCK_LIST"]),
  source: z.enum(["MANUAL", "IMPORT"]).default("MANUAL"),
});
