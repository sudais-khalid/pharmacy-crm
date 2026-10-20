import { route, AppError } from "@/lib/api";

/** Purchase history of one medicine (price history) and its suppliers, newest first. Cost fields are stripped without cost.view. */
export const GET = route("purchases.view", async ({ params, db }) => {
  const medicine = await db.medicine.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!medicine) throw new AppError(404, "Medicine not found.");
  const lines = await db.purchaseItem.findMany({
    where: { medicineId: medicine.id }, orderBy: [{ purchase: { purchaseDate: "desc" } }, { id: "desc" }], take: 100,
    select: {
      id: true, batchNumber: true, quantity: true, bonusQty: true, purchasePrice: true, discountPercent: true, effectiveCost: true, salePrice: true,
      purchase: { select: { id: true, number: true, purchaseDate: true, supplierInvoice: true, supplier: { select: { id: true, name: true } } } },
    },
  });
  const bySupplier = new Map<string, { id: string; name: string; purchases: number; units: number; lastDate: Date; lastRate: unknown }>();
  for (const l of lines) {
    const s = l.purchase.supplier;
    const row = bySupplier.get(s.id) ?? { id: s.id, name: s.name, purchases: 0, units: 0, lastDate: l.purchase.purchaseDate, lastRate: l.purchasePrice };
    row.purchases++;
    row.units += l.quantity + l.bonusQty;
    bySupplier.set(s.id, row);
  }
  return { lines, suppliers: [...bySupplier.values()].map(({ lastRate, ...s }) => ({ ...s, purchasePrice: lastRate })) };
});

export const dynamic = "force-dynamic";
