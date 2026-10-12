import { Prisma } from "@prisma/client";
import { route, readJson, pageParams } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { supplierSchema } from "@/modules/procurement";

export const GET = route("suppliers.view", async ({ req }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const where: Prisma.SupplierWhereInput = {};
  if (sp.get("active") === "1") where.active = true;
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { contactPerson: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }];
  const [total, rows] = await Promise.all([prisma.supplier.count({ where }), prisma.supplier.findMany({ where, skip, take, orderBy: { name: "asc" } })]);
  const sums = await prisma.supplierLedger.groupBy({ by: ["supplierId"], where: { supplierId: { in: rows.map((r) => r.id) } }, _sum: { debit: true, credit: true } });
  const bal = new Map(sums.map((s) => [s.supplierId, new Prisma.Decimal(s._sum.debit ?? 0).minus(s._sum.credit ?? 0)]));
  return { total, page, pageSize, items: rows.map((r) => ({ ...r, balance: bal.get(r.id) ?? new Prisma.Decimal(0) })) };
});

export const POST = route("suppliers.manage", async ({ req }) => prisma.supplier.create({ data: supplierSchema.parse(await readJson(req)) }));

export const dynamic = "force-dynamic";
