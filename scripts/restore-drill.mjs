// Restore drill (roadmap 9, acceptance: "restore of last night's backup into a fresh database succeeds and
// the smoke script passes against it"). Next to the test database (.env.test): a source database is migrated
// and seeded, backed up with the ops command as the worker does every night, restored into a brand-new
// database, and the production build is started on the restored data for the full smoke and isolation suites.
// Needs `npm run build`. Usage: node scripts/restore-drill.mjs
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

process.loadEnvFile(".env.test");
const admin = new URL(process.env.DATABASE_URL);
admin.pathname = "/postgres";
const at = (db) => { const u = new URL(admin.toString()); u.pathname = `/${db}`; return u.toString(); };
const SOURCE = "pcrm_drill_source";
const RESTORED = "pcrm_drill_restored";
const PORT = 3400;

async function sql(text) {
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(text);
  } finally {
    await c.end();
  }
}

const base = {
  ...process.env, NODE_ENV: "production", APP_TIMEZONE: "Asia/Karachi", JWT_SECRET: "drill-secret-drill-secret-drill-secret-1234",
  PLATFORM_OWNER_EMAIL: "owner@example.com", PLATFORM_OWNER_PASSWORD: "drill-owner-password-123", BASE_URL: `http://localhost:${PORT}`,
};
const run = (cmd, env) => execSync(cmd, { env, stdio: "inherit" });
const dir = mkdtempSync(join(tmpdir(), "pcrm-drill-"));
const file = join(dir, "nightly.pcrmbak");
const win = process.platform === "win32";

for (const db of [SOURCE, RESTORED]) {
  await sql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await sql(`CREATE DATABASE ${db}`);
}
let server;
let failed = false;
try {
  const source = { ...base, DATABASE_URL: at(SOURCE), ALLOW_DEMO_SEED: "1" };
  run("node dist/ops.js migrate", source);
  run("npm run db:seed --silent", source);
  // the key as the worker keeps it, in a file so it never appears on a command line
  const key = execSync("node dist/ops.js new-key", { env: base, encoding: "utf8" }).trim();
  writeFileSync(join(dir, "key.txt"), key);
  run(`node dist/ops.js backup "${file}" --key-file "${join(dir, "key.txt")}"`, source);
  console.log(`backup written: ${statSync(file).size} bytes`);
  // the source goes away, as if the server had been lost
  await sql(`DROP DATABASE ${SOURCE} WITH (FORCE)`);

  const restored = { ...base, DATABASE_URL: at(RESTORED) };
  run(`node dist/ops.js restore "${file}" --key-file "${join(dir, "key.txt")}"`, restored);
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { env: restored, stdio: "ignore", shell: win });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${base.BASE_URL}/login`).then((r) => r.ok, () => false)) break;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  for (const suite of ["bash scripts/smoke.sh", "node scripts/isolation-check.mjs"]) {
    try {
      run(suite, restored);
    } catch {
      failed = true;
    }
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  if (server) {
    if (win) execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
    else server.kill();
  }
  for (const db of [SOURCE, RESTORED]) await sql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? "restore drill: FAILED" : "restore drill: the restored data passes the smoke and isolation suites");
process.exit(failed ? 1 : 0);
