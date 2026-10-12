import { z } from "zod";

const money = z.coerce.number().finite().min(0, "Must be 0 or more").max(99999999, "Too large");
const optText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

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

export const adjustSchema = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["ADD", "REMOVE", "DAMAGE", "EXPIRY"]),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  note: z.string().trim().min(3, "Please give a reason").max(300),
});

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: optText,
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal("").transform(() => null)),
  address: optText,
  creditLimit: money.default(0),
  notes: optText,
  active: z.boolean().default(true),
});

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

export const paymentSchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than 0").max(99999999),
  method: z.enum(["CASH", "CARD"]).default("CASH"),
  note: optText,
});

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
      }),
    )
    .min(1, "Add at least one item"),
  discount: money.default(0),
  paid: money.default(0),
  paymentMethod: z.enum(["CASH", "CARD"]).default("CASH"),
  note: optText,
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  role: z.enum(["ADMIN", "PHARMACIST", "CASHIER"]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["ADMIN", "PHARMACIST", "CASHIER"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(100).optional().or(z.literal("").transform(() => undefined)),
});

export const settingsSchema = z.object({
  pharmacyName: z.string().trim().min(1).max(120),
  address: z.string().trim().max(250).default(""),
  phone: z.string().trim().max(50).default(""),
  email: z.string().trim().max(120).default(""),
  invoiceFooter: z.string().trim().max(250).default(""),
  expiryWarningDays: z.coerce.number().int().min(1).max(730),
  currency: z.string().trim().min(1).max(8),
});
