import { platformDb } from "@/lib/platform-db";
import { addDays, todayStr, dateOnly } from "@/lib/dates";
import { SYSTEM_ROLES, ensureSystemRoles, serviceContext, type Permission } from "@/modules/identity";

type RoleName = "ADMIN" | "PHARMACIST" | "CASHIER";
const TEMPLATE = { ADMIN: SYSTEM_ROLES.PHARMACY_ADMIN, PHARMACIST: SYSTEM_ROLES.PHARMACIST, CASHIER: SYSTEM_ROLES.CASHIER } as const;

/** The pharmacy that fixtures belong to unless a test passes another one. Recreated by resetDb. */
export let pharmacyId = "";

export async function resetDb() {
  await platformDb.$executeRawUnsafe(
    `TRUNCATE "AuditLog","OutboxEvent","IdempotencyKey","RateLimitHit","StockMovement","SaleItem","PurchaseItem","CustomerLedger","SupplierLedger","Sale","Purchase","Batch","Medicine","Category","Customer","Supplier","User",
              "AuthToken","SupportSession","FeatureFlag","TenantCounter","PharmacySettings","PlatformUser","Role","StoredFile","NotificationRead","Notification","StockIntakeLine","StockIntakePage","StockIntake","SupplierItemAlias","Pharmacy" RESTART IDENTITY CASCADE`,
  );
  await ensureSystemRoles(platformDb);
  pharmacyId = (await makePharmacy("test")).id;
}

export async function makePharmacy(slug: string) {
  return platformDb.pharmacy.create({ data: { slug, name: `Pharmacy ${slug}`, settings: { create: {} } } });
}

export const inDays = (n: number) => addDays(todayStr(), n);

export async function makeUser(role: RoleName = "CASHIER", inPharmacy = pharmacyId) {
  const tag = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`;
  return platformDb.user.create({ data: { pharmacyId: inPharmacy, name: role, email: `${tag}@t.test`, username: tag, passwordHash: "x", roleId: TEMPLATE[role].id } });
}

/** Service context for a test user (template roles), or with explicit permissions for custom roles. */
export const ctxOf = (user: { id: string; roleId: string; pharmacyId: string }, permissions?: readonly Permission[]) =>
  serviceContext({ id: user.id, permissions: permissions ?? Object.values(SYSTEM_ROLES).find((r) => r.id === user.roleId)?.permissions ?? [] }, user.pharmacyId);

export async function makeMedicine(name = "Panadol", extra: Record<string, unknown> = {}, inPharmacy = pharmacyId) {
  return platformDb.medicine.create({ data: { pharmacyId: inPharmacy, name, salePrice: 50, purchasePrice: 40, ...extra } });
}

export async function makeBatch(medicineId: string, batchNumber: string, expiryInDays: number, quantity: number, salePrice = 50, purchasePrice = 40, inPharmacy = pharmacyId) {
  return platformDb.batch.create({ data: { pharmacyId: inPharmacy, medicineId, batchNumber, expiryDate: dateOnly(inDays(expiryInDays)), quantity, salePrice, purchasePrice } });
}

export async function makeCustomer(creditLimit = 0, inPharmacy = pharmacyId) {
  return platformDb.customer.create({ data: { pharmacyId: inPharmacy, name: "Test Customer", creditLimit } });
}

export async function makeSupplier(inPharmacy = pharmacyId) {
  return platformDb.supplier.create({ data: { pharmacyId: inPharmacy, name: "Test Supplier" } });
}
