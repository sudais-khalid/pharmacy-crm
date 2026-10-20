/**
 * Operations CLI, bundled to dist/ops.js so an installed copy can run it without the dev toolchain.
 *
 *   node dist/ops.js migrate [--status]
 *   node dist/ops.js new-key
 *   node dist/ops.js backup  <file>
 *   node dist/ops.js verify  <file>
 *   node dist/ops.js restore <file>
 *   node dist/ops.js recover-owner [--email you@example.com] [--json]
 *   node dist/ops.js rebuild-summaries [--pharmacy <code>]
 *
 * The database comes from DATABASE_URL (or --db <url>), read from ./.env (or --env <path>; Node itself claims --env-file) when
 * present. The recovery key comes from PCRM_RECOVERY_KEY or --key-file <path>; it is never taken as a
 * plain argument, so it does not end up in process lists or shell history. Migrations are read from ./prisma/migrations unless --migrations <dir> is given.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBackup, formatRecoveryKey, newBackupKey, parseRecoveryKey, restoreBackup, verifyBackup } from "@/lib/backup";
import { applyMigrations, pendingMigrations } from "@/lib/migrations/runner";

/** Set by the bundler from package.json; tsx runs leave it undefined. */
declare const __APP_VERSION__: string | undefined;
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : (process.env.npm_package_version ?? "dev");

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  args.splice(i, 2);
  return value;
}

function recoveryKey(args: string[]): Buffer {
  const file = option(args, "--key-file");
  const text = file ? readFileSync(file, "utf8") : process.env.PCRM_RECOVERY_KEY;
  if (!text) throw new Error("Set PCRM_RECOVERY_KEY or pass --key-file <path>.");
  return parseRecoveryKey(text.trim());
}

async function main(argv: string[]) {
  const args = [...argv];
  const envFile = option(args, "--env") ?? ".env";
  try {
    process.loadEnvFile(envFile); // variables already set in the environment win
  } catch {
    // no env file: everything comes from the environment
  }
  const command = args.shift();
  const db = option(args, "--db") ?? process.env.DATABASE_URL;
  const migrations = resolve(option(args, "--migrations") ?? "prisma/migrations");
  const log = (msg: string) => console.log(`  ${msg}`);
  const needDb = () => {
    if (!db) throw new Error("Set DATABASE_URL or pass --db <url>.");
    return db;
  };
  const needFile = () => {
    const file = args.shift();
    if (!file) throw new Error(`Usage: ops ${command} <file>`);
    return resolve(file);
  };

  switch (command) {
    case "migrate": {
      if (args.includes("--status")) {
        const pending = await pendingMigrations(needDb(), migrations);
        console.log(pending.length ? `${pending.length} pending:\n${pending.map((p) => `  ${p}`).join("\n")}` : "Database schema is up to date.");
        return;
      }
      const r = await applyMigrations(needDb(), migrations, { log });
      console.log(r.applied.length ? `Applied ${r.applied.length} migration(s).` : "Database schema is up to date.");
      return;
    }
    case "new-key": {
      console.log(formatRecoveryKey(newBackupKey()));
      return;
    }
    case "backup": {
      const file = needFile();
      const key = recoveryKey(args);
      const r = await createBackup(needDb(), file, key, { appVersion: APP_VERSION });
      const rows = r.manifest.tables.reduce((n, t) => n + t.rows, 0);
      console.log(`Wrote ${file}: ${r.manifest.tables.length} tables, ${rows} rows.`);
      return;
    }
    case "verify": {
      const file = needFile();
      const m = await verifyBackup(file, recoveryKey(args));
      const rows = m.tables.reduce((n, t) => n + t.rows, 0);
      console.log(`OK: made ${m.createdAt} by version ${m.appVersion}, ${m.tables.length} tables, ${rows} rows, schema ${m.migrations[m.migrations.length - 1] ?? "empty"}.`);
      return;
    }
    case "restore": {
      const file = needFile();
      const r = await restoreBackup(needDb(), file, recoveryKey(args), migrations, { log });
      console.log(`Restored ${r.manifest.tables.length} tables from ${r.manifest.createdAt}${r.migratedAfter.length ? `, then applied ${r.migratedAfter.length} newer migration(s)` : ""}.`);
      return;
    }
    case "recover-owner": {
      // A new password for the Developer account, two-factor sign-in removed, every session ended. Whoever
      // can run this already controls the computer; the desktop app asks Windows for an administrator.
      process.env.DATABASE_URL = needDb();
      const json = args.includes("--json");
      let email = option(args, "--email");
      const { platformDb } = await import("@/lib/platform-db");
      try {
        if (!email) {
          const owners = await platformDb.platformUser.findMany({ select: { email: true } });
          if (owners.length !== 1) throw new Error(owners.length ? "There is more than one Developer account: pass --email." : "There is no Developer account yet. Sign in once with the owner credentials of this build.");
          email = owners[0].email;
        }
        // platform-auth directly: the identity index also loads the session helpers, which need Next
        const { recoverPlatformOwner } = await import("@/modules/identity/platform-auth");
        const r = await recoverPlatformOwner(email);
        console.log(json ? JSON.stringify(r) : `Developer account ${r.email} recovered.
New password (shown once): ${r.password}
Sign in and set up two-factor sign-in again.`);
      } finally {
        await platformDb.$disconnect();
      }
      return;
    }
    case "rebuild-summaries": {
      // the daily figures behind the dashboards, recomputed from sales, returns, stock and expenses
      process.env.DATABASE_URL = needDb();
      const { platformDb } = await import("@/lib/platform-db");
      const { rebuildSummaries } = await import("@/modules/finance");
      try {
        const code = option(args, "--pharmacy");
        const pharmacies = await platformDb.pharmacy.findMany({ where: code ? { slug: code } : {}, select: { id: true, slug: true } });
        if (!pharmacies.length) throw new Error(code ? `No pharmacy with the code ${code}.` : "There are no pharmacies yet.");
        for (const ph of pharmacies) {
          const r = await rebuildSummaries(ph.id);
          console.log(`${ph.slug}: ${r.days} day(s) rebuilt`);
        }
      } finally {
        await platformDb.$disconnect();
      }
      return;
    }
    default:
      throw new Error("Commands: migrate [--status], new-key, backup <file>, verify <file>, restore <file>, recover-owner, rebuild-summaries");
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  // a refused connection arrives as an AggregateError with an empty message
  const inner = e instanceof AggregateError ? e.errors.map((x: Error) => x.message).join("; ") : "";
  console.error(e.message || inner || String(e));
  process.exit(1);
});
