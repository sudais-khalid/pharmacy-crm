import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { applyMigrations, pendingMigrations, readMigrations } from "@/lib/migrations/runner";

/** A throwaway database next to the test database. */
const base = new URL(process.env.DATABASE_URL!);
const urlFor = (db: string) => {
  const u = new URL(base.toString());
  u.pathname = `/${db}`;
  return u.toString();
};
const admin = urlFor("postgres");
const DB = "pcrm_runner_test";
const target = urlFor(DB);
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");

async function sql(url: string, text: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(text);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await sql(admin, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await sql(admin, `CREATE DATABASE ${DB}`);
}, 60_000);
afterAll(async () => {
  await sql(admin, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
});

describe("built-in migration runner", () => {
  it("applies every migration and records them exactly as Prisma does", async () => {
    const files = readMigrations(MIGRATIONS);
    const first = await applyMigrations(target, MIGRATIONS, { upTo: files[2].name });
    expect(first.applied).toEqual(files.slice(0, 3).map((f) => f.name));
    expect(await pendingMigrations(target, MIGRATIONS)).toEqual(files.slice(3).map((f) => f.name));

    const rest = await applyMigrations(target, MIGRATIONS);
    expect(rest).toEqual({ applied: files.slice(3).map((f) => f.name), alreadyApplied: 3 });
    expect(await applyMigrations(target, MIGRATIONS)).toEqual({ applied: [], alreadyApplied: files.length });

    const rows = (await sql(target, `SELECT migration_name, checksum, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name`)).rows;
    expect(rows.map((r) => [r.migration_name, r.checksum, r.applied_steps_count])).toEqual(files.map((f) => [f.name, f.checksum, 1]));

    // Prisma itself agrees the database is up to date
    const status = execSync("npx prisma migrate status", { env: { ...process.env, DATABASE_URL: target }, encoding: "utf8" });
    expect(status).toMatch(/Database schema is up to date/);
  }, 120_000);

  it("refuses migrations changed after they were applied, and rolls back a failing one completely", async () => {
    const dir = mkdtempSync(join(tmpdir(), "migr-"));
    try {
      cpSync(MIGRATIONS, dir, { recursive: true });
      const [firstName] = readMigrations(dir).map((f) => f.name);
      writeFileSync(join(dir, firstName, "migration.sql"), "-- edited\n" + readMigrations(MIGRATIONS)[0].sql);
      await expect(applyMigrations(target, dir)).rejects.toThrow(/changed after it was applied/);

      cpSync(MIGRATIONS, dir, { recursive: true, force: true });
      mkdirSync(join(dir, "29991231000000_broken"));
      writeFileSync(join(dir, "29991231000000_broken", "migration.sql"), `CREATE TABLE "Half" (id int);\nSELECT * FROM no_such_table;`);
      await expect(applyMigrations(target, dir)).rejects.toThrow(/failed/);
      expect((await sql(target, `SELECT to_regclass('public."Half"') AS t`)).rows[0].t).toBeNull();
      expect((await sql(target, `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = '29991231000000_broken'`)).rows[0].n).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
