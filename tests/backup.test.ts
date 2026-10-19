import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { createBackup, restoreBackup, verifyBackup, newBackupKey, formatRecoveryKey, parseRecoveryKey } from "@/lib/backup";
import { applyMigrations, readMigrations } from "@/lib/migrations/runner";
import { createSale } from "@/modules/sales";
import { createPurchase } from "@/modules/procurement";
import { resetDb, makeUser, makeMedicine, makeBatch, makeCustomer, makeSupplier, ctxOf, inDays } from "./helpers";

const base = new URL(process.env.DATABASE_URL!);
const urlFor = (db: string) => {
  const u = new URL(base.toString());
  u.pathname = `/${db}`;
  return u.toString();
};
const admin = urlFor("postgres");
const source = process.env.DATABASE_URL!;
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const dir = mkdtempSync(join(tmpdir(), "pcrm-backup-"));

async function sql(url: string, text: string, params: unknown[] = []) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(text, params);
  } finally {
    await c.end();
  }
}
async function freshDb(name: string) {
  await sql(admin, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await sql(admin, `CREATE DATABASE ${name}`);
  return urlFor(name);
}
/** md5 of every table's rows, for exact comparison of two databases. */
async function fingerprint(url: string) {
  const tables = (await sql(url, `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT IN ('_prisma_migrations','RateLimitHit','IdempotencyKey') ORDER BY 1`)).rows.map((r) => r.table_name as string);
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = (await sql(url, `SELECT count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') AS f FROM "${t}" x`)).rows[0].f;
  return out;
}

beforeAll(async () => {
  await resetDb();
  const u = await makeUser("ADMIN");
  const m = await makeMedicine("Panadol", { barcode: "8901" });
  await makeBatch(m.id, "A1", 120, 50);
  const c = await makeCustomer(5000);
  const s = await makeSupplier();
  await createSale(ctxOf(u), { items: [{ medicineId: m.id, quantity: 3 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CREDIT", customerId: c.id });
  await createSale(ctxOf(u), { items: [{ medicineId: m.id, quantity: 1 }], discountType: "PERCENT", discountValue: 10, paymentMethod: "CASH" });
  await createPurchase(ctxOf(u), {
    supplierId: s.id, purchaseDate: inDays(0), discount: 0, paid: 0, paymentMethod: "CASH",
    items: [{ medicineId: m.id, batchNumber: "P1", expiryDate: inDays(300), quantity: 10, purchasePrice: 30, salePrice: 50 }],
  });
}, 60_000);

afterAll(async () => {
  for (const db of ["pcrm_restore_a", "pcrm_restore_b", "pcrm_restore_c", "pcrm_legacy_src", "pcrm_legacy_dst"]) await sql(admin, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  rmSync(dir, { recursive: true, force: true });
});

describe("recovery keys", () => {
  it("round-trip through the readable form, ignoring case, spaces and hyphens", () => {
    const key = newBackupKey();
    const text = formatRecoveryKey(key);
    expect(text).toMatch(/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
    expect(parseRecoveryKey(text.toLowerCase().replace(/-/g, " ")).equals(key)).toBe(true);
    expect(() => parseRecoveryKey(text.slice(0, 20))).toThrow(/not complete/);
  });
});

describe("encrypted backups", () => {
  const key = newBackupKey();
  const file = join(dir, "full.pcrmbak");

  it("restore into an empty database reproduces every table exactly", async () => {
    const made = await createBackup(source, file, key, { appVersion: "test" });
    expect(made.manifest.tables.find((t) => t.name === "Sale")?.rows).toBe(2);
    expect(readFileSync(file).includes(Buffer.from("Panadol"))).toBe(false); // encrypted at rest
    expect((await verifyBackup(file, key)).tables.length).toBe(made.manifest.tables.length);

    const target = await freshDb("pcrm_restore_a");
    const r = await restoreBackup(target, file, key, MIGRATIONS);
    expect(r.migratedAfter).toEqual([]);
    expect(await fingerprint(target)).toEqual(await fingerprint(source));

    // identity columns continue after the restored rows
    const maxId = (await sql(target, `SELECT max(id)::int AS m FROM "AuditLog"`)).rows[0].m;
    const ins = await sql(target, `INSERT INTO "AuditLog" (action, entity, "entityId") VALUES ('t', 'T', '1') RETURNING id::int`);
    expect(ins.rows[0].id).toBeGreaterThan(maxId);
  }, 120_000);

  it("refuses a wrong key before touching the database", async () => {
    const target = await freshDb("pcrm_restore_b");
    await expect(restoreBackup(target, file, newBackupKey(), MIGRATIONS)).rejects.toThrow(/different key/);
    expect((await sql(target, `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n).toBe(0);
    await expect(verifyBackup(file, newBackupKey())).rejects.toThrow(/different key/);
  }, 60_000);

  it("refuses a changed file and commits nothing", async () => {
    const bytes = readFileSync(file);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const bad = join(dir, "tampered.pcrmbak");
    writeFileSync(bad, bytes);
    await expect(verifyBackup(bad, key)).rejects.toThrow(/changed or damaged/);
    const target = await freshDb("pcrm_restore_c");
    await expect(restoreBackup(target, bad, key, MIGRATIONS)).rejects.toThrow(/changed or damaged/);
    expect((await sql(target, `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n).toBe(0);
  }, 120_000);

  it("never overwrites an existing backup file", async () => {
    await expect(createBackup(source, file, key)).rejects.toThrow();
  });
});

describe("version-aware restore", () => {
  it("restores a backup made before multi-pharmacy support into the current schema", async () => {
    const legacyLast = "20261012120000_database_utc";
    expect(readMigrations(MIGRATIONS).some((m) => m.name === legacyLast)).toBe(true);
    const src = await freshDb("pcrm_legacy_src");
    await applyMigrations(src, MIGRATIONS, { upTo: legacyLast });
    await sql(src, `INSERT INTO "Setting" (id, "pharmacyName", currency, "updatedAt") VALUES (1, 'Old Shop', 'PKR', now())`);
    await sql(src, `INSERT INTO "User" (id, name, email, "passwordHash", role, "updatedAt") VALUES ('u1', 'Owner', 'owner@old.example', 'x', 'ADMIN', now())`);
    await sql(src, `INSERT INTO "Medicine" (id, name, "updatedAt") VALUES ('m1', 'Old Syrup', now())`);
    for (let i = 0; i < 7; i++) await sql(src, `SELECT nextval('invoice_seq')`);

    const key = newBackupKey();
    const file = join(dir, "legacy.pcrmbak");
    const made = await createBackup(src, file, key);
    expect(made.manifest.migrations[made.manifest.migrations.length - 1]).toBe(legacyLast);

    const dst = await freshDb("pcrm_legacy_dst");
    const r = await restoreBackup(dst, file, key, MIGRATIONS);
    expect(r.migratedAfter.length).toBeGreaterThan(0);
    const pharmacy = (await sql(dst, `SELECT id, slug, name FROM "Pharmacy"`)).rows;
    expect(pharmacy).toHaveLength(1);
    expect(pharmacy[0]).toMatchObject({ slug: "main", name: "Old Shop" });
    expect((await sql(dst, `SELECT username, "pharmacyId" FROM "User"`)).rows[0]).toMatchObject({ username: "owner", pharmacyId: pharmacy[0].id });
    expect((await sql(dst, `SELECT value::int AS v FROM "TenantCounter" WHERE key = 'INVOICE'`)).rows[0].v).toBe(7);
  }, 180_000);
});
