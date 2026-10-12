import { prisma } from "@/lib/prisma";
import type { DomainEvents, EventType } from "./events";

export type OutboxEvent<T extends EventType = EventType> = { id: bigint; type: T; payload: DomainEvents[T]; attempts: number };
export type OutboxHandler<T extends EventType = EventType> = (event: OutboxEvent<T>) => Promise<void>;
/** Handlers per event type. Delivery is at least once, so every handler must be idempotent. */
export type OutboxHandlers = { [T in EventType]?: OutboxHandler<T>[] };

/** An event is retried this many times, then parked for the developer console. */
export const OUTBOX_MAX_ATTEMPTS = 10;
const LEASE_SECONDS = 60;

/** Exponential backoff: 5 s, 10 s, 20 s ... capped at one hour. */
export function outboxBackoffMs(attempts: number) {
  return Math.min(5000 * 2 ** Math.max(0, attempts - 1), 3600 * 1000);
}

type Row = { id: bigint; type: string; payload: unknown; attempts: number };

/**
 * Claims due events, runs their handlers and records the outcome.
 * Claiming leases each event for a minute (FOR UPDATE SKIP LOCKED), so several dispatchers never
 * deliver the same event at once, and a crashed dispatcher's events become due again after the lease.
 */
export async function dispatchOutbox(handlers: OutboxHandlers, opts: { batchSize?: number } = {}) {
  const batchSize = opts.batchSize ?? 50;
  const claimed = await prisma.$queryRaw<Row[]>`
    UPDATE "OutboxEvent" SET "availableAt" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${LEASE_SECONDS})
    WHERE id IN (
      SELECT id FROM "OutboxEvent"
      WHERE "processedAt" IS NULL AND "availableAt" <= (now() AT TIME ZONE 'UTC') AND attempts < ${OUTBOX_MAX_ATTEMPTS}
      ORDER BY id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts`;

  let delivered = 0;
  let failed = 0;
  for (const row of claimed.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const event = row as OutboxEvent;
    try {
      const list = (handlers[event.type] ?? []) as OutboxHandler[];
      for (const handle of list) await handle(event);
      await prisma.outboxEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), lastError: null } });
      delivered++;
    } catch (e) {
      const attempts = row.attempts + 1;
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: { attempts, lastError: String(e instanceof Error ? e.stack ?? e.message : e).slice(0, 2000), availableAt: new Date(Date.now() + outboxBackoffMs(attempts)) },
      });
      failed++;
    }
  }
  return { claimed: claimed.length, delivered, failed };
}
