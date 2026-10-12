import { statfsSync } from "node:fs";
import { platformDb } from "@/lib/platform-db";

export type CheckResult = { ok: boolean; [detail: string]: unknown };

/** A short, never-empty description of an error (driver errors sometimes have an empty message). */
function describe(e: unknown): string {
  if (e instanceof AggregateError && e.errors.length) return e.errors.map(describe).join("; ");
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    const first = e.message.split("\n")[0].trim();
    return [e.name !== "Error" ? e.name : "", code ?? "", first].filter(Boolean).join(": ") || "unknown error";
  }
  return String(e) || "unknown error";
}

export type Health = { status: "ok" | "degraded" | "down"; checks: Record<"database" | "worker" | "disk", CheckResult>; uptimeSeconds: number; version: string };

/** The worker is considered behind when an event has waited longer than this. */
const OUTBOX_LAG_LIMIT_S = 300;
const MIN_FREE_BYTES = 1024 ** 3; // 1 GB
const MIN_FREE_RATIO = 0.1;

async function database(): Promise<CheckResult> {
  const t = Date.now();
  try {
    await platformDb.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

async function worker(): Promise<CheckResult> {
  try {
    const [row] = await platformDb.$queryRaw<{ pending: bigint; parked: bigint; oldest: number | null }[]>`
      SELECT count(*) FILTER (WHERE attempts < 10) AS pending,
             count(*) FILTER (WHERE attempts >= 10) AS parked,
             EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - min("createdAt") FILTER (WHERE attempts < 10)))::float AS oldest
      FROM "OutboxEvent" WHERE "processedAt" IS NULL`;
    const oldest = row.oldest === null ? 0 : Math.round(row.oldest);
    return { ok: oldest <= OUTBOX_LAG_LIMIT_S, pendingEvents: Number(row.pending), parkedEvents: Number(row.parked), oldestPendingSeconds: oldest };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

function disk(path = process.env.DATA_DIR ?? process.cwd()): CheckResult {
  try {
    const s = statfsSync(path);
    const free = s.bavail * s.bsize;
    const total = s.blocks * s.bsize;
    const ratio = total ? free / total : 1;
    return { ok: free >= MIN_FREE_BYTES && ratio >= MIN_FREE_RATIO, freeBytes: free, freePercent: Math.round(ratio * 1000) / 10 };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/**
 * Overall status: "down" when the database is unreachable (nothing works), "degraded" when the worker
 * is behind or disk space is low (sales still work, background tasks or backups are at risk).
 */
export async function getHealth(): Promise<Health> {
  const checks = { database: await database(), worker: await worker(), disk: disk() };
  const status = !checks.database.ok ? "down" : checks.worker.ok && checks.disk.ok ? "ok" : "degraded";
  return { status, checks, uptimeSeconds: Math.round(process.uptime()), version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "dev" };
}
