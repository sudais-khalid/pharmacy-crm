import type { Tx } from "@/lib/prisma";
import { toJson } from "@/lib/json";

/** Domain events and their payloads (architecture, section 7.2). */
export type DomainEvents = {
  SaleCompleted: { saleId: string; invoiceNo: string; medicineIds: string[]; customerId: string | null };
  SaleCancelled: { saleId: string; invoiceNo: string; medicineIds: string[] };
  PurchasePosted: { purchaseId: string; number: string; supplierId: string; medicineIds: string[] };
  StockAdjusted: { batchId: string; medicineId: string; quantity: number; type: string };
  MedicineCreated: { medicineId: string };
  CustomerPaymentReceived: { customerId: string; amount: string };
  SupplierPaid: { supplierId: string; amount: string };
};

export type EventType = keyof DomainEvents;

/** Writes an event to the outbox inside the caller's transaction. The worker delivers it after commit. */
export async function emit<T extends EventType>(tx: Tx, type: T, payload: DomainEvents[T]) {
  await tx.outboxEvent.create({ data: { type, payload: toJson(payload) } });
}
