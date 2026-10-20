import { Prisma } from "@prisma/client";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { ServiceContext } from "@/modules/identity";
import { audit, emit } from "@/modules/platform";

/**
 * Expiry handling (roadmap 6.4). Batches can be written off whole (an EXPIRY movement for what is left),
 * or set aside for return to the supplier: they stay in stock, are not sold, and appear on the supplier
 * return list until written off, returned or put back.
 */

async function lockBatches(tx: Prisma.TransactionClient, ids: string[]) {
  // a stable lock order, so two people writing off overlapping lists cannot deadlock
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Batch" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  if (rows.length !== new Set(ids).size) throw new AppError(404, "Batch not found.");
  return tx.batch.findMany({ where: { id: { in: ids } }, include: { medicine: { select: { name: true } } } });
}

export async function writeOffBatches(ctx: ServiceContext, input: { batchIds: string[]; note: string }) {
  return runInTx(ctx, async (tx) => {
    const batches = await lockBatches(tx, input.batchIds);
    let units = 0;
    for (const b of batches.filter((x) => x.quantity > 0)) {
      await tx.batch.update({ where: { id: b.id }, data: { quantity: 0, setAsideAt: null } });
      await tx.stockMovement.create({ data: { medicineId: b.medicineId, batchId: b.id, type: "EXPIRY", quantity: -b.quantity, balanceAfter: 0, note: input.note, userId: ctx.actor.id } });
      await audit(tx, ctx, { action: "stock.writeOff", entity: "Batch", entityId: b.id, before: { quantity: b.quantity }, after: { quantity: 0, note: input.note } });
      await emit(tx, "StockAdjusted", { batchId: b.id, medicineId: b.medicineId, quantity: -b.quantity, type: "EXPIRY" });
      units += b.quantity;
    }
    return { batches: batches.filter((x) => x.quantity > 0).length, units };
  });
}

export async function setAsideBatches(ctx: ServiceContext, input: { batchIds: string[]; aside: boolean; note?: string | null }) {
  return runInTx(ctx, async (tx) => {
    const batches = await lockBatches(tx, input.batchIds);
    const changing = batches.filter((b) => Boolean(b.setAsideAt) !== input.aside && (b.quantity > 0 || !input.aside));
    for (const b of changing) {
      await tx.batch.update({ where: { id: b.id }, data: input.aside ? { setAsideAt: new Date(), setAsideNote: input.note?.trim() || null } : { setAsideAt: null, setAsideNote: null } });
      await audit(tx, ctx, {
        action: input.aside ? "stock.setAside" : "stock.putBack", entity: "Batch", entityId: b.id,
        before: { setAside: !input.aside }, after: { setAside: input.aside, note: input.note ?? null },
      });
    }
    return { changed: changing.length };
  });
}

/** Batches set aside for the supplier, with the supplier and cost of the purchase that brought each in. */
export async function supplierReturnList(ctx: ServiceContext) {
  return runInTx(ctx, async (tx) => {
    const batches = await tx.batch.findMany({
      where: { setAsideAt: { not: null }, quantity: { gt: 0 } },
      orderBy: [{ setAsideAt: "asc" }],
      include: {
        medicine: { select: { id: true, name: true, unit: true } },
        purchaseItems: { orderBy: { id: "desc" }, take: 1, select: { purchase: { select: { number: true, purchaseDate: true, supplierInvoice: true, supplier: { select: { id: true, name: true } } } } } },
      },
    });
    return batches.map(({ purchaseItems, ...b }) => ({ ...b, source: purchaseItems[0]?.purchase ?? null }));
  });
}
