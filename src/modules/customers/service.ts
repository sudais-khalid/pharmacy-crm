import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { D } from "@/lib/money";
import type { PaymentInput } from "@/lib/validation";
import { customerBalance } from "./queries";

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
