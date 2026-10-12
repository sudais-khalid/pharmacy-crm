import { runInTx } from "@/lib/db";
import type { ServiceContext } from "@/modules/identity";
import { audit, emit } from "@/modules/platform";
import { AppError } from "@/lib/errors";
import { dateOnly } from "@/lib/dates";

export type MedicineInput = {
  name: string; genericName: string | null; categoryId?: string | null; barcode: string | null; sku: string | null;
  unit: string; purchasePrice: number; salePrice: number; minStock: number; prescriptionRequired: boolean;
  description: string | null; active: boolean;
  opening?: { batchNumber: string; expiryDate: string; quantity: number } | null;
};

export async function createMedicine(ctx: ServiceContext, input: MedicineInput) {
  const { opening, ...data } = input;
  const userId = ctx.actor.id;
  return runInTx(ctx, async (tx) => {
    const med = await tx.medicine.create({ data: { ...data, categoryId: data.categoryId || null } });
    if (opening) {
      const batch = await tx.batch.create({
        data: {
          medicineId: med.id, batchNumber: opening.batchNumber, expiryDate: dateOnly(opening.expiryDate),
          quantity: opening.quantity, purchasePrice: input.purchasePrice, salePrice: input.salePrice,
        },
      });
      await tx.stockMovement.create({
        data: { medicineId: med.id, batchId: batch.id, type: "OPENING", quantity: opening.quantity, balanceAfter: opening.quantity, note: "Opening stock", userId },
      });
    }
    await audit(tx, ctx, { action: "medicine.create", entity: "Medicine", entityId: med.id, after: { ...data, opening: opening ?? null } });
    await emit(tx, "MedicineCreated", { medicineId: med.id });
    return med;
  });
}

const PRICE_FIELDS = ["purchasePrice", "salePrice"];

/** Updates a medicine's details. Opening stock is ignored (it only applies on create). */
export async function updateMedicine(ctx: ServiceContext, id: string, input: MedicineInput) {
  const { opening: _opening, ...data } = input;
  return runInTx(ctx, async (tx) => {
    const before = await tx.medicine.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "Medicine not found.");
    const after = await tx.medicine.update({ where: { id }, data: { ...data, categoryId: data.categoryId || null } });

    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    for (const k of Object.keys(data)) {
      const a = (before as Record<string, unknown>)[k];
      const b = (after as Record<string, unknown>)[k];
      if (String(a ?? "") !== String(b ?? "")) {
        from[k] = a;
        to[k] = b;
      }
    }
    if (Object.keys(to).length) {
      const priceChanged = PRICE_FIELDS.some((f) => f in to);
      await audit(tx, ctx, {
        action: priceChanged ? "medicine.price.update" : "medicine.update",
        entity: "Medicine", entityId: id, before: from, after: to,
      });
    }
    return after;
  });
}

/** Deletes if never used in any transaction; otherwise archives (soft delete). */
export async function deleteOrArchiveMedicine(ctx: ServiceContext, id: string): Promise<{ deleted: boolean; archived: boolean }> {
  return runInTx(ctx, async (tx) => {
    const med = await tx.medicine.findUnique({ where: { id } });
    if (!med) throw new AppError(404, "Medicine not found.");
    // sequential: a transaction runs on one connection
    const sales = await tx.saleItem.count({ where: { medicineId: id } });
    const purchases = await tx.purchaseItem.count({ where: { medicineId: id } });
    const movements = await tx.stockMovement.count({ where: { medicineId: id } });
    if (sales + purchases + movements > 0) {
      await tx.medicine.update({ where: { id }, data: { active: false } });
      await audit(tx, ctx, { action: "medicine.archive", entity: "Medicine", entityId: id, before: { active: med.active }, after: { active: false } });
      return { deleted: false, archived: true };
    }
    await tx.medicine.delete({ where: { id } });
    await audit(tx, ctx, { action: "medicine.delete", entity: "Medicine", entityId: id, before: { name: med.name, barcode: med.barcode } });
    return { deleted: true, archived: false };
  });
}
