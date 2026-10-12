import type { Tx } from "@/lib/prisma";

export type CounterKey = "INVOICE" | "PURCHASE";

/**
 * Next number in a per-pharmacy series, inside the caller's tenant transaction.
 * The row lock serialises numbering within one pharmacy only; other pharmacies are never blocked.
 */
export async function nextNumber(tx: Tx, key: CounterKey): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ value: bigint }[]>`
    INSERT INTO "TenantCounter" ("pharmacyId", key, value)
    VALUES (current_setting('app.pharmacy_id', true), ${key}, 1)
    ON CONFLICT ("pharmacyId", key) DO UPDATE SET value = "TenantCounter".value + 1
    RETURNING value`;
  return row.value;
}
