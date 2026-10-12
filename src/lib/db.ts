import { prisma, type Tx } from "./prisma";

export type Db = Tx | typeof prisma;

/**
 * Data access context passed to every service call.
 * `pharmacyId` scopes the call to one tenant (enforced from Phase 1); `tx` lets a caller
 * compose several service calls into one transaction.
 */
export type DbContext = { pharmacyId: string | null; tx?: Tx };

/** Runs `fn` inside the caller's transaction when there is one, otherwise in a new transaction. */
export function runInTx<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return ctx.tx ? fn(ctx.tx) : prisma.$transaction(fn);
}

/** Client for reads: the caller's transaction when there is one, otherwise the shared client. */
export function dbOf(ctx: DbContext): Db {
  return ctx.tx ?? prisma;
}
