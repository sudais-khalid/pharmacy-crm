import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { dateOnly } from "@/lib/dates";

type MedicineInput = {
  name: string; genericName: string | null; categoryId?: string | null; barcode: string | null; sku: string | null;
  unit: string; purchasePrice: number; salePrice: number; minStock: number; prescriptionRequired: boolean;
  description: string | null; active: boolean;
  opening?: { batchNumber: string; expiryDate: string; quantity: number } | null;
};

export async function createMedicine(input: MedicineInput, userId: string) {
  const { opening, ...data } = input;
  return prisma.$transaction(async (tx) => {
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
export async function deleteOrArchiveMedicine(id: string): Promise<{ deleted: boolean; archived: boolean }> {
  const med = await prisma.medicine.findUnique({ where: { id } });
  if (!med) throw new AppError(404, "Medicine not found.");
  const [sales, purchases, movements] = await Promise.all([
    prisma.saleItem.count({ where: { medicineId: id } }),
    prisma.purchaseItem.count({ where: { medicineId: id } }),
    prisma.stockMovement.count({ where: { medicineId: id } }),
  ]);
  if (sales + purchases + movements > 0) {
    await prisma.medicine.update({ where: { id }, data: { active: false } });
    return { deleted: false, archived: true };
  }
  await prisma.medicine.delete({ where: { id } });
  return { deleted: true, archived: false };
}
