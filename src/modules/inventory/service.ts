import { MovementType } from "@prisma/client";
import { runInTx, dbOf, type DbContext } from "@/lib/db";
import type { ServiceContext } from "@/modules/identity";
import { AppError } from "@/lib/errors";
import { todayStr, dateOnly } from "@/lib/dates";

/** Sellable stock (non-expired batches) per medicine id. */
export async function sellableStock(ctx: DbContext, medicineIds: string[]) {
  if (!medicineIds.length) return new Map<string, number>();
  const rows = await dbOf(ctx).batch.groupBy({
    by: ["medicineId"],
    where: { medicineId: { in: medicineIds }, expiryDate: { gte: dateOnly(todayStr()) } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.medicineId, r._sum.quantity ?? 0]));
}

export type AdjustInput = { batchId: string; kind: "ADD" | "REMOVE" | "DAMAGE" | "EXPIRY"; quantity: number; note: string };

/** Manual stock change. Always writes a stock movement and can never push a batch below zero. */
export async function adjustStock(ctx: ServiceContext, input: AdjustInput) {
  const userId = ctx.actor.id;
  return runInTx(ctx, async (tx) => {
    const batch = await tx.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new AppError(404, "Batch not found.");
    const delta = input.kind === "ADD" ? input.quantity : -input.quantity;
    let newQty: number;
    if (delta < 0) {
      const res = await tx.batch.updateMany({
        where: { id: batch.id, quantity: { gte: -delta } },
        data: { quantity: { decrement: -delta } },
      });
      if (res.count === 0) throw new AppError(409, `Only ${batch.quantity} unit(s) are in this batch; cannot remove ${-delta}.`);
      newQty = batch.quantity + delta;
    } else {
      await tx.batch.update({ where: { id: batch.id }, data: { quantity: { increment: delta } } });
      newQty = batch.quantity + delta;
    }
    const type: MovementType = input.kind === "ADD" || input.kind === "REMOVE" ? "ADJUSTMENT" : input.kind;
    await tx.stockMovement.create({
      data: { medicineId: batch.medicineId, batchId: batch.id, type, quantity: delta, balanceAfter: newQty, note: input.note, userId },
    });
    return { batchId: batch.id, quantity: newQty };
  });
}
