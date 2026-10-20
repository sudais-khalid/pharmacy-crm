// Performance check (roadmap 9.8) against the targets in docs/plan/02-architecture.md, section 9, through the
// real HTTP API of a production build: a fresh database next to the test database (.env.test) holding 20
// pharmacies of seeded data (scripts/perf-seed.ts), then timed requests, alone and with all 20 pharmacies
// selling at once. Needs `npm run build`. Exits non-zero when a target is missed.
// Usage: node scripts/perf-check.mjs
import { execSync, spawn } from "node:child_process";
import pg from "pg";

process.loadEnvFile(".env.test");
const admin = new URL(process.env.DATABASE_URL);
admin.pathname = "/postgres";
const DB = "pcrm_perf";
const PORT = 3300;
const url = new URL(admin.toString());
url.pathname = `/${DB}`;
const B = `http://localhost:${PORT}`;
const PASSWORD = "Perf-check-pass-1";

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
  ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "production", APP_TIMEZONE: "Asia/Karachi",
  JWT_SECRET: "perf-secret-perf-secret-perf-secret-perf-1234", TRUST_PROXY: "1",
};
const win = process.platform === "win32";

/** A signed-in staff member of one pharmacy (each from its own address, as on separate shop networks). */
async function client(slug, n) {
  const ip = `10.0.${Math.floor(n / 250)}.${(n % 250) + 1}`;
  let cookie = "";
  const req = async (method, path, body) => {
    const t0 = performance.now();
    const res = await fetch(B + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip, origin: B, cookie }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(c.split("=")[0] + "=")), c.split(";")[0]].join("; ");
    const text = await res.text();
    const ms = performance.now() - t0;
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return { ms, data: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text };
  };
  await req("POST", "/api/auth/login", { pharmacy: slug, username: "admin", password: PASSWORD });
  return req;
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const results = [];
function record(name, times, target) {
  const row = { name, n: times.length, p50: Math.round(pct(times, 0.5)), p95: Math.round(pct(times, 0.95)), max: Math.round(Math.max(...times)), target, ok: target === null || pct(times, 0.95) <= target };
  results.push(row);
  console.log(`${row.ok ? "PASS" : "FAIL"}  ${name}: p50 ${row.p50} ms, p95 ${row.p95} ms, max ${row.max} ms${target ? ` (target p95 under ${target} ms)` : ""}`);
}

const QUERIES = ["pana", "bru", "omep", "cetiri", "flagy", "amlo", "metf", "cipro", "gluco", "lipi"];
async function sale(req, ids, lines = 10) {
  const items = Array.from({ length: lines }, (_, i) => ({ medicineId: ids[(Math.floor(Math.random() * ids.length) + i) % ids.length], quantity: 1 }));
  const unique = [...new Map(items.map((x) => [x.medicineId, x])).values()];
  return (await req("POST", "/api/sales", { items: unique, discountType: "AMOUNT", discountValue: 0, paymentMethod: "CARD" })).ms;
}
async function medicineIds(req) {
  const ids = new Set();
  for (const q of QUERIES) for (const m of (await req("GET", `/api/pos/search?q=${q}`)).data) if (m.stock > 0) ids.add(m.id);
  return [...ids];
}

