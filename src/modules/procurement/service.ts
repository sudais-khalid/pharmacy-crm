import { runInTx } from "@/lib/db";
import type { ServiceContext } from "@/modules/identity";
import { audit, emit, nextNumber } from "@/modules/platform";
import { AppError } from "@/lib/errors";
import { todayStr, dateOnly } from "@/lib/dates";
import { D, ZERO } from "@/lib/money";
import type { PaymentInput } from "@/lib/validation";
import { supplierBalance } from "./queries";
import { refreshCatalogFromPurchase } from "./catalog";
import { applyReceipt } from "./orders";

export type PurchaseInput = {
  supplierId: string;
  supplierInvoice?: string | null;
  purchaseDate: string;
  items: {
    medicineId: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice: number; salePrice: number;
    /** Free units on the bill (stock, no charge), trade discount percent and line tax (data model 4.3). */
    bonusQty?: number; discountPercent?: number; taxAmount?: number;
  }[];
  discount: number;
  paid: number;
  paymentMethod: "CASH" | "CARD";
  note?: string | null;
  /** The stock entry this purchase is posted from. */
  intakeId?: string | null;
  /** The order it receives against: its received quantities and status move on. */
  purchaseOrderId?: string | null;
};

/**
 * One bill line: rate times quantity, less the trade discount, plus tax. Its effective cost spreads the
 * line total over every unit received, bonus included, so profit reflects what the stock really cost.
 */
export function purchaseLine(i: PurchaseInput["items"][number]) {
  const bonus = i.bonusQty ?? 0;
  const net = D(i.purchasePrice).mul(i.quantity).mul(D(100).minus(i.discountPercent ?? 0)).div(100).toDecimalPlaces(2);
  const tax = D(i.taxAmount ?? 0).toDecimalPlaces(2);
  const lineTotal = net.plus(tax);
  const units = i.quantity + bonus;
  return { net, tax, lineTotal, units, bonus, effectiveCost: units > 0 ? lineTotal.div(units).toDecimalPlaces(4) : D(i.purchasePrice) };
}

