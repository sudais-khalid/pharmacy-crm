import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { D, customerBalance, supplierBalance } from "./common";

type PaymentInput = { amount: number; method: "CASH" | "CARD"; note?: string | null };

/** Customer pays off (part of) their udhaar balance. */
export async function receiveCustomerPayment(customerId: string, input: PaymentInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new AppError(404, "Customer not found.");
    const amount = D(input.amount).toDecimalPlaces(2);
    const balance = await customerBalance(tx, customerId);
    if (amount.gt(balance)) throw new AppError(409, `Payment (${amount.toFixed(2)}) is more than the outstanding balance (${balance.toFixed(2)}).`);
    await tx.customerLedger.create({
      data: { customerId, kind: "PAYMENT", credit: amount, description: input.note ? `Payment received – ${input.note}` : "Payment received", method: input.method, userId },
    });
    return { balance: balance.minus(amount) };
  });
}

/** We pay a supplier. */
export async function paySupplier(supplierId: string, input: PaymentInput, userId: string) {
  return prisma.$transaction(async (tx) => {
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
