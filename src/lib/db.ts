import { prisma, type Tx } from "./prisma";

export type Db = Tx | typeof prisma;

/**
 * Data access context passed to every service call. `pharmacyId` scopes the work to one tenant;
 * `tx` lets a caller compose several service calls into one transaction.
 */
export type DbContext = { pharmacyId: string; tx?: Tx };

/** Default limits for request transactions: wait up to 10 s for a connection, run up to 20 s. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/**
 * Runs `fn` in a transaction scoped to one pharmacy. The tenant id is set transaction-locally
 * (`app.pharmacy_id`), which column defaults and row-level security policies read.
 */
export function tenantTransaction<T>(pharmacyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!pharmacyId) throw new Error("tenantTransaction needs a pharmacy id");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.pharmacy_id', ${pharmacyId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/** Runs `fn` inside the caller's transaction when there is one, otherwise in a new tenant transaction. */
export function runInTx<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return ctx.tx ? fn(ctx.tx) : tenantTransaction(ctx.pharmacyId, fn);
}
