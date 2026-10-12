import { runInTx } from "@/lib/db";
import type { ServiceContext } from "@/modules/identity";
import { AppError } from "@/lib/errors";
import { todayStr, dateOnly } from "@/lib/dates";
import { D, ZERO } from "@/lib/money";
import type { PaymentInput } from "@/lib/validation";
import { supplierBalance } from "./queries";

export type PurchaseInput = {
  supplierId: string;
  supplierInvoice?: string | null;
  purchaseDate: string;
  items: { medicineId: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice: number; salePrice: number }[];
  discount: number;
  paid: number;
  paymentMethod: "CASH" | "CARD";
  note?: string | null;
};

/** Records a purchase invoice: creates/updates batches, increases stock, writes movements and the supplier ledger. */
export async function createPurchase(ctx: ServiceContext, input: PurchaseInput) {
  const today = todayStr();
  const userId = ctx.actor.id;
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    if (!supplier.active) throw new AppError(409, "This supplier is inactive.");

    const lines = input.items.map((i) => ({ ...i, lineTotal: D(i.purchasePrice).mul(i.quantity).toDecimalPlaces(2) }));
    for (const l of lines) if (l.expiryDate < today) throw new AppError(400, `Batch ${l.batchNumber} is already expired (${l.expiryDate}).`);
    const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
    const discount = D(input.discount).toDecimalPlaces(2);
    if (discount.gt(subtotal)) throw new AppError(400, "Discount cannot be more than the subtotal.");
    const total = subtotal.minus(discount);
    const paid = D(input.paid).toDecimalPlaces(2);
    if (paid.gt(total)) throw new AppError(400, "Paid amount cannot exceed the invoice total.");

    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('purchase_seq') AS n`;
    const number = `PUR-${today.replace(/-/g, "")}-${String(n).padStart(5, "0")}`;

    const purchase = await tx.purchase.create({
      data: {
        number, supplierInvoice: input.supplierInvoice ?? null, supplierId: supplier.id, userId, purchaseDate: dateOnly(input.purchaseDate),
        subtotal, discount, total, paid, paymentMethod: paid.gt(0) ? input.paymentMethod : null, note: input.note ?? null,
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
          data: { quantity: { increment: l.quantity }, purchasePrice: l.purchasePrice, salePrice: l.salePrice },
        });
      } else {
        batch = await tx.batch.create({
          data: { medicineId: l.medicineId, batchNumber: l.batchNumber, expiryDate: dateOnly(l.expiryDate), quantity: l.quantity, purchasePrice: l.purchasePrice, salePrice: l.salePrice },
        });
      }
      await tx.purchaseItem.create({
        data: { purchaseId: purchase.id, medicineId: l.medicineId, batchId: batch.id, batchNumber: l.batchNumber, expiryDate: dateOnly(l.expiryDate), quantity: l.quantity, purchasePrice: l.purchasePrice, salePrice: l.salePrice, lineTotal: l.lineTotal },
      });
      await tx.stockMovement.create({
        data: { medicineId: l.medicineId, batchId: batch.id, type: "PURCHASE", quantity: l.quantity, balanceAfter: batch.quantity, reference: number, userId },
      });
      await tx.medicine.update({ where: { id: l.medicineId }, data: { purchasePrice: l.purchasePrice, salePrice: l.salePrice } });
    }

    if (total.gt(0)) {
      await tx.supplierLedger.create({ data: { supplierId: supplier.id, kind: "INVOICE", debit: total, description: `Purchase ${number}${input.supplierInvoice ? ` (supplier inv. ${input.supplierInvoice})` : ""}`, purchaseId: purchase.id, userId } });
    }
    if (paid.gt(0)) {
      await tx.supplierLedger.create({ data: { supplierId: supplier.id, kind: "PAYMENT", credit: paid, description: `Payment on ${number}`, purchaseId: purchase.id, method: input.paymentMethod, userId } });
    }
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
    await tx.supplierLedger.create({
      data: { supplierId, kind: "PAYMENT", credit: amount, description: input.note ? `Payment made – ${input.note}` : "Payment made", method: input.method, userId },
    });
    return { balance: balance.minus(amount) };
  });
}
