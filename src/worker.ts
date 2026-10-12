/**
 * Background worker: scheduled jobs (pg-boss) and the outbox dispatcher.
 * Started as its own process: `node dist/worker.js` (Docker `worker` service, desktop supervisor).
 */
import { PgBoss } from "pg-boss";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { purgeIdempotencyKeys } from "@/lib/idempotency";
import { purgeRateLimitHits } from "@/lib/rate-limit";
import { dispatchOutbox, type OutboxHandlers } from "@/modules/platform";

const workerLog = logger.child({ svc: "worker" });
const log = (msg: string, extra: Record<string, unknown> = {}) => workerLog.info(extra, msg);

/** Event handlers by type. Modules add theirs as features arrive (notifications, rollups, alerts). */
const handlers: OutboxHandlers = {};

/** Scheduled maintenance. Cron expressions run in the pharmacy time zone. */
const schedules: { name: string; cron: string; run: () => Promise<unknown> }[] = [
  { name: "platform.purge-idempotency-keys", cron: "15 * * * *", run: () => purgeIdempotencyKeys() },
  { name: "platform.purge-rate-limit-hits", cron: "20 * * * *", run: () => purgeRateLimitHits() },
];

const IDLE_MS = 2000;
let stopping = false;

/** Waits until migrations have created the outbox table (the web container applies them on start). */
async function waitForSchema(timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    try {
      await prisma.$queryRaw`SELECT 1 FROM "OutboxEvent" LIMIT 1`;
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

  const loop = outboxLoop();
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("stopping", { signal });
    await loop;
    await boss.stop({ graceful: true, timeout: 20_000 });
    await prisma.$disconnect();
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
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
