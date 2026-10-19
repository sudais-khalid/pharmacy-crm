import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Applies prisma/migrations without the Prisma CLI (the desktop app ships no schema engine binary).
 * Records rows in _prisma_migrations exactly as Prisma does (same names, SHA-256 of the file as checksum),
 * so a database migrated here and one migrated by `prisma migrate deploy` are interchangeable.
 * Unlike Prisma, each migration runs inside a transaction: a failure leaves no partial schema behind.
 */
export type MigrationFile = { name: string; sql: string; checksum: string };

const LOCK_KEY = 72707369; // the advisory lock id Prisma Migrate uses, so the two never run at once

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

export function readMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

export type AppliedMigration = { name: string; checksum: string; finished: boolean };

export async function appliedMigrations(client: Client): Promise<AppliedMigration[]> {
  await client.query(CREATE_TABLE);
  const r = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
    `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`,
  );
  return r.rows.filter((x) => !x.rolled_back_at).map((x) => ({ name: x.migration_name, checksum: x.checksum, finished: !!x.finished_at }));
}

/**
 * pending: migrations in `dir` not yet applied. unknown: migrations the database has that `dir` does not,
 * meaning a newer version of the app has already updated this database.
 */
export async function migrationStatus(connectionString: string, dir: string): Promise<{ pending: string[]; unknown: string[] }> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const done = (await appliedMigrations(client)).filter((m) => m.finished).map((m) => m.name);
    const files = readMigrations(dir).map((m) => m.name);
    const doneSet = new Set(done);
    const fileSet = new Set(files);
    return { pending: files.filter((n) => !doneSet.has(n)), unknown: done.filter((n) => !fileSet.has(n)) };
  } finally {
    await client.end();
  }
}

/** Names of migrations in `dir` not yet applied to the database. */
export async function pendingMigrations(connectionString: string, dir: string): Promise<string[]> {
  return (await migrationStatus(connectionString, dir)).pending;
}

export type MigrateResult = { applied: string[]; alreadyApplied: number };

/**
 * Applies every pending migration in name order, or only those up to and including `upTo`.
 * Refuses to continue when an applied migration's file has changed, or when a previous run failed.
 */
export async function applyMigrations(connectionString: string, dir: string, opts: { upTo?: string; log?: (msg: string) => void } = {}): Promise<MigrateResult> {
  const files = readMigrations(dir).filter((m) => !opts.upTo || m.name <= opts.upTo);
  if (opts.upTo && !files.some((m) => m.name === opts.upTo)) throw new Error(`Unknown migration ${opts.upTo}`);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    const applied = new Map((await appliedMigrations(client)).map((m) => [m.name, m]));
    const result: MigrateResult = { applied: [], alreadyApplied: 0 };
    for (const m of files) {
      const prior = applied.get(m.name);
      if (prior && !prior.finished) throw new Error(`Migration ${m.name} failed earlier and needs attention before continuing`);
      if (prior) {
        if (prior.checksum !== m.checksum) throw new Error(`Migration ${m.name} was changed after it was applied`);
        result.alreadyApplied++;
        continue;
      }
      opts.log?.(`applying ${m.name}`);
      const id = randomUUID();
      await client.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES ($1, $2, $3, now(), 0)`, [id, m.checksum, m.name]);
      try {
        await client.query("BEGIN");
        await client.query(m.sql);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        // the row is removed again: nothing of this migration was applied, so a fixed file can simply be retried
        await client.query(`DELETE FROM "_prisma_migrations" WHERE id = $1`, [id]);
        throw new Error(`Migration ${m.name} failed: ${e instanceof Error ? e.message : e}`);
      }
      await client.query(`UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`, [id]);
      result.applied.push(m.name);
    }
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