await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await sql(`CREATE DATABASE ${DB}`);
let server;
let failed = false;
try {
  execSync("node dist/ops.js migrate", { env, stdio: "ignore" });
  const t0 = Date.now();
  const pharmacies = JSON.parse(execSync("npx tsx scripts/perf-seed.ts", { env, encoding: "utf8" }).trim().split("\n").pop());
  const counts = await (async () => {
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    const r = (await c.query(`SELECT (SELECT count(*) FROM "Medicine")::int AS medicines, (SELECT count(*) FROM "Sale")::int AS sales, (SELECT count(*) FROM "SaleItem")::int AS items`)).rows[0];
    await c.end();
    return r;
  })();
  console.log(`seeded ${pharmacies.length} pharmacies, ${counts.medicines} medicines, ${counts.sales} sales with ${counts.items} lines in ${Math.round((Date.now() - t0) / 1000)} s`);

  server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", shell: win });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${B}/login`).then((r) => r.ok, () => false)) break;
    await new Promise((ok) => setTimeout(ok, 1000));
  }

  // the largest pharmacy (20,000 medicines), one person at a time
  const big = await client(pharmacies[0].slug, 0);
  const ids = await medicineIds(big);
  for (let i = 0; i < 3; i++) for (const q of QUERIES) await big("GET", `/api/pos/search?q=${q}`); // warm up
  const search = [];
  for (let r = 0; r < 12; r++) for (const q of QUERIES) search.push((await big("GET", `/api/pos/search?q=${q}`)).ms);
  record("POS medicine search, 20,000 medicines", search, 150);
  const palette = [];
  for (let r = 0; r < 6; r++) for (const q of QUERIES) palette.push((await big("GET", `/api/search?q=${q}`)).ms);
  record("Search everything (Ctrl+K), 20,000 medicines", palette, 150);
  for (let i = 0; i < 5; i++) await sale(big, ids);
  const sales = [];
  for (let i = 0; i < 40; i++) sales.push(await sale(big, ids));
  record("Complete a sale of 10 lines", sales, 500);
  const dash = [];
  for (let i = 0; i < 15; i++) dash.push((await big("GET", "/api/dashboard")).ms);
  record("Dashboard figures (owner and stock views, 90 days of sales)", dash, 1500);
  const page = [];
  for (let i = 0; i < 10; i++) page.push((await big("GET", "/dashboard")).ms);
  record("Dashboard page", page, 1500);
  const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  for (const type of ["sales", "pnl", "salesByCategory", "topMedicines"]) {
    const t = [];
    for (let i = 0; i < 6; i++) t.push((await big("GET", `/api/reports?type=${type}&from=${from}&group=day`)).ms);
    record(`Report ${type}, 90 days`, t, null);
  }

  // all 20 pharmacies at the counter at once
  const all = await Promise.all(pharmacies.map((p, i) => client(p.slug, i + 1)));
  const allIds = await Promise.all(all.map((req) => medicineIds(req)));
  // busy counters: every pharmacy searches and sells, with a short pause for the customer (1 to 3 s) between
  // sales, for a minute; several times a real peak hour, and what the targets are about
  const busySales = [];
  const busySearch = [];
  const until = Date.now() + 60_000;
  await Promise.all(all.map(async (req, i) => {
    for (let k = 0; Date.now() < until; k++) {
      busySearch.push((await req("GET", `/api/pos/search?q=${QUERIES[k % QUERIES.length]}`)).ms);
      busySales.push(await sale(req, allIds[i]));
      await new Promise((ok) => setTimeout(ok, 1000 + Math.random() * 2000));
    }
  }));
  record(`POS search, 20 pharmacies at busy counters (${busySales.length} sales in a minute)`, busySearch, 150);
  record("Complete a 10-line sale, 20 pharmacies at busy counters", busySales, 500);
  // no pauses at all: 20 requests always in flight; shows the throughput limit of one server process
  const floodSales = [];
  const t1 = performance.now();
  await Promise.all(all.map(async (req, i) => { for (let k = 0; k < 10; k++) floodSales.push(await sale(req, allIds[i])); }));
  const perSecond = floodSales.length / ((performance.now() - t1) / 1000);
  record(`Complete a 10-line sale with no pauses, 20 at once (${perSecond.toFixed(1)} sales a second)`, floodSales, null);
  failed = results.some((r) => !r.ok);
  console.log(JSON.stringify({ seeded: { pharmacies: pharmacies.length, ...counts }, results }));
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  if (server) {
    if (win) execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
    else server.kill();
  }
  await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
}
process.exit(failed ? 1 : 0);
