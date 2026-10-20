/**
 * Background worker: scheduled jobs (pg-boss) and the outbox dispatcher.
 * Started as its own process: `node dist/worker.js` (Docker `worker` service, desktop supervisor).
 */
import { PgBoss } from "pg-boss";
import { platformDb } from "@/lib/platform-db";
import { logger } from "@/lib/logger";
import { purgeIdempotencyKeys } from "@/lib/idempotency";
import { purgeRateLimitHits } from "@/lib/rate-limit";
import { dispatchOutbox, type OutboxHandlers } from "@/modules/platform";
import { claimNextIntake, cleanupDiscardedPhotos, processIntake } from "@/modules/stockentry";
import { scanExpiry, scanStock } from "@/modules/inventory";
import { scanOverdueOrders, scanReorder } from "@/modules/procurement";

const workerLog = logger.child({ svc: "worker" });
const log = (msg: string, extra: Record<string, unknown> = {}) => workerLog.info(extra, msg);

/** Pharmacies that are working (a suspended or closed pharmacy gets no alerts). */
async function activePharmacies() {
  return platformDb.pharmacy.findMany({ where: { status: { in: ["ACTIVE", "GRACE"] } }, select: { id: true, slug: true } });
}

/** Runs a scan for every active pharmacy; one pharmacy failing does not stop the others. */
async function forEachPharmacy(job: string, scan: (pharmacyId: string) => Promise<{ raised: number; resolved: number }>) {
  let raised = 0;
  let resolved = 0;
  let failed = 0;
  for (const p of await activePharmacies()) {
    try {
      const r = await scan(p.id);
      raised += r.raised;
      resolved += r.resolved;
    } catch (e) {
      failed++;
      workerLog.error({ job, pharmacy: p.slug, error: String(e) }, "scan failed for a pharmacy");
    }
  }
  return { raised, resolved, failed };
}

/** Event handlers by type. Delivery is at least once; the scans are idempotent. */
const outboxPharmacy = async (id: bigint) => (await platformDb.outboxEvent.findUnique({ where: { id }, select: { pharmacyId: true } }))?.pharmacyId ?? null;
const rescanStock = async (e: { id: bigint; payload: { medicineIds: string[] } }) => {
  const pharmacyId = await outboxPharmacy(e.id);
  if (pharmacyId && e.payload.medicineIds.length) await scanStock(pharmacyId, undefined, e.payload.medicineIds);
};
const handlers: OutboxHandlers = {
  SaleCompleted: [rescanStock],
  SaleCancelled: [rescanStock],
  SaleReturned: [rescanStock],
  PurchasePosted: [rescanStock],
  StockEntryPosted: [rescanStock],
};

/** Scheduled maintenance. Cron expressions run in the pharmacy time zone. */
const schedules: { name: string; cron: string; run: () => Promise<unknown> }[] = [
  { name: "platform.purge-idempotency-keys", cron: "15 * * * *", run: () => purgeIdempotencyKeys() },
  { name: "platform.purge-rate-limit-hits", cron: "20 * * * *", run: () => purgeRateLimitHits() },
  { name: "files.cleanup", cron: "40 3 * * *", run: () => cleanupDiscardedPhotos() },
  // stock intelligence (roadmap 6.2): expiry stages once a day, stock levels every half hour
  { name: "expiry.scan", cron: "0 6 * * *", run: () => forEachPharmacy("expiry.scan", (id) => scanExpiry(id)) },
  { name: "stock.scan", cron: "*/30 * * * *", run: () => forEachPharmacy("stock.scan", (id) => scanStock(id)) },
  // orders (roadmap 7.5, 7.10): what needs reordering, and orders past their expected date
  { name: "reorder.scan", cron: "15 6 * * *", run: () => forEachPharmacy("reorder.scan", (id) => scanReorder(id)) },
  { name: "po.overdue", cron: "30 6 * * *", run: () => forEachPharmacy("po.overdue", (id) => scanOverdueOrders(id)) },
];

const IDLE_MS = 2000;
let stopping = false;

/** Waits until migrations have created the outbox table (the web container applies them on start). */
async function waitForSchema(timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    try {
      await platformDb.$queryRaw`SELECT 1 FROM "OutboxEvent" LIMIT 1`;
      return;
    } catch (e) {
      if (Date.now() - start > timeoutMs) throw e;
      log("waiting for database schema");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function outboxLoop() {
  while (!stopping) {
    try {
      const r = await dispatchOutbox(handlers);
      if (r.failed) log("outbox events failed", r);
      if (r.claimed > 0) continue; // drain quickly while there is work
    } catch (e) {
      log("outbox dispatch error", { error: String(e) });
    }
    await new Promise((r) => setTimeout(r, IDLE_MS));
  }
}

/** Reads uploaded stock entry photos one at a time (OCR is slow; one at a time keeps the PC responsive). */
async function ocrLoop() {
  while (!stopping) {
    try {
      const next = await claimNextIntake();
      if (next) {
        const r = await processIntake(next.pharmacyId, next.id);
        log("stock entry read", { intakeId: next.id, ...r });
        continue;
      }
    } catch (e) {
      log("ocr error", { error: String(e) });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  await waitForSchema();
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss", application_name: "pharmacy-worker" });
  boss.on("error", (e) => log("pg-boss error", { error: String(e) }));
  await boss.start();

  const tz = process.env.APP_TIMEZONE || "Asia/Karachi";
  for (const s of schedules) {
    await boss.createQueue(s.name);
    await boss.schedule(s.name, s.cron, null, { tz });
    await boss.work(s.name, async () => {
      const result = await s.run();
      log("job done", { job: s.name, result });
    });
  }
  log("worker started", { schedules: schedules.map((s) => s.name), tz });
  // a shop computer is often off at 6 am: catch up once at start (the scans are idempotent)
  void (async () => {
    for (const name of ["expiry.scan", "stock.scan"]) {
      const s = schedules.find((x) => x.name === name)!;
      log("job done", { job: name, startup: true, result: await s.run().catch((e) => ({ error: String(e) })) });
    }
  })();

  const loop = outboxLoop();
  const ocr = ocrLoop();
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("stopping", { signal });
    await loop;
    await ocr;
    await boss.stop({ graceful: true, timeout: 20_000 });
    await platformDb.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // Windows has no real SIGTERM: a supervisor that forked this process (desktop mode) sends "shutdown".
  process.on("message", (m) => {
    if (m === "shutdown") void shutdown("ipc");
  });
}

main().catch(async (e) => {
  log("worker failed to start", { error: String(e) });
  await platformDb.$disconnect().catch(() => {});
  process.exit(1);
});