/** Records a purchase invoice: creates/updates batches, increases stock, writes movements and the supplier ledger. */
export async function createPurchase(ctx: ServiceContext, input: PurchaseInput) {
  const today = todayStr();
  const userId = ctx.actor.id;
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    if (!supplier.active) throw new AppError(409, "This supplier is inactive.");

    const lines = input.items.map((i) => ({ ...i, ...purchaseLine(i) }));
    for (const l of lines) if (l.expiryDate < today) throw new AppError(400, `Batch ${l.batchNumber} is already expired (${l.expiryDate}).`);
    const subtotal = lines.reduce((s, l) => s.plus(l.net), ZERO);
    const taxTotal = lines.reduce((s, l) => s.plus(l.tax), ZERO);
    const discount = D(input.discount).toDecimalPlaces(2);
    if (discount.gt(subtotal)) throw new AppError(400, "Discount cannot be more than the subtotal.");
    const total = subtotal.plus(taxTotal).minus(discount);
    if (input.supplierInvoice) {
      const twice = await tx.purchase.findFirst({ where: { supplierId: supplier.id, supplierInvoice: input.supplierInvoice }, select: { number: true } });
      if (twice) throw new AppError(409, `Invoice ${input.supplierInvoice} from ${supplier.name} is already recorded as ${twice.number}.`, { fields: { supplierInvoice: "Already recorded" } });
    }
    const paid = D(input.paid).toDecimalPlaces(2);
    if (paid.gt(total)) throw new AppError(400, "Paid amount cannot exceed the invoice total.");

    const n = await nextNumber(tx, "PURCHASE");
    const number = `PUR-${today.replace(/-/g, "")}-${String(n).padStart(5, "0")}`;

    const purchase = await tx.purchase.create({
      data: {
        number, supplierInvoice: input.supplierInvoice ?? null, supplierId: supplier.id, userId, purchaseDate: dateOnly(input.purchaseDate),
        subtotal, discount, taxTotal, total, paid, paymentMethod: paid.gt(0) ? input.paymentMethod : null, note: input.note ?? null, intakeId: input.intakeId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
      },
    });

    for (const l of lines) {
      const med = await tx.medicine.findUnique({ where: { id: l.medicineId } });
      if (!med) throw new AppError(404, "Medicine not found.");
      let batch = await tx.batch.findUnique({ where: { medicineId_batchNumber: { medicineId: l.medicineId, batchNumber: l.batchNumber } } });
      if (batch) {
        if (batch.expiryDate.toISOString().slice(0, 10) !== l.expiryDate) {
          throw new AppError(409, `Batch ${l.batchNumber} of ${med.name} already exists with a different expiry date.`);
        }
        batch = await tx.batch.update({
          where: { id: batch.id },
          data: { quantity: { increment: l.units }, purchasePrice: l.effectiveCost, salePrice: l.salePrice },
        });
      } else {
        batch = await tx.batch.create({
          data: { medicineId: l.medicineId, batchNumber: l.batchNumber, expiryDate: dateOnly(l.expiryDate), quantity: l.units, purchasePrice: l.effectiveCost, salePrice: l.salePrice },
        });
      }
      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id, medicineId: l.medicineId, batchId: batch.id, batchNumber: l.batchNumber, expiryDate: dateOnly(l.expiryDate),
          quantity: l.quantity, bonusQty: l.bonus, purchasePrice: l.purchasePrice, discountPercent: l.discountPercent ?? 0, taxAmount: l.tax,
          effectiveCost: l.effectiveCost, salePrice: l.salePrice, lineTotal: l.lineTotal,
        },
      });
      await tx.stockMovement.create({
        data: { medicineId: l.medicineId, batchId: batch.id, type: "PURCHASE", quantity: l.units, balanceAfter: batch.quantity, reference: number, userId },
      });
      await tx.medicine.update({ where: { id: l.medicineId }, data: { purchasePrice: l.purchasePrice, salePrice: l.salePrice } });
    }

    // the supplier's catalog keeps the last price and bonus; an order counts what arrived
    await refreshCatalogFromPurchase(tx, ctx.pharmacyId, supplier.id, lines.map((l) => ({ medicineId: l.medicineId, purchasePrice: l.purchasePrice, quantity: l.quantity, bonus: l.bonus })));
    const orderStatus = input.purchaseOrderId ? await applyReceipt(tx, input.purchaseOrderId, supplier.id, lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity }))) : null;

    if (total.gt(0)) {
      await tx.supplierLedger.create({ data: { supplierId: supplier.id, kind: "INVOICE", debit: total, description: `Purchase ${number}${input.supplierInvoice ? ` (supplier inv. ${input.supplierInvoice})` : ""}`, purchaseId: purchase.id, userId } });
    }
    if (paid.gt(0)) {
      await tx.supplierLedger.create({ data: { supplierId: supplier.id, kind: "PAYMENT", credit: paid, description: `Payment on ${number}`, purchaseId: purchase.id, method: input.paymentMethod, userId } });
    }
    await audit(tx, ctx, {
      action: "purchase.create", entity: "Purchase", entityId: purchase.id,
      after: { number, supplierId: supplier.id, supplierInvoice: input.supplierInvoice ?? null, total, taxTotal, paid, lines: lines.length, intakeId: input.intakeId ?? null, purchaseOrderId: input.purchaseOrderId ?? null, orderStatus },
    });
    await emit(tx, "PurchasePosted", { purchaseId: purchase.id, number, supplierId: supplier.id, medicineIds: [...new Set(lines.map((l) => l.medicineId))] });
    return purchase;
  });
}

/** We pay a supplier. */
export async function paySupplier(ctx: ServiceContext, supplierId: string, input: PaymentInput) {
  const userId = ctx.actor.id;
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    const amount = D(input.amount).toDecimalPlaces(2);
    const balance = await supplierBalance(tx, supplierId);
    if (amount.gt(balance)) throw new AppError(409, `Payment (${amount.toFixed(2)}) is more than the outstanding payable (${balance.toFixed(2)}).`);
    const entry = await tx.supplierLedger.create({
      data: { supplierId, kind: "PAYMENT", credit: amount, description: input.note ? `Payment made: ${input.note}` : "Payment made", method: input.method, userId },
    });
    await audit(tx, ctx, { action: "supplier.payment", entity: "Supplier", entityId: supplierId, after: { ledgerId: entry.id, amount, method: input.method } });
    await emit(tx, "SupplierPaid", { supplierId, amount: amount.toFixed(2) });
    return { balance: balance.minus(amount) };
  });
}
