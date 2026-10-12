import { route, readJson, AppError } from "@/lib/api";
import { medicineSchema, updateMedicine, deleteOrArchiveMedicine } from "@/modules/catalog";
import { sellableStock } from "@/modules/inventory";

export const GET = route("medicines.view", async ({ params, svc, db }) => {
  const med = await db.medicine.findUnique({
    where: { id: params.id },
    include: { category: true, batches: { orderBy: { expiryDate: "asc" } } },
  });
  if (!med) throw new AppError(404, "Medicine not found.");
  const stock = (await sellableStock(svc, [med.id])).get(med.id) ?? 0;
  return { ...med, stock };
});

export const PUT = route("medicines.manage", async ({ req, params, svc }) =>
  updateMedicine(svc, params.id, medicineSchema.parse(await readJson(req))),
);

export const DELETE = route("medicines.delete", async ({ params, svc }) => deleteOrArchiveMedicine(svc, params.id));

export const dynamic = "force-dynamic";
