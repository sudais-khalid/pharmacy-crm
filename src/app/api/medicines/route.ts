import { Prisma } from "@prisma/client";
import { route, readJson, pageParams } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { medicineSchema } from "@/lib/schemas";
import { createMedicine } from "@/services/medicines";
import { sellableStock } from "@/services/inventory";
import { todayStr, dateOnly } from "@/lib/dates";

export const GET = route("medicines.view", async ({ req }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const categoryId = sp.get("categoryId");
  const status = sp.get("status") || "active";
  const stockFilter = sp.get("stock");
  const sort = sp.get("sort") || "name";

  const where: Prisma.MedicineWhereInput = {};
  if (status === "active") where.active = true;
  if (status === "archived") where.active = false;
  if (categoryId) where.categoryId = categoryId;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { genericName: { contains: q, mode: "insensitive" } },
      { barcode: { contains: q } },
      { sku: { contains: q, mode: "insensitive" } },
    ];
  }

  if (stockFilter === "low" || stockFilter === "out") {
    const candidates = await prisma.medicine.findMany({ where, select: { id: true, minStock: true } });
    const stock = await sellableStock(candidates.map((c) => c.id));
    const ids = candidates
      .filter((c) => {
        const s = stock.get(c.id) ?? 0;
        return stockFilter === "out" ? s === 0 : s <= c.minStock;
      })
      .map((c) => c.id);
    where.id = { in: ids };
  }

  const orderBy: Prisma.MedicineOrderByWithRelationInput =
    sort === "salePrice" ? { salePrice: "desc" } : sort === "newest" ? { createdAt: "desc" } : { name: "asc" };

  const [total, rows] = await Promise.all([
    prisma.medicine.count({ where }),
    prisma.medicine.findMany({ where, orderBy, skip, take, include: { category: { select: { id: true, name: true } } } }),
  ]);
  const ids = rows.map((r) => r.id);
  const stock = await sellableStock(ids);
  const expired = await prisma.batch.groupBy({
    by: ["medicineId"],
    where: { medicineId: { in: ids }, expiryDate: { lt: dateOnly(todayStr()) }, quantity: { gt: 0 } },
    _sum: { quantity: true },
  });
  const expMap = new Map(expired.map((e) => [e.medicineId, e._sum.quantity ?? 0]));
  return { total, page, pageSize, items: rows.map((r) => ({ ...r, stock: stock.get(r.id) ?? 0, expiredStock: expMap.get(r.id) ?? 0 })) };
});

export const POST = route("medicines.manage", async ({ req, user }) => {
  const data = medicineSchema.parse(await readJson(req));
  return createMedicine(data, user.id);
});

export const dynamic = "force-dynamic";
