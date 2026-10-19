import { describe, it, expect, beforeEach } from "vitest";
import { audit, listAudit } from "@/modules/platform";
import { platformDb } from "@/lib/platform-db";
import { createSale } from "@/modules/sales";
import { resetDb, makePharmacy, makeUser, makeMedicine, makeBatch, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

describe("activity history", () => {
  it("names staff, shows the Developer as Platform support, and stays inside the pharmacy", async () => {
    const admin = await platformDb.user.update({ where: { id: (await makeUser("ADMIN")).id }, data: { name: "Ayesha" } });
    const m = await makeMedicine();
    await makeBatch(m.id, "A1", 100, 10);
    const sale = await createSale(ctxOf(admin), { items: [{ medicineId: m.id, quantity: 1 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CASH" });
    await audit(platformDb, { actor: { id: "dev-1" }, realm: "PLATFORM" }, { action: "medicine.update", entity: "Medicine", entityId: m.id, pharmacyId, after: { name: "Panadol Extra" } });

    const other = await makePharmacy("other");
    const outsider = await makeUser("ADMIN", other.id);
    await audit(platformDb, { actor: { id: outsider.id } }, { action: "medicine.create", entity: "Medicine", entityId: "x", pharmacyId: other.id });

    const all = await listAudit(ctxOf(admin), {});
    expect(all.items.every((r) => r.actor !== outsider.name)).toBe(true);
    const bySale = await listAudit(ctxOf(admin), { entity: "Sale", entityId: sale.id });
    expect(bySale.items).toHaveLength(1);
    expect(bySale.items[0]).toMatchObject({ action: "sale.create", actor: "Ayesha", byPlatform: false });
    const byMedicine = await listAudit(ctxOf(admin), { entity: "Medicine", entityId: m.id });
    expect(byMedicine.items[0]).toMatchObject({ actor: "Platform support", byPlatform: true, after: { name: "Panadol Extra" } });
    expect((await listAudit(ctxOf(admin), { action: "sale." })).total).toBe(1);
  });
});
