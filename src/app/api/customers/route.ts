import { Prisma } from "@prisma/client";
import { route, readJson, pageParams } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { customerSchema } from "@/lib/schemas";

export const GET = route("customers.view", async ({ req }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const where: Prisma.CustomerWhereInput = {};
  if (sp.get("active") === "1") where.active = true;
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }];
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, skip, take, orderBy: { name: "asc" } }),
  ]);
  const sums = await prisma.customerLedger.groupBy({ by: ["customerId"], where: { customerId: { in: rows.map((r) => r.id) } }, _sum: { debit: true, credit: true } });
  const bal = new Map(sums.map((s) => [s.customerId, new Prisma.Decimal(s._sum.debit ?? 0).minus(s._sum.credit ?? 0)]));
  return { total, page, pageSize, items: rows.map((r) => ({ ...r, balance: bal.get(r.id) ?? new Prisma.Decimal(0) })) };
});

export const POST = route("customers.manage", async ({ req }) => prisma.customer.create({ data: customerSchema.parse(await readJson(req)) }));

export const dynamic = "force-dynamic";
