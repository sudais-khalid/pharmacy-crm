import { Prisma } from "@prisma/client";
import { tenantTransaction } from "@/lib/db";
import { addDays, dateOnly, todayStr } from "@/lib/dates";
import { raiseOnce, resolveStale } from "@/modules/platform";

/**
 * Stock intelligence alerts (roadmap 6.2). The worker runs these per active pharmacy; each condition is
 * one notification (raised once, de-duplicated by key) that resolves itself when the condition clears:
 *
 *   expiry   a batch with stock enters the alert window (expiryAlertDays, default 30), then 7 days, then expires
 *   stock    a medicine that has been stocked falls to its minimum, or runs out
 */

export const EXPIRY_TYPES = ["EXPIRY_SOON", "EXPIRY_7", "EXPIRED"] as const;
export const STOCK_TYPES = ["LOW_STOCK", "OUT_OF_STOCK"] as const;
const DAY = 86_400_000;

export async function scanExpiry(pharmacyId: string, today = todayStr()) {
  return tenantTransaction(pharmacyId, async (tx) => {
    const settings = await tx.pharmacySettings.findUnique({ where: { pharmacyId }, select: { expiryAlertDays: true } });
    const window = settings?.expiryAlertDays ?? 30;
    const batches = await tx.batch.findMany({
      // batches already set aside for the supplier are handled
      where: { quantity: { gt: 0 }, expiryDate: { lte: dateOnly(addDays(today, window)) }, setAsideAt: null, medicine: { active: true } },
      select: { id: true, batchNumber: true, expiryDate: true, quantity: true, medicine: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    });
    const still = new Set<string>();
    let raised = 0;
    for (const b of batches) {
      const daysLeft = Math.round((b.expiryDate.getTime() - dateOnly(today).getTime()) / DAY);
      const type = daysLeft < 0 ? "EXPIRED" : daysLeft <= 7 ? "EXPIRY_7" : "EXPIRY_SOON";
      const dedupeKey = `expiry:${b.id}:${type}`;
      still.add(dedupeKey);
      const when = daysLeft < 0 ? "has expired" : daysLeft === 0 ? "expires today" : `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
      const ok = await raiseOnce(tx, pharmacyId, {
        type, dedupeKey, audiencePermission: "inventory.view",
        severity: type === "EXPIRED" ? "CRITICAL" : "WARNING",
        title: `${b.medicine.name}, batch ${b.batchNumber}, ${when}`,
        body: `${b.quantity} in stock. ${type === "EXPIRED" ? "Write it off or set it aside for the supplier." : "Sell it first, or plan a return to the supplier."}`,
        link: `/inventory?tab=expiry&batch=${b.id}`,
      });
      if (ok) raised++;
    }
    // sold out, written off, or moved on to the next stage
    const resolved = await resolveStale(tx, pharmacyId, [...EXPIRY_TYPES], still);
    return { raised, open: still.size, resolved };
  });
}

type StockRow = { id: string; name: string; minStock: number; stock: bigint };

export async function scanStock(pharmacyId: string, today = todayStr(), medicineIds?: string[]) {
  return tenantTransaction(pharmacyId, async (tx) => {
    const only = medicineIds?.length ? Prisma.sql`AND m.id IN (${Prisma.join(medicineIds)})` : Prisma.empty;
    // sellable stock (batches not yet expired) for every medicine with a minimum that has ever been stocked
    // (a catalogue item never bought is not "out of stock")
    const rows = await tx.$queryRaw<StockRow[]>`
      SELECT m.id, m.name, m."minStock", COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${dateOnly(today)}::date AND b."setAsideAt" IS NULL), 0) AS stock
      FROM "Medicine" m LEFT JOIN "Batch" b ON b."medicineId" = m.id
      WHERE m.active AND m."minStock" > 0 ${only}
      GROUP BY m.id, m.name, m."minStock"
      HAVING COUNT(b.id) > 0`;
    const still = new Set<string>();
    let raised = 0;
    for (const r of rows) {
      const stock = Number(r.stock);
      if (stock > r.minStock) continue;
      const type = stock === 0 ? "OUT_OF_STOCK" : "LOW_STOCK";
      const dedupeKey = `stock:${r.id}:${type}`;
      still.add(dedupeKey);
      const ok = await raiseOnce(tx, pharmacyId, {
        type, dedupeKey, audiencePermission: "inventory.view",
        severity: type === "OUT_OF_STOCK" ? "CRITICAL" : "WARNING",
        title: type === "OUT_OF_STOCK" ? `${r.name} is out of stock` : `${r.name} is low: ${stock} left`,
        body: `Minimum ${r.minStock}.`,
        link: `/medicines/${r.id}`,
      });
      if (ok) raised++;
    }
    // a partial scan (after a sale) may only resolve what it looked at
    const keep = medicineIds?.length
      ? new Set([...still, ...(await tx.notification.findMany({ where: { pharmacyId, type: { in: [...STOCK_TYPES] }, resolvedAt: null }, select: { dedupeKey: true } }))
        .map((n) => n.dedupeKey).filter((k) => !medicineIds.includes(k.split(":")[1]))])
      : still;
    const resolved = await resolveStale(tx, pharmacyId, [...STOCK_TYPES], keep);
    return { raised, open: still.size, resolved };
  });
}
