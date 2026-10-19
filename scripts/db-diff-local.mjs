// Prints the SQL that takes prisma/migrations to the current schema.prisma, using a throwaway shadow database
// next to the test database (.env.test). Starting point for a new migration:
//   node scripts/db-diff-local.mjs > prisma/migrations/<name>/migration.sql
import { execSync } from "node:child_process";
import pg from "pg";

process.loadEnvFile(".env.test");
const admin = new URL(process.env.DATABASE_URL);
admin.pathname = "/postgres";
const shadow = new URL(admin.toString());
shadow.pathname = "/pcrm_shadow";
shadow.search = "";
const c = new pg.Client({ connectionString: admin.toString() });
await c.connect();
await c.query("DROP DATABASE IF EXISTS pcrm_shadow WITH (FORCE)");
await c.query("CREATE DATABASE pcrm_shadow");
await c.end();
const out = execSync(`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "${shadow}" --script`, { encoding: "utf8" });
// prisma prints notices before the script; keep the SQL only
process.stdout.write(out.slice(Math.max(0, out.indexOf("--"))));
