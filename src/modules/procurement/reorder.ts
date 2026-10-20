import { Prisma } from "@prisma/client";
import { runInTx, tenantTransaction } from "@/lib/db";
import { addDays, dateOnly, todayStr } from "@/lib/dates";
import type { ServiceContext } from "@/modules/identity";
import { raiseOnce, resolveNotifications } from "@/modules/platform";
import { createOrder } from "./orders";

/**
 * Reorder suggestions (roadmap 7.5). For each medicine that has been stocked:
 *
 *   daily use  = units sold over the last 30 days / 30
 *   reorder at = the larger of the minimum stock and the use during the supplier's lead time
 *   order up to = the larger of twice the minimum and the use over lead time plus the cover days
 *
 * A medicine is suggested when sellable stock plus what is already on order is at or below its reorder
 * point; the quantity tops it up to the order-up-to level. The supplier is the preferred one in the
 * catalogs, else the one it was last bought from.
 */
export type Suggestion = {
  medicineId: string; name: string; unit: string; stock: number; onOrder: number; minStock: number; dailyUse: number;
  suggestedQty: number; supplierId: string | null; supplierName: string | null; lastPrice: number | null;
};

type Row = { id: string; name: string; unit: string; minStock: number; stock: bigint; sold: bigint; onOrder: bigint; supplierId: string | null; supplierName: string | null; lastPrice: Prisma.Decimal | null; leadTimeDays: number | null };

export async function reorderSuggestions(ctx: Pick<ServiceContext, "pharmacyId" | "tx">, today = todayStr()): Promise<Suggestion[]> {
  return runInTx(ctx, async (tx) => {
    const settings = await tx.pharmacySettings.findUnique({ where: { pharmacyId: ctx.pharmacyId }, select: { reorderCoverDays: true } });
    const cover = settings?.reorderCoverDays ?? 7;
    const since = dateOnly(addDays(today, -30));
    const rows = await tx.$queryRaw<Row[]>`
      WITH stock AS (
        SELECT "medicineId", COALESCE(SUM(quantity) FILTER (WHERE "expiryDate" >= ${dateOnly(today)}::date AND "setAsideAt" IS NULL), 0) AS stock, COUNT(*) AS batches
        FROM "Batch" GROUP BY "medicineId"
      ), sold AS (
        SELECT si."medicineId", SUM(si.quantity) AS sold
        FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
        WHERE s.status = 'COMPLETED' AND s."createdAt" >= ${since}
        GROUP BY si."medicineId"
      ), ordered AS (
        SELECT i."medicineId", SUM(GREATEST(i."orderedQty" - i."receivedQty", 0)) AS "onOrder"
        FROM "PurchaseOrderItem" i JOIN "PurchaseOrder" o ON o.id = i."orderId"
        WHERE o.status IN ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED')
        GROUP BY i."medicineId"
      ), last_supplier AS (
        SELECT DISTINCT ON (pi."medicineId") pi."medicineId", p."supplierId"
        FROM "PurchaseItem" pi JOIN "Purchase" p ON p.id = pi."purchaseId"
        ORDER BY pi."medicineId", p."purchaseDate" DESC, p."createdAt" DESC
      )
      SELECT m.id, m.name, m.unit, m."minStock", st.stock, COALESCE(so.sold, 0) AS sold, COALESCE(od."onOrder", 0) AS "onOrder",
             sup.id AS "supplierId", sup.name AS "supplierName", sp."lastPrice", sp."leadTimeDays"
      FROM "Medicine" m
      JOIN stock st ON st."medicineId" = m.id
      LEFT JOIN sold so ON so."medicineId" = m.id
      LEFT JOIN ordered od ON od."medicineId" = m.id
      LEFT JOIN last_supplier ls ON ls."medicineId" = m.id
      LEFT JOIN "SupplierProduct" pref ON pref."medicineId" = m.id AND pref.preferred
      LEFT JOIN "Supplier" sup ON sup.id = COALESCE(pref."supplierId", ls."supplierId") AND sup.active
      LEFT JOIN "SupplierProduct" sp ON sp."medicineId" = m.id AND sp."supplierId" = sup.id
      WHERE m.active`;
    const out: Suggestion[] = [];
    for (const r of rows) {
      const stock = Number(r.stock);
      const onOrder = Number(r.onOrder);
      const dailyUse = Number(r.sold) / 30;
      const lead = r.leadTimeDays ?? 2;
      const reorderAt = Math.max(r.minStock, Math.ceil(dailyUse * lead));
      if (reorderAt <= 0 || stock + onOrder > reorderAt) continue;
      const upTo = Math.max(r.minStock * 2, Math.ceil(dailyUse * (lead + cover)));
      const suggestedQty = upTo - stock - onOrder;
      if (suggestedQty <= 0) continue;
      out.push({
        medicineId: r.id, name: r.name, unit: r.unit, stock, onOrder, minStock: r.minStock, dailyUse: Math.round(dailyUse * 100) / 100, suggestedQty,
        supplierId: r.supplierId, supplierName: r.supplierName, lastPrice: r.lastPrice !== null ? Number(r.lastPrice) : null,
      });
    }
    return out.sort((a, b) => (a.supplierName ?? "~").localeCompare(b.supplierName ?? "~") || a.name.localeCompare(b.name));
  });
}

/** Turns chosen suggestions into one draft order per supplier. */
export async function ordersFromSuggestions(ctx: ServiceContext, picks: { medicineId: string; supplierId: string; quantity: number }[]) {
  return runInTx(ctx, async (tx) => {
    const bySupplier = new Map<string, { medicineId: string; orderedQty: number }[]>();
    for (const p of picks) bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), { medicineId: p.medicineId, orderedQty: p.quantity }]);
    const orders = [];
    for (const [supplierId, items] of bySupplier) orders.push(await createOrder({ ...ctx, tx }, { supplierId, items, source: "SUGGESTED" }));
    return orders.map((o) => ({ id: o.id, number: o.number }));
  });
}

/** Daily: one notification while anything needs reordering, resolved when nothing does. */
export async function scanReorder(pharmacyId: string, today = todayStr()) {
  const list = await reorderSuggestions({ pharmacyId }, today);
  return tenantTransaction(pharmacyId, async (tx) => {
    if (!list.length) {
      await resolveNotifications(tx, pharmacyId, ["reorder"]);
      return { raised: 0, resolved: 0, count: 0 };
    }
    const ok = await raiseOnce(tx, pharmacyId, {
      type: "REORDER", dedupeKey: "reorder", audiencePermission: "purchases.create", severity: "INFO",
      title: `${list.length} medicine${list.length === 1 ? " needs" : "s need"} reordering`,
      body: list.slice(0, 3).map((s) => s.name).join(", ") + (list.length > 3 ? " and more" : ""),
      link: "/orders?tab=reorder",
    });
    return { raised: ok ? 1 : 0, resolved: 0, count: list.length };
  });
}
