/**
 * HTTP tenant isolation check against a running, seeded app (roadmap task 1.14).
 *
 * Pharmacy A is the seeded "demo" pharmacy; pharmacy B is created by isolation-fixtures.ts. Signed in to
 * each pharmacy in turn, every pharmacy API that takes a record id is called with the other pharmacy's
 * ids and must answer 404, and list endpoints must never show the other pharmacy's records.
 * Every API route with an id segment must be listed in ROUTES, so new endpoints cannot skip the check.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=... node scripts/isolation-check.mjs
 */
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const B = process.env.BASE_URL ?? "http://localhost:3000";
let failures = 0;
const ok = (name, got, want) => {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : ` (expected ${want}, got ${got})`}`);
};

/** Route files with an id segment and the requests that cover them. {x} is replaced by the other pharmacy's ids. */
const ROUTES = {
  "customers/[id]": [["GET", "/api/customers/{customer}"], ["PUT", "/api/customers/{customer}", { name: "Hijacked" }]],
  "customers/[id]/payments": [["POST", "/api/customers/{customer}/payments", { amount: 1, method: "CASH" }]],
  "suppliers/[id]/catalog": [["GET", "/api/suppliers/{supplier}/catalog"], ["POST", "/api/suppliers/{supplier}/catalog", { medicineId: "{medicine:own}" }]],
  "suppliers/[id]/catalog/[itemId]": [["DELETE", "/api/suppliers/{supplier}/catalog/{catalogItem}"]],
  "suppliers/[id]/catalog/import": [["POST", "/api/suppliers/{supplier}/catalog/import", { rows: [{ name: "Bravo Only Syrup" }] }]],
  "orders/[id]": [["GET", "/api/orders/{order}"], ["PUT", "/api/orders/{order}", { items: [{ medicineId: "{medicine:own}", orderedQty: 1 }] }]],
  "orders/[id]/[action]": [["POST", "/api/orders/{order}/send"], ["POST", "/api/orders/{order}/end", { reason: "cross-tenant attempt" }], ["POST", "/api/orders/{order}/receive"]],
  "supplier-returns/[id]": [["GET", "/api/supplier-returns/{supplierReturn}"]],
  "medicines/[id]/sales": [["GET", "/api/medicines/{medicine}/sales"]],
  "medicines/[id]/purchases": [["GET", "/api/medicines/{medicine}/purchases"]],
  "inventory/batches/[id]/trace": [["GET", "/api/inventory/batches/{batch}/trace"]],
  "returns/[id]": [["GET", "/api/returns/{saleReturn}"]],
  "cash/[id]": [["GET", "/api/cash/{cashSession}"]],
  "cash/[id]/[action]": [["POST", "/api/cash/{cashSession}/movement", { type: "PAY_IN", amount: 1, reason: "cross-tenant attempt" }], ["POST", "/api/cash/{cashSession}/close", { countedCash: 0, note: "cross-tenant attempt" }]],
  "medicines/[id]": [["GET", "/api/medicines/{medicine}"], ["PUT", "/api/medicines/{medicine}", { name: "Hijacked" }], ["DELETE", "/api/medicines/{medicine}"]],
  "purchases/[id]": [["GET", "/api/purchases/{purchase}"]],
  "sales/[id]": [["GET", "/api/sales/{sale}"]],
  "sales/[id]/cancel": [["POST", "/api/sales/{sale}/cancel", { reason: "cross-tenant attempt" }]],
  "suppliers/[id]": [["GET", "/api/suppliers/{supplier}"], ["PUT", "/api/suppliers/{supplier}", { name: "Hijacked" }]],
  "suppliers/[id]/payments": [["POST", "/api/suppliers/{supplier}/payments", { amount: 1, method: "CASH" }]],
  "users/[id]": [["PUT", "/api/users/{user}", { name: "Hijacked" }]],
  "users/[id]/[action]": [["POST", "/api/users/{user}/reset-link"], ["POST", "/api/users/{user}/temporary-password"], ["POST", "/api/users/{user}/logout"]],
  "files/[id]": [["GET", "/api/files/{file}"]],
  "stock-entry/[id]": [["GET", "/api/stock-entry/{intake}"], ["PUT", "/api/stock-entry/{intake}", { lines: [] }]],
  "stock-entry/[id]/[action]": [["POST", "/api/stock-entry/{intake}/post"], ["POST", "/api/stock-entry/{intake}/discard"], ["POST", "/api/stock-entry/{intake}/match"], ["POST", "/api/stock-entry/{intake}/retry"]],
  "roles/[id]": [["PUT", "/api/roles/{role}", { name: "Hijacked", permissions: ["pos.use"], landingPath: "/pos" }], ["DELETE", "/api/roles/{role}"]],
};
/** Writes that take another pharmacy's ids in the body. */
const BODY_WRITES = [
  ["POST", "/api/inventory/adjust", { batchId: "{batch}", kind: "REMOVE", quantity: 1, note: "cross-tenant attempt" }],
  ["POST", "/api/sales", { items: [{ medicineId: "{medicine}", quantity: 1 }], paymentMethod: "CASH" }],
  ["POST", "/api/sales", { items: [{ medicineId: "{medicine:own}", quantity: 1 }], paymentMethod: "CREDIT", customerId: "{customer}" }],
  ["POST", "/api/orders", { supplierId: "{supplier}", items: [{ medicineId: "{medicine:own}", orderedQty: 1 }] }],
  ["POST", "/api/orders", { supplierId: "{supplier:own}", items: [{ medicineId: "{medicine}", orderedQty: 1 }] }],
  ["POST", "/api/supplier-returns", { supplierId: "{supplier:own}", reason: "cross-tenant attempt", items: [{ batchId: "{batch}", quantity: 1 }] }],
  ["POST", "/api/inventory/write-off", { batchIds: ["{batch}"], note: "cross-tenant attempt" }],
  ["POST", "/api/inventory/set-aside", { batchIds: ["{batch}"], aside: true }],
  ["POST", "/api/returns", { saleId: "{sale}", refundMethod: "CASH", reason: "cross-tenant attempt", items: [{ saleItemId: "{saleItem}", quantity: 1, restock: true }] }],
  ["POST", "/api/purchases", { supplierId: "{supplier}", purchaseDate: new Date().toISOString().slice(0, 10), items: [{ medicineId: "{medicine:own}", batchNumber: "X1", expiryDate: "2031-01-01", quantity: 1, purchasePrice: 1, salePrice: 2 }] }],
];
/** Id routes that are not pharmacy data (platform realm, public token links). */
const EXEMPT = /^(platform\/|auth\/token\/|auth\/pharmacy\/)/;

function idRouteFiles(dir = join(process.cwd(), "src", "app", "api")) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...idRouteFiles(full));
    else if (name === "route.ts") {
      const rel = relative(join(process.cwd(), "src", "app", "api"), dir).split(sep).join("/");
      if (rel.includes("[") && !EXEMPT.test(rel)) out.push(rel);
    }
  }
  return out;
}

function jar() {
  let cookie = "";
  return {
    async req(method, path, body) {
      const res = await fetch(B + path, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) {
        const [pair] = c.split(";");
        const [k] = pair.split("=");
        cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), pair].join("; ");
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        // not JSON
      }
      return { status: res.status, data };
    },
  };
}

const fill = (v, other, own) => JSON.parse(JSON.stringify(v).replace(/\{(\w+)(:own)?\}/g, (_, k, isOwn) => (isOwn ? own[k] : other[k])));

async function idsOf(client) {
  const pick = async (path, key = "items") => {
    const r = await client.req("GET", path);
    const list = Array.isArray(r.data) ? r.data : r.data?.[key];
    return list?.[0]?.id;
  };
  return {
    medicine: await pick("/api/medicines"), customer: await pick("/api/customers"), supplier: await pick("/api/suppliers"),
    sale: await pick("/api/sales"), purchase: await pick("/api/purchases"), batch: await pick("/api/inventory/batches"), user: await pick("/api/users", "items"), role: (await client.req("GET", "/api/roles")).data?.roles?.find((r) => !r.system)?.id,
    file: (await client.req("GET", "/api/branding")).data?.logoFileId,
    intake: await pick("/api/stock-entry?status=all"),
    saleReturn: await pick("/api/returns"), cashSession: await pick("/api/cash/sessions"),
    order: await pick("/api/orders?status=all"), supplierReturn: await pick("/api/supplier-returns"),
    catalogItem: await (async () => { const sid = await pick("/api/suppliers"); return sid ? (await client.req("GET", `/api/suppliers/${sid}/catalog`)).data?.[0]?.id : undefined; })(),
    saleItem: await (async () => { const id = await pick("/api/sales"); return id ? (await client.req("GET", `/api/sales/${id}`)).data?.items?.[0]?.id : undefined; })(),
  };
}

async function main() {
  // coverage: every id route must be in ROUTES
  const files = idRouteFiles();
  for (const f of files) ok(`route ${f} is covered`, !!ROUTES[f], true);

  const fx = JSON.parse(execSync("npx tsx scripts/isolation-fixtures.ts", { encoding: "utf8" }).trim().split("\n").pop());
  const a = jar();
  const b = jar();
  ok("pharmacy A admin signs in", (await a.req("POST", "/api/auth/login", { pharmacy: "demo", username: "admin", password: "Admin@12345" })).status, 200);
  ok("pharmacy B admin signs in", (await b.req("POST", "/api/auth/login", { pharmacy: fx.pharmacy, username: fx.admin.username, password: fx.admin.password })).status, 200);
  const idsA = await idsOf(a);
  const idsB = fx.ids;

  for (const [label, client, other, own] of [["A", a, idsB, idsA], ["B", b, idsA, idsB]]) {
    for (const [file, calls] of Object.entries(ROUTES)) {
      for (const [method, path, body] of calls) {
        const r = await client.req(method, fill(path, other, own), body && fill(body, other, own));
        ok(`${label}: ${method} ${file} with the other pharmacy's id`, r.status, 404);
      }
    }
    for (const [method, path, body] of BODY_WRITES) {
      const r = await client.req(method, path, fill(body, other, own));
      ok(`${label}: ${method} ${path} referencing the other pharmacy`, r.status, 404);
    }
    ok(`${label}: stock card of the other pharmacy's medicine`, (await client.req("GET", `/api/inventory/stock-card?medicineId=${other.medicine}`)).status, 404);
  }

  // lists never show the other pharmacy's records
  const text = async (client, path) => JSON.stringify((await client.req("GET", path)).data);
  for (const [path, needle] of [
    ["/api/medicines?q=Bravo", fx.names.medicine], ["/api/pos/search?q=Bravo", fx.names.medicine], ["/api/customers?q=Bravo", fx.names.customer],
    ["/api/suppliers?q=Bravo", fx.names.supplier], ["/api/sales?q=" + fx.names.invoice, fx.ids.sale], ["/api/purchases", fx.ids.purchase],
    ["/api/inventory/batches?q=BRAVO", "BRAVO-1"], ["/api/inventory/movements?q=Bravo", fx.ids.medicine], ["/api/users", fx.ids.user], ["/api/roles", fx.ids.role], ["/api/stock-entry?status=all", fx.ids.intake], ["/api/search?q=Bravo", fx.names.medicine], ["/api/search?q=BRAVO", "BRAVO-1"], ["/api/returns", fx.ids.saleReturn], ["/api/orders?status=all", fx.ids.order], ["/api/supplier-returns", fx.ids.supplierReturn], ["/api/cash/sessions", fx.ids.cashSession],
    ["/api/dashboard", fx.names.medicine], ["/api/reports?type=sales&from=2020-01-01&to=2035-01-01", fx.names.invoice],
  ]) {
    ok(`A: ${path} hides pharmacy B`, (await text(a, path)).includes(needle), false);
  }
  ok("B sees its own medicine (fixture sanity)", (await text(b, "/api/medicines?q=Bravo")).includes(fx.names.medicine), true);
  ok("B's medicine untouched by A", (await b.req("GET", `/api/medicines/${fx.ids.medicine}`)).data?.name, fx.names.medicine);

  console.log(`isolation: ${failures === 0 ? "all checks passed" : `${failures} failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
