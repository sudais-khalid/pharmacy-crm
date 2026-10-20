import { Prisma } from "@prisma/client";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { todayStr } from "@/lib/dates";
import { D, ZERO } from "@/lib/money";
import type { ServiceContext } from "@/modules/identity";
import { audit, emit, nextNumber } from "@/modules/platform";

/**
 * Supplier returns (roadmap 7.9; data model, section 4.4): stock handed back to a supplier, usually near
 * expiry. Each line leaves its batch with a SUPPLIER_RETURN movement at the batch's cost, and the total
 * is credited to the supplier's account (it lowers what the pharmacy owes).
 */
export type SupplierReturnInput = { supplierId: string; items: { batchId: string; quantity: number }[]; reason: string };

export async function createSupplierReturn(ctx: ServiceContext, input: SupplierReturnInput) {
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    const wanted = new Map<string, number>();
    for (const i of input.items) if (i.quantity > 0) wanted.set(i.batchId, (wanted.get(i.batchId) ?? 0) + i.quantity);
    if (!wanted.size) throw new AppError(400, "Choose at least one batch to return.");
    const ids = [...wanted.keys()].sort();
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Batch" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    if (locked.length !== ids.length) throw new AppError(404, "Batch not found.");
    const batches = await tx.batch.findMany({ where: { id: { in: ids } }, include: { medicine: { select: { name: true } } } });

    const lines = batches.map((b) => {
      const quantity = wanted.get(b.id)!;
      if (quantity > b.quantity) throw new AppError(409, `Only ${b.quantity} of ${b.medicine.name} batch ${b.batchNumber} are in stock.`);
      return { batch: b, quantity, unitCost: D(b.purchasePrice), lineTotal: D(b.purchasePrice).mul(quantity).toDecimalPlaces(2) };
    });
    const total = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
    const n = await nextNumber(tx, "SUPPLIER_RETURN");
    const number = `RTS-${todayStr().replace(/-/g, "")}-${String(n).padStart(5, "0")}`;
    const ret = await tx.supplierReturn.create({
      data: {
        number, supplierId: supplier.id, userId: ctx.actor.id, total, reason: input.reason,
        items: { create: lines.map((l) => ({ batchId: l.batch.id, medicineId: l.batch.medicineId, quantity: l.quantity, unitCost: l.unitCost, lineTotal: l.lineTotal })) },
      },
    });
    for (const l of lines) {
      const left = l.batch.quantity - l.quantity;
      // what is left of a batch set aside for this return goes back on sale only by choice; an empty one is cleared
      await tx.batch.update({ where: { id: l.batch.id }, data: { quantity: left, ...(left === 0 ? { setAsideAt: null, setAsideNote: null } : {}) } });
      await tx.stockMovement.create({
        data: { medicineId: l.batch.medicineId, batchId: l.batch.id, type: "SUPPLIER_RETURN", quantity: -l.quantity, balanceAfter: left, reference: number, note: `Returned to ${supplier.name}: ${input.reason}`, userId: ctx.actor.id },
      });
    }
    if (total.gt(0)) {
      await tx.supplierLedger.create({ data: { supplierId: supplier.id, kind: "RETURN", credit: total, description: `Return ${number}`, supplierReturnId: ret.id, userId: ctx.actor.id } });
    }
    await audit(tx, ctx, {
      action: "supplier.return", entity: "Supplier", entityId: supplier.id,
      after: { number, total, reason: input.reason, lines: lines.map((l) => ({ medicine: l.batch.medicine.name, batch: l.batch.batchNumber, quantity: l.quantity })) },
    });
    await emit(tx, "SupplierReturned", { returnId: ret.id, number, supplierId: supplier.id, medicineIds: [...new Set(lines.map((l) => l.batch.medicineId))] });
    return ret;
  });
}

export async function getSupplierReturn(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const r = await tx.supplierReturn.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true, phone: true, address: true } }, user: { select: { name: true } },
        items: { include: { medicine: { select: { name: true, unit: true } }, batch: { select: { batchNumber: true, expiryDate: true } } } },
      },
    });
    if (!r) throw new AppError(404, "Return not found.");
    return r;
  });
}

export async function listSupplierReturns(ctx: ServiceContext, filter: { supplierId?: string; page?: number }) {
  const page = Math.max(1, filter.page ?? 1);
  const where: Prisma.SupplierReturnWhereInput = filter.supplierId ? { supplierId: filter.supplierId } : {};
  return runInTx(ctx, async (tx) => {
    const [total, items] = await Promise.all([
      tx.supplierReturn.count({ where }),
      tx.supplierReturn.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25, include: { supplier: { select: { name: true } }, user: { select: { name: true } }, _count: { select: { items: true } } } }),
    ]);
    return { total, page, pageSize: 25, items };
  });
}
