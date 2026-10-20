import { runInTx } from "@/lib/db";
import { can, type ServiceContext } from "@/modules/identity";

/**
 * Global search (roadmap 6.7) for the Ctrl+K palette: medicines, customers, suppliers, invoices, stock
 * entries and batches, each only for people who may see them. Contains-matches use the trigram indexes.
 */
export type SearchHit = { kind: "medicine" | "customer" | "supplier" | "invoice" | "stockEntry" | "batch"; id: string; title: string; detail: string; href: string };

export async function globalSearch(ctx: ServiceContext, raw: string, limit = 5): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const has = (p: Parameters<typeof can>[1]) => can(ctx.actor, p);
  const contains = { contains: q, mode: "insensitive" as const };
  return runInTx(ctx, async (tx) => {
    const [medicines, customers, suppliers, invoices, entries, batches] = await Promise.all([
      has("medicines.view")
        ? tx.medicine.findMany({ where: { active: true, OR: [{ name: contains }, { genericName: contains }, { barcode: q }, { sku: { equals: q, mode: "insensitive" } }] }, orderBy: { name: "asc" }, take: limit, select: { id: true, name: true, genericName: true, unit: true } })
        : [],
      has("customers.view")
        ? tx.customer.findMany({ where: { OR: [{ name: contains }, { phone: { contains: q } }] }, orderBy: { name: "asc" }, take: limit, select: { id: true, name: true, phone: true } })
        : [],
      has("suppliers.view") ? tx.supplier.findMany({ where: { name: contains }, orderBy: { name: "asc" }, take: limit, select: { id: true, name: true, phone: true } }) : [],
      has("sales.view") && /\d/.test(q)
        ? tx.sale.findMany({ where: { invoiceNo: contains, ...(has("sales.viewAll") ? {} : { userId: ctx.actor.id }) }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, invoiceNo: true, total: true, createdAt: true } })
        : [],
      has("stockEntry.create") && /\d/.test(q)
        ? tx.stockIntake.findMany({ where: { OR: [{ number: contains }, { supplierInvoice: contains }] }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, number: true, supplierInvoice: true, status: true } })
        : [],
      has("inventory.view") && /\d/.test(q)
        ? tx.batch.findMany({ where: { batchNumber: contains }, orderBy: { expiryDate: "asc" }, take: limit, select: { id: true, batchNumber: true, quantity: true, medicine: { select: { id: true, name: true } } } })
        : [],
    ]);
    return [
      ...medicines.map((m) => ({ kind: "medicine" as const, id: m.id, title: m.name, detail: [m.genericName, m.unit].filter(Boolean).join(", "), href: `/medicines/${m.id}` })),
      ...customers.map((c) => ({ kind: "customer" as const, id: c.id, title: c.name, detail: c.phone ?? "Customer", href: `/customers/${c.id}` })),
      ...suppliers.map((s) => ({ kind: "supplier" as const, id: s.id, title: s.name, detail: s.phone ?? "Supplier", href: `/suppliers/${s.id}` })),
      ...invoices.map((i) => ({ kind: "invoice" as const, id: i.id, title: i.invoiceNo, detail: `Invoice, ${Number(i.total).toFixed(2)}`, href: `/invoice/${i.id}` })),
      ...entries.map((e) => ({ kind: "stockEntry" as const, id: e.id, title: e.number, detail: [e.supplierInvoice && `bill ${e.supplierInvoice}`, e.status.toLowerCase().replace("_", " ")].filter(Boolean).join(", "), href: `/stock-entry/${e.id}` })),
      ...batches.map((b) => ({ kind: "batch" as const, id: b.id, title: `Batch ${b.batchNumber}`, detail: `${b.medicine.name}, ${b.quantity} in stock`, href: `/medicines/${b.medicine.id}?batch=${b.id}` })),
    ];
  });
}
