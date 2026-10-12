import { Prisma, MovementType } from "@prisma/client";
import { route, pageParams } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = route("inventory.view", async ({ req }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const type = sp.get("type");
  const where: Prisma.StockMovementWhereInput = {};
  if (type && type in MovementType) where.type = type as MovementType;
  if (q) where.OR = [{ medicine: { name: { contains: q, mode: "insensitive" } } }, { batch: { batchNumber: { contains: q, mode: "insensitive" } } }, { reference: { contains: q, mode: "insensitive" } }];
  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where, skip, take, orderBy: { createdAt: "desc" },
      include: { medicine: { select: { name: true } }, batch: { select: { batchNumber: true } }, user: { select: { name: true } } },
    }),
  ]);
  return { total, page, pageSize, items };
});

export const dynamic = "force-dynamic";
