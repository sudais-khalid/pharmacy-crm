import { Prisma } from "@prisma/client";
import { route, pageParams } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { todayStr, addDays, dateOnly } from "@/lib/dates";

export const GET = route("inventory.view", async ({ req }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const filter = sp.get("filter") || "instock"; // instock | expiring | expired | empty | all
  const setting = await prisma.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const days = parseInt(sp.get("days") || "", 10) || setting.expiryWarningDays;
  const today = todayStr();

  const where: Prisma.BatchWhereInput = {};
  if (filter === "instock") Object.assign(where, { quantity: { gt: 0 }, expiryDate: { gte: dateOnly(today) } });
  if (filter === "expiring") Object.assign(where, { quantity: { gt: 0 }, expiryDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, days)) } });
  if (filter === "expired") Object.assign(where, { quantity: { gt: 0 }, expiryDate: { lt: dateOnly(today) } });
  if (filter === "empty") where.quantity = 0;
  if (q) where.OR = [{ batchNumber: { contains: q, mode: "insensitive" } }, { medicine: { name: { contains: q, mode: "insensitive" } } }, { medicine: { genericName: { contains: q, mode: "insensitive" } } }];

  const [total, rows, agg] = await Promise.all([
    prisma.batch.count({ where }),
    prisma.batch.findMany({ where, skip, take, orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }], include: { medicine: { select: { id: true, name: true, genericName: true, unit: true } } } }),
    prisma.$queryRaw<{ units: number; cost: Prisma.Decimal; retail: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(quantity),0)::int AS units, COALESCE(SUM(quantity*"purchasePrice"),0) AS cost, COALESCE(SUM(quantity*"salePrice"),0) AS retail
      FROM "Batch" WHERE "expiryDate" >= ${today}::date AND quantity > 0`,
  ]);
  const todayMs = dateOnly(today).getTime();
  return {
    total, page, pageSize, warningDays: days,
    summary: { units: agg[0].units, stockValueCost: agg[0].cost, stockValueRetail: agg[0].retail },
    items: rows.map((b) => ({ ...b, daysLeft: Math.round((b.expiryDate.getTime() - todayMs) / 86400000) })),
  };
});

export const dynamic = "force-dynamic";
