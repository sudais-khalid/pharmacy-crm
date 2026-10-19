// Runs the HTTP smoke and tenant isolation suites against a production build on this machine, the way
// CI does: a fresh database next to the test database (.env.test), migrated and seeded, and `next start`
// on a spare port. Needs `npm run build` first. Usage: node scripts/smoke-local.mjs
import { execSync, spawn } from "node:child_process";
import pg from "pg";

process.loadEnvFile(".env.test");
const admin = new URL(process.env.DATABASE_URL);
admin.pathname = "/postgres";
const DB = "pcrm_smoke";
const PORT = 3100;
const url = new URL(admin.toString());
url.pathname = `/${DB}`;

async function sql(text) {
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(text);
  } finally {
    await c.end();
  }
}

const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  NODE_ENV: "production",
  JWT_SECRET: "smoke-secret-smoke-secret-smoke-secret-1234",
  APP_TIMEZONE: "Asia/Karachi",
  PLATFORM_OWNER_EMAIL: "owner@example.com",
  PLATFORM_OWNER_PASSWORD: "smoke-owner-password-123",
  BASE_URL: `http://localhost:${PORT}`,
};
const run = (cmd) => execSync(cmd, { env, stdio: "inherit" });

await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await sql(`CREATE DATABASE ${DB}`);
let server;
let failed = false;
try {
  run("node dist/ops.js migrate");
  run("npm run db:seed --silent");
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", shell: process.platform === "win32" });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${env.BASE_URL}/login`).then((r) => r.ok, () => false)) break;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  for (const suite of ["bash scripts/smoke.sh", "node scripts/isolation-check.mjs"]) {
    try {
      run(suite);
    } catch {
      failed = true;
    }
  }
} finally {
  if (server) {
    if (process.platform === "win32") execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
    else server.kill();
  }
  await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
}
process.exit(failed ? 1 : 0);
