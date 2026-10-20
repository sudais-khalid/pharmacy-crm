// Runs the Playwright journeys (roadmap 9.6) against a production build on this machine: a fresh database
// next to the test database (.env.test), migrated but not seeded (the journeys create the pharmacy), the
// server on a spare port, and the worker with a fixed photo reading (e2e/fixtures). Needs `npm run build`.
// Usage: node scripts/e2e-local.mjs [playwright options]
import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";

process.loadEnvFile(".env.test");
const admin = new URL(process.env.DATABASE_URL);
admin.pathname = "/postgres";
const DB = "pcrm_e2e";
const PORT = 3200;
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
  JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret-1234",
  APP_TIMEZONE: "Asia/Karachi",
  PLATFORM_OWNER_EMAIL: "owner@e2e.example",
  PLATFORM_OWNER_PASSWORD: "e2e-owner-password-12345",
  BASE_URL: `http://localhost:${PORT}`,
  PCRM_E2E: "1",
  OCR_FIXTURE_FILE: resolve("e2e/fixtures/stock-list.json"),
};
const run = (cmd) => execSync(cmd, { env, stdio: "inherit" });
const win = process.platform === "win32";

await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await sql(`CREATE DATABASE ${DB}`);
const children = [];
let failed = false;
try {
  run("node dist/ops.js migrate");
  children.push(spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", shell: win }));
  children.push(spawn("node", ["dist/worker.js"], { env, stdio: "ignore" }));
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${env.BASE_URL}/login`).then((r) => r.ok, () => false)) break;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  try {
    run(`npx playwright test ${process.argv.slice(2).join(" ")}`);
  } catch {
    failed = true;
  }
} finally {
  for (const c of children) {
    if (win) execSync(`taskkill /F /T /PID ${c.pid}`, { stdio: "ignore" });
    else c.kill();
  }
  await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
}
process.exit(failed ? 1 : 0);
