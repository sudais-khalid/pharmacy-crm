import { Prisma } from "@prisma/client";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { todayStr } from "@/lib/dates";
import { D, ZERO } from "@/lib/money";
import { can, type ServiceContext } from "@/modules/identity";
import { audit, emit, getSettings, nextNumber } from "@/modules/platform";
import { sessionForPayment } from "./cash";

/**
 * Customer returns (roadmap 5.6; data model, section 3.3). Each line points at the exact sale line, so the
 * batch and the price are known. The refund for a line is its share of what the customer actually paid:
 * unit price x quantity, less the invoice discount in proportion.
 *
 * Restockable items go back to their original batch (SALE_RETURN movement); damaged ones are taken in and
 * written off at once (SALE_RETURN then DAMAGE), so the stock card shows both. A refund by credit note
 * lowers the customer's balance; a cash or card refund cannot exceed what was paid on the invoice.
 */

export type ReturnInput = {
  saleId: string;
  items: { saleItemId: string; quantity: number; restock: boolean }[];
  refundMethod: "CASH" | "CARD" | "CREDIT";
  reason: string;
};

export async function createReturn(ctx: ServiceContext, input: ReturnInput) {
  return runInTx(ctx, async (tx) => {
    const settings = await getSettings(tx, ctx.pharmacyId);
    if (!settings.returnsOn) throw new AppError(409, "Returns are switched off for this pharmacy.");
    // the sale row lock serialises returns of one invoice, so two at once cannot over-return a line
    const [locked] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Sale" WHERE id = ${input.saleId} FOR UPDATE`);
    if (!locked) throw new AppError(404, "Invoice not found.");
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: input.saleId },
      include: { items: { include: { medicine: { select: { name: true } }, returns: { select: { quantity: true } } } }, returns: { select: { refundMethod: true, total: true } } },
    });
    if (sale.status !== "COMPLETED") throw new AppError(409, "A cancelled invoice cannot take returns.");
    if (sale.userId !== ctx.actor.id && !can(ctx.actor, "sales.viewAll")) throw new AppError(404, "Invoice not found.");

    const wanted = new Map<string, { quantity: number; restock: boolean }>();
    for (const l of input.items) {
      if (l.quantity <= 0) continue;
      const prev = wanted.get(l.saleItemId);
      if (prev && prev.restock !== l.restock) throw new AppError(400, "Return a line either to stock or as damaged, not both at once.");
      wanted.set(l.saleItemId, { quantity: (prev?.quantity ?? 0) + l.quantity, restock: l.restock });
    }
    if (!wanted.size) throw new AppError(400, "Choose at least one item to return.");

    // the invoice discount is shared across lines in proportion
    const factor = D(sale.subtotal).gt(0) ? D(sale.total).div(sale.subtotal) : ZERO;
    const lines = [];
    for (const [saleItemId, w] of wanted) {
      const item = sale.items.find((i) => i.id === saleItemId);
      if (!item) throw new AppError(400, "That item is not on this invoice.");
      const returned = item.returns.reduce((n, r) => n + r.quantity, 0);
      if (w.quantity > item.quantity - returned) {
        throw new AppError(409, `Only ${item.quantity - returned} of ${item.medicine.name} can still be returned (sold ${item.quantity}, returned ${returned}).`);
      }
      lines.push({ item, quantity: w.quantity, restock: w.restock, lineTotal: D(item.unitPrice).mul(w.quantity).mul(factor).toDecimalPlaces(2) });
    }
    const total = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);

    if (input.refundMethod === "CREDIT" && !sale.customerId) throw new AppError(400, "A credit note needs a customer account. Refund in cash or by card instead.");
    if (input.refundMethod !== "CREDIT") {
      const refundedAlready = sale.returns.filter((r) => r.refundMethod !== "CREDIT").reduce((s, r) => s.plus(r.total), ZERO);
      const refundable = D(sale.amountPaid).minus(refundedAlready);
      if (total.gt(refundable)) {
        throw new AppError(409, `Only ${refundable.toFixed(2)} was paid on this invoice and not yet refunded. Refund the rest as a credit note to the customer's account.`);
      }
    }
    const cashSessionId = await sessionForPayment(tx, ctx, input.refundMethod === "CASH");

    const n = await nextNumber(tx, "RETURN");
    const number = `RET-${todayStr().replace(/-/g, "")}-${String(n).padStart(5, "0")}`;
    const ret = await tx.saleReturn.create({
      data: {
        number, saleId: sale.id, userId: ctx.actor.id, refundMethod: input.refundMethod, total, reason: input.reason, cashSessionId,
        items: {
          create: lines.map((l) => ({
            saleItemId: l.item.id, batchId: l.item.batchId, medicineId: l.item.medicineId, quantity: l.quantity,
            unitPrice: l.item.unitPrice, costPrice: l.item.costPrice, restock: l.restock, lineTotal: l.lineTotal,
          })),
        },
      },
    });

    for (const l of lines) {
      const b = await tx.batch.update({ where: { id: l.item.batchId }, data: { quantity: { increment: l.quantity } } });
      await tx.stockMovement.create({
        data: { medicineId: l.item.medicineId, batchId: l.item.batchId, type: "SALE_RETURN", quantity: l.quantity, balanceAfter: b.quantity, reference: number, note: input.reason, userId: ctx.actor.id },
      });
      if (!l.restock) {
        const after = await tx.batch.update({ where: { id: l.item.batchId }, data: { quantity: { decrement: l.quantity } } });
        await tx.stockMovement.create({
          data: { medicineId: l.item.medicineId, batchId: l.item.batchId, type: "DAMAGE", quantity: -l.quantity, balanceAfter: after.quantity, reference: number, note: `Returned damaged: ${input.reason}`, userId: ctx.actor.id },
        });
      }
    }

    if (sale.customerId) {
      await tx.customerLedger.create({ data: { customerId: sale.customerId, kind: "RETURN", credit: total, description: `Return ${number} on ${sale.invoiceNo}`, saleId: sale.id, returnId: ret.id, userId: ctx.actor.id } });
      if (input.refundMethod !== "CREDIT") {
        // the money handed back: the account ends where it was before the payment
        await tx.customerLedger.create({ data: { customerId: sale.customerId, kind: "RETURN", debit: total, description: `Refund paid for ${number}`, saleId: sale.id, returnId: ret.id, method: input.refundMethod, userId: ctx.actor.id } });
      }
    }

    await audit(tx, ctx, {
      action: "sale.return", entity: "Sale", entityId: sale.id,
      after: { number, total, refundMethod: input.refundMethod, reason: input.reason, lines: lines.map((l) => ({ medicine: l.item.medicine.name, quantity: l.quantity, restock: l.restock })) },
    });
    await emit(tx, "SaleReturned", { saleId: sale.id, returnId: ret.id, number, medicineIds: [...new Set(lines.map((l) => l.item.medicineId))] });
    return ret;
  });
}

