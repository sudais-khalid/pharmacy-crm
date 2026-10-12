import { route, AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = route("sales.view", async ({ params }) => {
  const sale = await prisma.sale.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      user: { select: { name: true } },
      items: { include: { medicine: { select: { name: true, unit: true } }, batch: { select: { batchNumber: true, expiryDate: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!sale) throw new AppError(404, "Invoice not found.");
  return sale;
});

export const dynamic = "force-dynamic";
