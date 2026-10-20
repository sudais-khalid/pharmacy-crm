import type { Tx } from "@/lib/prisma";

export type CounterKey = "INVOICE" | "PURCHASE" | "STOCK_ENTRY" | "RETURN" | "PURCHASE_ORDER" | "SUPPLIER_RETURN";

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

/** Usage counters (for example OCR pages per month): adds `n` and returns the new total. */
export async function addUsage(tx: Tx, key: `USAGE_${string}`, n: number): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: bigint }[]>`
    INSERT INTO "TenantCounter" ("pharmacyId", key, value)
    VALUES (current_setting('app.pharmacy_id', true), ${key}, ${n})
    ON CONFLICT ("pharmacyId", key) DO UPDATE SET value = "TenantCounter".value + ${n}
    RETURNING value`;
  return Number(row.value);
}

export async function readUsage(tx: Tx, key: `USAGE_${string}`): Promise<number> {
  const row = await tx.tenantCounter.findFirst({ where: { key }, select: { value: true } });
  return row ? Number(row.value) : 0;
}
