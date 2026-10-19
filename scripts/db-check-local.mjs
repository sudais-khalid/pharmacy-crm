// Drift check on this machine: a fresh shadow database next to the test database (.env.test), then
// `npm run db:check`. Usage: npm run db:check:local
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
try {
  execSync("npm run db:check --silent", { stdio: "inherit", env: { ...process.env, SHADOW_DATABASE_URL: shadow.toString() } });
} catch {
  process.exit(1);
}
