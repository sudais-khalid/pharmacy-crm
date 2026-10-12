import { prisma } from "@/lib/prisma";
import { addDays, todayStr, dateOnly } from "@/lib/dates";
import { serviceContext } from "@/modules/identity";

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","OutboxEvent","IdempotencyKey","RateLimitHit","StockMovement","SaleItem","PurchaseItem","CustomerLedger","SupplierLedger","Sale","Purchase","Batch","Medicine","Category","Customer","Supplier","User" RESTART IDENTITY CASCADE`,
  );
}

export const inDays = (n: number) => addDays(todayStr(), n);

export async function makeUser(role: "ADMIN" | "PHARMACIST" | "CASHIER" = "CASHIER") {
  return prisma.user.create({ data: { name: role, email: `${role.toLowerCase()}-${Math.random()}@t.test`, passwordHash: "x", role } });
}

/** Service context for a test user (no tenant until Phase 1). */
export const ctxOf = (user: { id: string; role: "ADMIN" | "PHARMACIST" | "CASHIER" }) => serviceContext(user);

export async function makeMedicine(name = "Panadol", extra: Record<string, unknown> = {}) {
  return prisma.medicine.create({ data: { name, salePrice: 50, purchasePrice: 40, ...extra } });
}

export async function makeBatch(medicineId: string, batchNumber: string, expiryInDays: number, quantity: number, salePrice = 50, purchasePrice = 40) {
  return prisma.batch.create({ data: { medicineId, batchNumber, expiryDate: dateOnly(inDays(expiryInDays)), quantity, salePrice, purchasePrice } });
}

export async function makeCustomer(creditLimit = 0) {
  return prisma.customer.create({ data: { name: "Test Customer", creditLimit } });
}

export async function makeSupplier() {
  return prisma.supplier.create({ data: { name: "Test Supplier" } });
}