export const returnInclude = {
  sale: { select: { id: true, invoiceNo: true, createdAt: true, customerName: true, customerPhone: true, customer: { select: { name: true, phone: true } } } },
  user: { select: { name: true } },
  items: { include: { saleItem: { select: { medicine: { select: { name: true, unit: true } } } }, batch: { select: { batchNumber: true, expiryDate: true } } }, orderBy: { id: "asc" } },
} satisfies Prisma.SaleReturnInclude;

export async function getReturn(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const r = await tx.saleReturn.findUnique({ where: { id }, include: { ...returnInclude, sale: { select: { ...returnInclude.sale.select, userId: true } } } });
    if (!r || (r.sale.userId !== ctx.actor.id && r.userId !== ctx.actor.id && !can(ctx.actor, "sales.viewAll"))) throw new AppError(404, "Return not found.");
    return r;
  });
}

export async function listReturns(ctx: ServiceContext, filter: { q?: string; page?: number }) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = 25;
  const where: Prisma.SaleReturnWhereInput = {
    ...(can(ctx.actor, "sales.viewAll") ? {} : { userId: ctx.actor.id }),
    ...(filter.q ? { OR: [{ number: { contains: filter.q, mode: "insensitive" } }, { sale: { invoiceNo: { contains: filter.q, mode: "insensitive" } } }] } : {}),
  };
  return runInTx(ctx, async (tx) => {
    const [total, items] = await Promise.all([
      tx.saleReturn.count({ where }),
      tx.saleReturn.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { sale: { select: { invoiceNo: true, customerName: true, customer: { select: { name: true } } } }, user: { select: { name: true } }, _count: { select: { items: true } } } }),
    ]);
    return { total, page, pageSize, items };
  });
}
