import { route, AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = route("purchases.view", async ({ params }) => {
  const p = await prisma.purchase.findUnique({
    where: { id: params.id },
    include: { supplier: true, user: { select: { name: true } }, items: { include: { medicine: { select: { name: true } } } } },
  });
  if (!p) throw new AppError(404, "Purchase not found.");
  return p;
});

export const dynamic = "force-dynamic";
