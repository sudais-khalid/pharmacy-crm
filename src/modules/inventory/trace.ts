import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { ServiceContext } from "@/modules/identity";

/**
 * Batch trace for recalls (roadmap 6.6): where a batch came from (purchases and stock entries, opening
 * stock) and where it went (invoices with the customer's name and phone, returns, write-offs).
 */
export async function batchTrace(ctx: ServiceContext, batchId: string) {
  return runInTx(ctx, async (tx) => {
    const batch = await tx.batch.findUnique({ where: { id: batchId }, include: { medicine: { select: { id: true, name: true, genericName: true, unit: true } } } });
    if (!batch) throw new AppError(404, "Batch not found.");
    const [purchases, sales, returns, movements] = await Promise.all([
      tx.purchaseItem.findMany({
        where: { batchId }, orderBy: { id: "asc" },
        select: { id: true, quantity: true, bonusQty: true, purchase: { select: { id: true, number: true, purchaseDate: true, supplierInvoice: true, supplier: { select: { id: true, name: true } }, intake: { select: { id: true, number: true } } } } },
      }),
      tx.saleItem.findMany({
        where: { batchId }, orderBy: { sale: { createdAt: "asc" } },
        select: {
          id: true, quantity: true, returns: { select: { quantity: true } },
          sale: { select: { id: true, invoiceNo: true, createdAt: true, status: true, customerName: true, customerPhone: true, customer: { select: { id: true, name: true, phone: true } } } },
        },
      }),
      tx.saleReturnItem.findMany({ where: { batchId }, select: { quantity: true, restock: true, saleReturn: { select: { id: true, number: true, createdAt: true } } } }),
      tx.stockMovement.findMany({
        where: { batchId, type: { in: ["OPENING", "ADJUSTMENT", "DAMAGE", "EXPIRY", "SUPPLIER_RETURN"] } }, orderBy: { createdAt: "asc" },
        select: { id: true, type: true, quantity: true, reference: true, note: true, createdAt: true, user: { select: { name: true } } },
      }),
    ]);
    const completed = sales.filter((s) => s.sale.status === "COMPLETED");
    const sold = completed.reduce((n, s) => n + s.quantity, 0);
    const returned = returns.reduce((n, r) => n + r.quantity, 0);
    // who to call in a recall: everyone who still has some of it
    const holders = new Map<string, { name: string; phone: string | null; quantity: number }>();
    for (const s of completed) {
      const left = s.quantity - s.returns.reduce((n, r) => n + r.quantity, 0);
      if (left <= 0) continue;
      const name = s.sale.customer?.name ?? s.sale.customerName ?? "Walk-in customer";
      const phone = s.sale.customer?.phone ?? s.sale.customerPhone ?? null;
      const key = s.sale.customer?.id ?? (phone ? `phone:${phone}` : `sale:${s.sale.id}`);
      const h = holders.get(key) ?? { name, phone, quantity: 0 };
      h.quantity += left;
      holders.set(key, h);
    }
    return {
      batch,
      purchased: purchases.reduce((n, p) => n + p.quantity + (p.bonusQty ?? 0), 0),
      sold, returned, inStock: batch.quantity,
      purchases, sales: sales.map(({ returns: r, ...s }) => ({ ...s, returnedQty: r.reduce((n, x) => n + x.quantity, 0) })),
      returns, movements,
      holders: [...holders.values()].sort((a, b) => b.quantity - a.quantity),
    };
  });
}
