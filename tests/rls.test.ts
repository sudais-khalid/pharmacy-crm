/**
 * Tenant isolation enforced by PostgreSQL. Tables are discovered from the catalog, so a table added later
 * with a "pharmacyId" column is checked automatically (and must get fixtures and a policy).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { prisma } from "@/lib/prisma";
import { tenantTransaction, runInTx } from "@/lib/db";
import { createSale, cancelSale } from "@/modules/sales";
import { createPurchase } from "@/modules/procurement";
import { adjustStock } from "@/modules/inventory";
import { receiveCustomerPayment } from "@/modules/customers";
import { updateSettings, getSettings, setLogo, notify, markNotificationsRead } from "@/modules/platform";
import { testPng } from "./png";
import { SYSTEM_ROLES, createRole } from "@/modules/identity";
import { resetDb, makePharmacy, makeUser, makeMedicine, makeBatch, makeCustomer, makeSupplier, ctxOf, inDays } from "./helpers";

let A = "";
let B = "";
let tenantTables: string[] = [];
/** Tenant tables the restricted role may read at all (platform-only ones such as SupportSession are excluded). */
let readableTables: string[] = [];

/** Full set of business data for one pharmacy, touching every tenant table. */
async function populate(pharmacyId: string) {
  const admin = await makeUser("ADMIN", pharmacyId);
  const ctx = ctxOf(admin);
  const m = await makeMedicine("Panadol", { barcode: "8901" }, pharmacyId);
  const b = await makeBatch(m.id, "B1", 120, 50, 50, 40, pharmacyId);
  const c = await makeCustomer(10_000, pharmacyId);
  const s = await makeSupplier(pharmacyId);
  await tenantTransaction(pharmacyId, (tx) => tx.category.create({ data: { name: "Analgesics" } }));
  const sale = await createSale(ctx, { items: [{ medicineId: m.id, quantity: 2 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CREDIT", customerId: c.id });
  await receiveCustomerPayment(ctx, c.id, { amount: 10, method: "CASH" });
  await createSale(ctx, { items: [{ medicineId: m.id, quantity: 1 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CASH" });
  await cancelSale(ctx, sale.id, "test cancel");
  await createPurchase(ctx, {
    supplierId: s.id, purchaseDate: inDays(0), discount: 0, paid: 0, paymentMethod: "CASH",
    items: [{ medicineId: m.id, batchNumber: "P1", expiryDate: inDays(300), quantity: 5, purchasePrice: 30, salePrice: 50 }],
  });
  await adjustStock(ctx, { batchId: b.id, kind: "DAMAGE", quantity: 1, note: "broken" });
  await createRole(ctx, { name: "Senior Cashier", permissions: [...SYSTEM_ROLES.CASHIER.permissions, "sales.cancel"], landingPath: "/pos" });
  const settings = await tenantTransaction(pharmacyId, (tx) => getSettings(tx, pharmacyId));
  await updateSettings(ctx, { expiryWarningDays: settings.expiryWarningDays + 1, currency: settings.currency });
  await notify(platformDb, pharmacyId, { type: "RESET_REQUEST", audiencePermission: "users.manage", dedupeKey: "fixture", title: "fixture" });
  await markNotificationsRead(ctx, "all");
  await setLogo(ctx, { logo: testPng(256, `logo ${pharmacyId}`), icon: testPng(64, `icon ${pharmacyId}`) });
  // platform-written tenant rows
  await platformDb.featureFlag.create({ data: { pharmacyId, key: "ocr", enabled: true } });
  const dev = await platformDb.platformUser.upsert({ where: { email: "dev@t.test" }, update: {}, create: { name: "Dev", email: "dev@t.test", passwordHash: "x" } });
  await platformDb.supportSession.create({ data: { platformUserId: dev.id, pharmacyId, reason: "fixture" } });
  await platformDb.authToken.create({
    data: { realm: "STAFF", subjectId: admin.id, pharmacyId, purpose: "INVITE", tokenHash: `hash-${pharmacyId}`, expiresAt: new Date(Date.now() + 3600_000), createdByRealm: "PLATFORM", createdById: "dev" },
  });
  return { admin, medicine: m, customer: c };
}

let fixtures: { a: Awaited<ReturnType<typeof populate>>; b: Awaited<ReturnType<typeof populate>> };

beforeAll(async () => {
  await resetDb();
  A = (await makePharmacy("alpha")).id;
  B = (await makePharmacy("bravo")).id;
  fixtures = { a: await populate(A), b: await populate(B) };
  const rows = await platformDb.$queryRaw<{ table_name: string }[]>`
    SELECT table_name::text AS table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'pharmacyId' ORDER BY table_name`;
  tenantTables = rows.map((r) => r.table_name);
  const readable = await platformDb.$queryRaw<{ t: string }[]>`
    SELECT c.relname::text AS t
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'pharmacyId' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege('pcrm_app', c.oid, 'SELECT')`;
  readableTables = readable.map((r) => r.t);
}, 60_000);

const q = (t: string) => `"${t.replace(/"/g, '""')}"`;
/** Rows every pharmacy may read besides its own: the shared role templates. */
const shared = (t: string) => (t === "Role" ? `"pharmacyId" IS NULL` : "false");

describe("row-level security", () => {
  it("covers every table with a pharmacyId column, and Pharmacy itself", async () => {
    expect(tenantTables.length).toBeGreaterThanOrEqual(19);
    const rows = await platformDb.$queryRaw<{ relname: string; rls: boolean; policies: bigint }[]>`
      SELECT c.relname::text AS relname, c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const byName = new Map(rows.map((r) => [r.relname, r]));
    for (const t of [...tenantTables, "Pharmacy"]) {
      expect(byName.get(t)?.rls, `RLS enabled on ${t}`).toBe(true);
      expect(Number(byName.get(t)?.policies), `policy on ${t}`).toBeGreaterThan(0);
    }
  });

  it("fixtures put rows for both pharmacies in every tenant table", async () => {
    for (const t of tenantTables) {
      const [r] = await platformDb.$queryRawUnsafe<{ a: bigint; b: bigint }[]>(
        `SELECT count(*) FILTER (WHERE "pharmacyId" = $1) AS a, count(*) FILTER (WHERE "pharmacyId" = $2) AS b FROM ${q(t)}`, A, B);
      expect(Number(r.a), `${t} has rows for A`).toBeGreaterThan(0);
      expect(Number(r.b), `${t} has rows for B`).toBeGreaterThan(0);
    }
  });

  it("a pharmacy sees only its own rows in every tenant table", async () => {
    expect(readableTables).not.toContain("SupportSession");
    await tenantTransaction(A, async (tx) => {
      for (const t of readableTables) {
        const [r] = await tx.$queryRawUnsafe<{ total: bigint; foreign: bigint }[]>(
          `SELECT count(*) AS total, count(*) FILTER (WHERE "pharmacyId" IS DISTINCT FROM $1 AND NOT (${shared(t)})) AS foreign FROM ${q(t)}`, A);
        expect(Number(r.foreign), `${t} leaks other rows`).toBe(0);
        expect(Number(r.total), `${t} shows own rows`).toBeGreaterThan(0);
      }
      const pharmacies = await tx.pharmacy.findMany();
      expect(pharmacies.map((p) => p.id)).toEqual([A]);
    });
  });

  it("fails closed: without a tenant the tenant client sees nothing", async () => {
    for (const t of [...readableTables, "Pharmacy"]) {
      const [r] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${q(t)} WHERE NOT (${t === "Pharmacy" ? "false" : shared(t)})`);
      expect(Number(r.n), `${t} visible without tenant`).toBe(0);
    }
    expect(await prisma.medicine.findUnique({ where: { id: fixtures.a.medicine.id } })).toBeNull();
  });

  it("blocks writes into another pharmacy and ignores updates to its rows", async () => {
    await expect(tenantTransaction(A, (tx) => tx.category.create({ data: { pharmacyId: B, name: "Injected" } }))).rejects.toThrow(/row-level security/);
    const updated = await tenantTransaction(A, (tx) => tx.medicine.updateMany({ where: { id: fixtures.b.medicine.id }, data: { name: "Hijacked" } }));
    expect(updated.count).toBe(0);
    const deleted = await tenantTransaction(A, (tx) => tx.customer.deleteMany({ where: { id: fixtures.b.customer.id } }));
    expect(deleted.count).toBe(0);
    expect((await platformDb.medicine.findUniqueOrThrow({ where: { id: fixtures.b.medicine.id } })).name).toBe("Panadol");
  });

  it("services cannot act on another pharmacy's records", async () => {
    const ctxA = ctxOf(fixtures.a.admin);
    await expect(createSale(ctxA, { items: [{ medicineId: fixtures.b.medicine.id, quantity: 1 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CASH" })).rejects.toThrow(/not found/i);
    await expect(receiveCustomerPayment(ctxA, fixtures.b.customer.id, { amount: 1, method: "CASH" })).rejects.toThrow(/not found/i);
  });
});

describe("privileges of the tenant role", () => {
  it("cannot read Developer accounts or support sessions", async () => {
    await expect(tenantTransaction(A, (tx) => tx.platformUser.findMany())).rejects.toThrow(/permission denied/);
    await expect(tenantTransaction(A, (tx) => tx.supportSession.findMany())).rejects.toThrow(/permission denied/);
  });

  it("reads the role templates but cannot change them or create roles for another pharmacy", async () => {
    const id = SYSTEM_ROLES.CASHIER.id;
    expect(await tenantTransaction(A, (tx) => tx.role.findUnique({ where: { id } }))).not.toBeNull();
    expect((await tenantTransaction(A, (tx) => tx.role.updateMany({ where: { id }, data: { permissions: ["users.manage"] } }))).count).toBe(0);
    expect((await tenantTransaction(A, (tx) => tx.role.deleteMany({ where: { id } }))).count).toBe(0);
    await expect(tenantTransaction(A, (tx) => tx.role.create({ data: { pharmacyId: null, key: "SNEAKY", name: "Sneaky", permissions: [] } }))).rejects.toThrow(/row-level security/);
    await expect(tenantTransaction(A, (tx) => tx.role.create({ data: { pharmacyId: B, key: "x", name: "x", permissions: [] } }))).rejects.toThrow(/row-level security/);
  });

  it("cannot change or delete audit rows", async () => {
    await expect(tenantTransaction(A, (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow(/permission denied/);
  });

  it("may edit its profile but never its status, plan or limits", async () => {
    await tenantTransaction(A, (tx) => tx.pharmacy.update({ where: { id: A }, data: { name: "Alpha Care" } }));
    await expect(tenantTransaction(A, (tx) => tx.pharmacy.update({ where: { id: A }, data: { status: "ACTIVE" } }))).rejects.toThrow(/permission denied/);
    await expect(tenantTransaction(A, (tx) => tx.pharmacy.update({ where: { id: A }, data: { maxUsers: 999 } }))).rejects.toThrow(/permission denied/);
    await expect(tenantTransaction(A, (tx) => tx.featureFlag.update({ where: { pharmacyId_key: { pharmacyId: A, key: "ocr" } }, data: { enabled: false } }))).rejects.toThrow(/permission denied/);
  });

  it("runInTx with a context always scopes to that context's pharmacy", async () => {
    const seen = await runInTx(ctxOf(fixtures.b.admin), (tx) => tx.medicine.findMany({ select: { pharmacyId: true } }));
    expect(new Set(seen.map((r) => r.pharmacyId))).toEqual(new Set([B]));
  });
});
