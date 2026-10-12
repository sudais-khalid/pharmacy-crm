import { route, readJson, AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { medicineSchema, deleteOrArchiveMedicine } from "@/modules/catalog";
import { sellableStock } from "@/modules/inventory";

export const GET = route("medicines.view", async ({ params, svc }) => {
  const med = await prisma.medicine.findUnique({
    where: { id: params.id },
    include: { category: true, batches: { orderBy: { expiryDate: "asc" } } },
  });
  if (!med) throw new AppError(404, "Medicine not found.");
  const stock = (await sellableStock(svc, [med.id])).get(med.id) ?? 0;
  return { ...med, stock };
});

export const PUT = route("medicines.manage", async ({ req, params }) => {
  const { opening: _opening, ...data } = medicineSchema.parse(await readJson(req));
  return prisma.medicine.update({ where: { id: params.id }, data: { ...data, categoryId: data.categoryId || null } });
});

export const DELETE = route("medicines.delete", async ({ params, svc }) => deleteOrArchiveMedicine(svc, params.id));

export const dynamic = "force-dynamic";
