import { prisma } from "@/lib/prisma";
import { addDays, todayStr, dateOnly } from "@/lib/dates";
import { serviceContext } from "@/modules/identity";

type RoleName = "ADMIN" | "PHARMACIST" | "CASHIER";

/** The pharmacy that fixtures belong to unless a test passes another one. Recreated by resetDb. */
export let pharmacyId = "";

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","OutboxEvent","IdempotencyKey","RateLimitHit","StockMovement","SaleItem","PurchaseItem","CustomerLedger","SupplierLedger","Sale","Purchase","Batch","Medicine","Category","Customer","Supplier","User",
              "AuthToken","SupportSession","FeatureFlag","TenantCounter","PharmacySettings","PlatformUser","Pharmacy" RESTART IDENTITY CASCADE`,
  );
  pharmacyId = (await makePharmacy("test")).id;
}

export async function makePharmacy(slug: string) {
  return prisma.pharmacy.create({ data: { slug, name: `Pharmacy ${slug}`, settings: { create: {} } } });
}

export const inDays = (n: number) => addDays(todayStr(), n);

export async function makeUser(role: RoleName = "CASHIER", inPharmacy = pharmacyId) {
  const tag = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`;
  return prisma.user.create({ data: { pharmacyId: inPharmacy, name: role, email: `${tag}@t.test`, username: tag, passwordHash: "x", role } });
}

/** Service context for a test user, scoped to the user's pharmacy. */
export const ctxOf = (user: { id: string; role: RoleName; pharmacyId: string }) => serviceContext(user, user.pharmacyId);

export async function makeMedicine(name = "Panadol", extra: Record<string, unknown> = {}, inPharmacy = pharmacyId) {
  return prisma.medicine.create({ data: { pharmacyId: inPharmacy, name, salePrice: 50, purchasePrice: 40, ...extra } });
}

export async function makeBatch(medicineId: string, batchNumber: string, expiryInDays: number, quantity: number, salePrice = 50, purchasePrice = 40, inPharmacy = pharmacyId) {
  return prisma.batch.create({ data: { pharmacyId: inPharmacy, medicineId, batchNumber, expiryDate: dateOnly(inDays(expiryInDays)), quantity, salePrice, purchasePrice } });
}

export async function makeCustomer(creditLimit = 0, inPharmacy = pharmacyId) {
  return prisma.customer.create({ data: { pharmacyId: inPharmacy, name: "Test Customer", creditLimit } });
}

export async function makeSupplier(inPharmacy = pharmacyId) {
  return prisma.supplier.create({ data: { pharmacyId: inPharmacy, name: "Test Supplier" } });
}
