import { runInTx } from "@/lib/db";
import type { ServiceContext } from "@/modules/identity";
import { AppError } from "@/lib/errors";
import { dateOnly } from "@/lib/dates";

type MedicineInput = {
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
    return med;
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
      return { deleted: false, archived: true };
    }
    await tx.medicine.delete({ where: { id } });
    return { deleted: true, archived: false };
  });
}
