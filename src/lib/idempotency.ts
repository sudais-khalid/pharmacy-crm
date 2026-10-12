import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./prisma";
import { tenantTransaction } from "./db";
import { AppError } from "./errors";
import { toJson } from "./json";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const KEY_FORMAT = /^[A-Za-z0-9_-]{8,200}$/;
const RETENTION_HOURS = 24;

export type IdempotentResult = { body: unknown; replayed: boolean };

/**
 * Runs a write at most once per (actor, key).
 *
 * The key row is inserted first, inside the same transaction as the write, and the response is stored
 * before commit. So the write and its stored response commit together, and a concurrent duplicate
 * blocks on the key's unique index until the first request finishes, then replays its response.
 * Failed requests store nothing, so the client may retry them with the same key.
 */
export async function withIdempotency(
  opts: { key: string; actorId: string; pharmacyId: string; route: string; rawBody: string },
  run: (tx: Tx) => Promise<unknown>,
): Promise<IdempotentResult> {
  if (!KEY_FORMAT.test(opts.key)) throw new AppError(400, "Idempotency-Key must be 8 to 200 letters, digits, '-' or '_'.");
  const requestHash = createHash("sha256").update(`${opts.route}\n${opts.rawBody}`).digest("hex");
  const id = { actorId_key: { actorId: opts.actorId, key: opts.key } };

  const replay = async (): Promise<IdempotentResult | null> => {
    const row = await prisma.idempotencyKey.findUnique({ where: id });
    if (!row) return null;
    if (row.requestHash !== requestHash) throw new AppError(422, "This Idempotency-Key was already used for a different request.");
    return { body: row.response, replayed: true };
  };

  const earlier = await replay();
  if (earlier) return earlier;

  try {
    return await tenantTransaction(opts.pharmacyId, async (tx) => {
      await tx.idempotencyKey.create({
        data: { actorId: opts.actorId, key: opts.key, route: opts.route, requestHash, status: 200, response: {} },
      });
      const body = toJson(await run(tx));
      await tx.idempotencyKey.update({ where: id, data: { response: body } });
      return { body, replayed: false };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const concurrent = await replay();
      if (concurrent) return concurrent;
    }
    throw e;
  }
}

/** Deletes stored responses older than the retention window. Scheduled by the worker. */
export async function purgeIdempotencyKeys(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_HOURS * 3600 * 1000);
  const { count } = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
