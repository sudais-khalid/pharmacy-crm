import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D } from "@/lib/money";
import { createMedicine, type MedicineInput } from "@/modules/catalog";
import type { ServiceContext } from "@/modules/identity";
import { audit } from "@/modules/platform";

/**
 * Supplier catalogs (roadmap 7.1 to 7.3; data model, section 4.1): which medicines a supplier sells, under
 * which of its own codes, at what price and bonus. Pharmacists keep it; every posted purchase refreshes
 * the last price and bonus, and the codes help match bill photos.
 */
export type CatalogInput = {
  medicineId?: string | null;
  newMedicine?: MedicineInput | null;
  supplierCode?: string | null;
  packSize?: string | null;
  lastPrice?: number | null;
  lastBonusRule?: string | null;
  leadTimeDays?: number;
  preferred?: boolean;
};

const catalogInclude = { medicine: { select: { id: true, name: true, genericName: true, unit: true, salePrice: true, minStock: true, active: true } } } satisfies Prisma.SupplierProductInclude;

export async function listCatalog(ctx: ServiceContext, supplierId: string, q?: string) {
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    return tx.supplierProduct.findMany({
      where: { supplierId, ...(q ? { OR: [{ medicine: { name: { contains: q, mode: "insensitive" } } }, { supplierCode: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: { medicine: { name: "asc" } },
      include: catalogInclude,
      take: 500,
    });
  });
}

/** Adds a medicine to a supplier's catalog, or updates its entry; a brand-new medicine is created in the same step. */
export async function saveCatalogItem(ctx: ServiceContext, supplierId: string, input: CatalogInput) {
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    let medicineId = input.medicineId ?? null;
    if (!medicineId && input.newMedicine) medicineId = (await createMedicine({ ...ctx, tx }, input.newMedicine)).id;
    if (!medicineId) throw new AppError(400, "Choose a medicine or add a new one.");
    const medicine = await tx.medicine.findUnique({ where: { id: medicineId }, select: { id: true, name: true } });
    if (!medicine) throw new AppError(404, "Medicine not found.");
    const code = input.supplierCode?.trim() || null;
    if (code) {
      const clash = await tx.supplierProduct.findFirst({ where: { supplierId, supplierCode: code, medicineId: { not: medicineId } }, include: { medicine: { select: { name: true } } } });
      if (clash) throw new AppError(409, `Code ${code} is already used for ${clash.medicine.name} at ${supplier.name}.`, { fields: { supplierCode: "Already used" } });
    }
    // one preferred supplier per medicine
    if (input.preferred) await tx.supplierProduct.updateMany({ where: { medicineId, preferred: true, supplierId: { not: supplierId } }, data: { preferred: false } });
    const data = {
      supplierCode: code, packSize: input.packSize?.trim() || null,
      lastPrice: input.lastPrice != null ? D(input.lastPrice).toDecimalPlaces(2) : null, lastBonusRule: input.lastBonusRule?.trim() || null,
      leadTimeDays: input.leadTimeDays ?? 2, preferred: input.preferred ?? false,
    };
    const before = await tx.supplierProduct.findUnique({ where: { pharmacyId_supplierId_medicineId: { pharmacyId: ctx.pharmacyId, supplierId, medicineId } } });
    const item = await tx.supplierProduct.upsert({
      where: { pharmacyId_supplierId_medicineId: { pharmacyId: ctx.pharmacyId, supplierId, medicineId } },
      create: { supplierId, medicineId, ...data },
      update: data,
      include: catalogInclude,
    });
    await audit(tx, ctx, { action: before ? "supplierCatalog.update" : "supplierCatalog.add", entity: "Supplier", entityId: supplierId, before: before ?? null, after: { medicine: medicine.name, ...data } });
    return item;
  });
}

export async function removeCatalogItem(ctx: ServiceContext, supplierId: string, itemId: string) {
  return runInTx(ctx, async (tx) => {
    const item = await tx.supplierProduct.findFirst({ where: { id: itemId, supplierId }, include: { medicine: { select: { name: true } } } });
    if (!item) throw new AppError(404, "Catalog entry not found.");
    await tx.supplierProduct.delete({ where: { id: item.id } });
    await audit(tx, ctx, { action: "supplierCatalog.remove", entity: "Supplier", entityId: supplierId, before: { medicine: item.medicine.name, supplierCode: item.supplierCode } });
    return { ok: true };
  });
}

export type CatalogImportRow = { name: string; supplierCode?: string | null; barcode?: string | null; lastPrice?: number | null; packSize?: string | null; lastBonusRule?: string | null };

/**
 * A supplier's price list from a file (roadmap 7.2): each row is matched to a medicine by barcode, the
 * supplier code already in the catalog, or the exact name; matched rows update the catalog, the rest are
 * returned for the pharmacist to link or add.
 */
export async function importCatalog(ctx: ServiceContext, supplierId: string, rows: CatalogImportRow[]) {
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    let updated = 0;
    const unmatched: CatalogImportRow[] = [];
    for (const row of rows) {
      const code = row.supplierCode?.trim() || null;
      let medicineId: string | null = null;
      if (row.barcode) medicineId = (await tx.medicine.findFirst({ where: { barcode: row.barcode.trim(), active: true }, select: { id: true } }))?.id ?? null;
      if (!medicineId && code) medicineId = (await tx.supplierProduct.findFirst({ where: { supplierId, supplierCode: code }, select: { medicineId: true } }))?.medicineId ?? null;
      if (!medicineId) medicineId = (await tx.medicine.findFirst({ where: { name: { equals: row.name.trim(), mode: "insensitive" }, active: true }, select: { id: true } }))?.id ?? null;
      if (!medicineId) { unmatched.push(row); continue; }
      const data = {
        ...(code ? { supplierCode: code } : {}), ...(row.packSize ? { packSize: row.packSize } : {}),
        ...(row.lastPrice != null ? { lastPrice: D(row.lastPrice).toDecimalPlaces(2) } : {}), ...(row.lastBonusRule ? { lastBonusRule: row.lastBonusRule } : {}),
      };
      await tx.supplierProduct.upsert({
        where: { pharmacyId_supplierId_medicineId: { pharmacyId: ctx.pharmacyId, supplierId, medicineId } },
        create: { supplierId, medicineId, ...data },
        update: data,
      });
      updated++;
    }
    await audit(tx, ctx, { action: "supplierCatalog.import", entity: "Supplier", entityId: supplierId, after: { rows: rows.length, updated, unmatched: unmatched.length } });
    return { updated, unmatched };
  });
}

/** After a purchase: the supplier's last price and bonus for each medicine (and the medicine joins its catalog). */
export async function refreshCatalogFromPurchase(tx: Tx, pharmacyId: string, supplierId: string, lines: { medicineId: string; purchasePrice: number; quantity: number; bonus: number }[]) {
  for (const l of lines) {
    const data = { lastPrice: D(l.purchasePrice).toDecimalPlaces(2), lastBonusRule: l.bonus > 0 ? `${l.quantity}+${l.bonus}` : null };
    await tx.supplierProduct.upsert({
      where: { pharmacyId_supplierId_medicineId: { pharmacyId, supplierId, medicineId: l.medicineId } },
      create: { supplierId, medicineId: l.medicineId, ...data },
      update: data,
    });
  }
}
