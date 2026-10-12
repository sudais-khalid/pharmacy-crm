import { Prisma } from "@prisma/client";
import { route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { todayStr, dateOnly } from "@/lib/dates";

export const GET = route("pos.use", async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const where: Prisma.MedicineWhereInput = { active: true };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { genericName: { contains: q, mode: "insensitive" } },
      { barcode: q },
      { sku: { equals: q, mode: "insensitive" } },
    ];
  }
  let meds = await prisma.medicine.findMany({ where, orderBy: { name: "asc" }, take: 15 });
  // exact barcode match first so a scanner hit is always the top result
  meds = [...meds.filter((m) => m.barcode === q), ...meds.filter((m) => m.barcode !== q)];
  const batches = await prisma.batch.findMany({
    where: { medicineId: { in: meds.map((m) => m.id) }, quantity: { gt: 0 }, expiryDate: { gte: dateOnly(todayStr()) } },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
  });
  return meds.map((m) => {
    const bs = batches.filter((b) => b.medicineId === m.id);
    return {
      id: m.id, name: m.name, genericName: m.genericName, barcode: m.barcode, unit: m.unit, prescriptionRequired: m.prescriptionRequired,
      stock: bs.reduce((s, b) => s + b.quantity, 0),
      price: bs[0]?.salePrice ?? m.salePrice,
      nextExpiry: bs[0]?.expiryDate ?? null,
      exactBarcode: !!q && m.barcode === q,
    };
  });
});

export const dynamic = "force-dynamic";
