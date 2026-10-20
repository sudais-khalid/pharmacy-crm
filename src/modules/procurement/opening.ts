import { z } from "zod";
import { runInTx } from "@/lib/db";
import type { Tx } from "@/lib/prisma";
import { can, type ServiceContext } from "@/modules/identity";
import { audit } from "@/modules/platform";
import { D } from "@/lib/money";
import { AppError } from "@/lib/errors";
import { money, optText } from "@/lib/validation";
import { supplierSchema } from "./schema";

/**
 * Suppliers with what the pharmacy already owed them before using the app (roadmap 9.9): one ADJUSTMENT
 * line on the supplier's account, paid off with supplier payments like any bill.
 */
export const supplierWithOpeningSchema = supplierSchema.extend({ openingBalance: money.default(0) });
export const supplierImportSchema = z.object({
  rows: z.array(z.object({ name: z.string().trim().min(1, "Name is required").max(120), phone: optText, openingBalance: money.default(0) })).min(1).max(1000),
});
export type SupplierWithOpening = z.infer<typeof supplierWithOpeningSchema>;
export const SUPPLIER_OPENING_NOTE = "Opening balance (owed before using the app)";

async function create(tx: Tx, ctx: ServiceContext, input: SupplierWithOpening) {
  const { openingBalance, ...data } = input;
  const supplier = await tx.supplier.create({ data });
  const opening = D(openingBalance).toDecimalPlaces(2);
  // a balance from before the app is a setup figure, not something the counter enters
  if (opening.gt(0) && !can(ctx.actor, "settings.manage")) throw new AppError(403, "Only the Pharmacy Admin can enter an opening balance.");
  if (opening.gt(0)) await tx.supplierLedger.create({ data: { supplierId: supplier.id, kind: "ADJUSTMENT", debit: opening, description: SUPPLIER_OPENING_NOTE, userId: ctx.actor.id } });
  await audit(tx, ctx, { action: "supplier.create", entity: "Supplier", entityId: supplier.id, after: { name: supplier.name, openingBalance: opening } });
  return supplier;
}

export async function createSupplier(ctx: ServiceContext, input: SupplierWithOpening) {
  return runInTx(ctx, (tx) => create(tx, ctx, input));
}

/** Many at once (the setup wizard); a supplier whose name already exists is skipped. */
export async function importSuppliers(ctx: ServiceContext, rows: z.infer<typeof supplierImportSchema>["rows"]) {
  return runInTx(ctx, async (tx) => {
    let created = 0;
    const skipped: string[] = [];
    for (const r of rows) {
      if (await tx.supplier.findFirst({ where: { name: { equals: r.name, mode: "insensitive" } }, select: { id: true } })) { skipped.push(r.name); continue; }
      await create(tx, ctx, supplierWithOpeningSchema.parse(r));
      created++;
    }
    return { created, skipped };
  });
}
