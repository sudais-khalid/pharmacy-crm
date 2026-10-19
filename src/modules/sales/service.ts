import { Prisma } from "@prisma/client";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { todayStr } from "@/lib/dates";
import { D, ZERO } from "@/lib/money";
import { customerBalance } from "@/modules/customers";
import { can, type ServiceContext } from "@/modules/identity";
import { audit, emit, nextNumber } from "@/modules/platform";

export type SaleInput = {
  customerId?: string | null;
  items: { medicineId: string; quantity: number }[];
  discountType: "AMOUNT" | "PERCENT";
  discountValue: number;
  paymentMethod: "CASH" | "CARD" | "CREDIT";
  amountPaid?: number;
  note?: string | null;
};

type BatchRow = { id: string; batchNumber: string; quantity: number; salePrice: Prisma.Decimal.Value; purchasePrice: Prisma.Decimal.Value };

/**
 * Creates a sale. Everything happens in ONE transaction:
 * FEFO batch allocation (earliest expiry first, expired batches skipped), stock deduction,
 * stock movements and the customer ledger. Any failure rolls the whole sale back.
 */
export async function createSale(ctx: ServiceContext, input: SaleInput, opts: { createdAt?: Date } = {}) {
  const today = todayStr();
  const user = ctx.actor;

  return runInTx(ctx, async (tx) => {
    // merge duplicate lines and lock in a stable order (avoids deadlocks between concurrent sales)
    const wanted = new Map<string, number>();
    for (const l of input.items) wanted.set(l.medicineId, (wanted.get(l.medicineId) ?? 0) + l.quantity);
    const medicineIds = [...wanted.keys()].sort();

    const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : null;
    if (input.customerId && !customer) throw new AppError(404, "Customer not found.");
    if (customer && !customer.active) throw new AppError(409, "This customer account is inactive.");

    const lines: { medicineId: string; batchId: string; batchNumber: string; quantity: number; unitPrice: Prisma.Decimal; costPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; newBalance: number }[] = [];

    for (const medicineId of medicineIds) {
      const qty = wanted.get(medicineId)!;
      const med = await tx.medicine.findUnique({ where: { id: medicineId } });
      if (!med) throw new AppError(404, "Medicine not found.");
      if (!med.active) throw new AppError(409, `${med.name} is archived and cannot be sold.`);

      const batches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
        SELECT id, "batchNumber", quantity, "salePrice", "purchasePrice"
        FROM "Batch"
        WHERE "medicineId" = ${medicineId} AND quantity > 0 AND "expiryDate" >= ${today}::date
        ORDER BY "expiryDate" ASC, "createdAt" ASC
        FOR UPDATE`);

      const available = batches.reduce((s, b) => s + b.quantity, 0);
      if (available < qty) {
        throw new AppError(409, `Insufficient stock for ${med.name}: requested ${qty}, available ${available} (expired batches are excluded).`);
      }
      let remaining = qty;
      for (const b of batches) {
        if (remaining === 0) break;
        const take = Math.min(remaining, b.quantity);
        const unitPrice = D(b.salePrice);
        lines.push({
          medicineId, batchId: b.id, batchNumber: b.batchNumber, quantity: take, unitPrice,
          costPrice: D(b.purchasePrice), lineTotal: unitPrice.mul(take).toDecimalPlaces(2), newBalance: b.quantity - take,
        });
        remaining -= take;
      }
    }

    const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
    let discount = D(input.discountValue);
    if (input.discountType === "PERCENT") {
      if (input.discountValue > 100) throw new AppError(400, "Discount cannot exceed 100%.");
      discount = subtotal.mul(input.discountValue).div(100);
    }
    discount = discount.toDecimalPlaces(2);
    if (discount.gt(subtotal)) throw new AppError(400, "Discount cannot be more than the subtotal.");
    const total = subtotal.minus(discount);

    const paid = D(input.amountPaid ?? (input.paymentMethod === "CREDIT" ? 0 : total.toString())).toDecimalPlaces(2);
    if (paid.lt(0) || paid.gt(total)) throw new AppError(400, "Amount paid must be between 0 and the invoice total.");
    const balance = total.minus(paid);

    if (balance.gt(0)) {
      if (!customer) throw new AppError(400, "Select a customer to sell on credit (udhaar).");
      const current = await customerBalance(tx, customer.id);
      const after = current.plus(balance);
      if (after.gt(customer.creditLimit) && !can(user, "sales.overrideCredit")) {
        throw new AppError(409, `Credit limit exceeded: outstanding would be ${after.toFixed(2)} but the limit is ${D(customer.creditLimit).toFixed(2)}.`);
      }
    }

    const n = await nextNumber(tx, "INVOICE");
    const invoiceNo = `INV-${today.replace(/-/g, "")}-${String(n).padStart(5, "0")}`;

    const sale = await tx.sale.create({
      data: {
        invoiceNo, customerId: customer?.id ?? null, userId: user.id, subtotal, discount, total, amountPaid: paid,
        paymentMethod: input.paymentMethod, note: input.note ?? null, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        items: { create: lines.map((l) => ({ medicineId: l.medicineId, batchId: l.batchId, quantity: l.quantity, unitPrice: l.unitPrice, costPrice: l.costPrice, lineTotal: l.lineTotal })) },
      },
    });

    for (const l of lines) {
      await tx.batch.update({ where: { id: l.batchId }, data: { quantity: { decrement: l.quantity } } });
      await tx.stockMovement.create({
        data: { medicineId: l.medicineId, batchId: l.batchId, type: "SALE", quantity: -l.quantity, balanceAfter: l.newBalance, reference: invoiceNo, userId: user.id, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) },
      });
    }

    if (customer) {
      const at = opts.createdAt ? { createdAt: opts.createdAt } : {};
      await tx.customerLedger.create({ data: { customerId: customer.id, kind: "INVOICE", debit: total, description: `Invoice ${invoiceNo}`, saleId: sale.id, userId: user.id, ...at } });
      if (paid.gt(0)) {
        await tx.customerLedger.create({
          data: { customerId: customer.id, kind: "PAYMENT", credit: paid, description: `Payment on ${invoiceNo}`, saleId: sale.id, method: input.paymentMethod === "CREDIT" ? "CASH" : input.paymentMethod, userId: user.id, ...at },
        });
      }
    }

    await audit(tx, ctx, {
      action: "sale.create", entity: "Sale", entityId: sale.id,
      after: { invoiceNo, total, amountPaid: paid, discount, paymentMethod: input.paymentMethod, customerId: customer?.id ?? null, lines: lines.length },
    });
    await emit(tx, "SaleCompleted", { saleId: sale.id, invoiceNo, medicineIds, customerId: customer?.id ?? null });
    return sale;
  });
}

/** Cancels a completed sale: stock goes back to the exact batches it came from and the ledger is reversed. */
export async function cancelSale(ctx: ServiceContext, saleId: string, reason: string) {
  const userId = ctx.actor.id;
  return runInTx(ctx, async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!sale) throw new AppError(404, "Sale not found.");
    const res = await tx.sale.updateMany({ where: { id: saleId, status: "COMPLETED" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    if (res.count === 0) throw new AppError(409, "This sale is already cancelled.");

    for (const it of sale.items) {
      const b = await tx.batch.update({ where: { id: it.batchId }, data: { quantity: { increment: it.quantity } } });
      await tx.stockMovement.create({
        data: { medicineId: it.medicineId, batchId: it.batchId, type: "SALE_CANCEL", quantity: it.quantity, balanceAfter: b.quantity, reference: sale.invoiceNo, note: reason, userId },
      });
    }
    if (sale.customerId) {
      await tx.customerLedger.create({ data: { customerId: sale.customerId, kind: "CANCELLATION", credit: sale.total, description: `Invoice ${sale.invoiceNo} cancelled`, saleId: sale.id, userId } });
      if (sale.amountPaid.gt(0)) {
        await tx.customerLedger.create({ data: { customerId: sale.customerId, kind: "CANCELLATION", debit: sale.amountPaid, description: `Refund of payment on ${sale.invoiceNo}`, saleId: sale.id, userId } });
      }
    }
    await audit(tx, ctx, {
      action: "sale.cancel", entity: "Sale", entityId: sale.id,
      before: { status: "COMPLETED" }, after: { status: "CANCELLED", reason, total: sale.total },
    });
    await emit(tx, "SaleCancelled", { saleId: sale.id, invoiceNo: sale.invoiceNo, medicineIds: [...new Set(sale.items.map((i) => i.medicineId))] });
    return tx.sale.findUnique({ where: { id: saleId } });
  });
}
